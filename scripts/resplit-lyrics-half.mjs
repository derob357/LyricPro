// scripts/resplit-lyrics-half.mjs
// Re-splits each song's lyricPrompt/lyricAnswer at the 1/2 word boundary
// without calling any LLM. Distractors are kept aligned with the new
// (longer) answer by prepending the words that moved from the old prompt
// to the new answer — this preserves the rhyme target (always the line's
// last word) and the multiple-choice length parity.
//
// Usage:
//   node scripts/resplit-lyrics-half.mjs --dry-run        # preview first 10
//   node scripts/resplit-lyrics-half.mjs --dry-run 50     # preview first 50
//   node scripts/resplit-lyrics-half.mjs                  # apply to DB
//
// Safety:
//   - Always writes scripts/resplit-lyrics-half.checkpoint.json with full
//     before/after for every modified row (manual rollback path).
//   - Real runs snapshot songs → songs_backup_pre_resplit_half (drop+recreate)
//     before any UPDATE, mirroring apply-lyrics-checkpoint.mjs.
//   - Real runs apply all UPDATEs inside a single transaction.

import postgres from "postgres";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

dotenv.config();

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("Set SUPABASE_SESSION_POOLER_STRING in .env");
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run") || args.includes("--dry");
const limitArg = args.find((a) => /^\d+$/.test(a));
const PREVIEW_LIMIT = limitArg ? parseInt(limitArg, 10) : 10;

const CHECKPOINT_PATH = path.resolve("scripts/resplit-lyrics-half.checkpoint.json");

function tokenize(s) {
  return String(s ?? "").trim().split(/\s+/).filter(Boolean);
}

function computeResplit(song) {
  const promptTokens = tokenize(song.lyricPrompt);
  const answerTokens = tokenize(song.lyricAnswer);
  const fullTokens = [...promptTokens, ...answerTokens];
  const n = fullTokens.length;
  if (n === 0) return { skip: "empty line" };
  if (n === 1) return { skip: "single-word line" };

  // 1/2 split: answer = ceil(n/2). On odd-length lines the answer is the
  // bigger half — keeps the question side meatier than the prompt side.
  const newAnswerLen = Math.max(1, Math.ceil(n / 2));
  const newPromptLen = n - newAnswerLen;

  const newPromptTokens = fullTokens.slice(0, newPromptLen);
  const newAnswerTokens = fullTokens.slice(newPromptLen);

  // Words that moved from the old prompt's tail into the new answer.
  // These are what we need to prepend to each old distractor so it still
  // forms a plausible alternative ending of the line.
  const movedFromPrompt = promptTokens.slice(newPromptLen);

  // Case B: old answer is already longer than the new (1/2) answer. Words
  // would need to be trimmed off the front of each distractor, but the
  // distractor's leading words are not guaranteed to match the old answer's
  // leading words (they're independent rhyming completions). Skip these
  // for manual review rather than risk corrupting them.
  const distractorTrimNeeded = answerTokens.length - newAnswerTokens.length;
  if (distractorTrimNeeded > 0) {
    return {
      skip: `case B (old answer ${answerTokens.length} words > new answer ${newAnswerTokens.length})`,
    };
  }

  // postgres-js returns this jsonb column as a raw JSON-encoded string in
  // some driver/server combos; tolerate both string and array forms.
  let rawDistractors = song.distractors;
  if (typeof rawDistractors === "string") {
    try { rawDistractors = JSON.parse(rawDistractors); } catch { rawDistractors = []; }
  }
  const oldDistractors = Array.isArray(rawDistractors)
    ? rawDistractors.filter((d) => typeof d === "string" && d.trim())
    : [];

  const prefix = movedFromPrompt.join(" ");
  const newDistractors = oldDistractors.map((d) => {
    if (movedFromPrompt.length === 0) return d;
    const dTokens = tokenize(d);
    if (dTokens.length >= movedFromPrompt.length) {
      const head = dTokens.slice(0, movedFromPrompt.length).join(" ").toLowerCase();
      if (head === prefix.toLowerCase()) return d; // already prefixed
    }
    return `${prefix} ${d}`.replace(/\s+/g, " ").trim();
  });

  return {
    newPrompt: newPromptTokens.join(" "),
    newAnswer: newAnswerTokens.join(" "),
    newDistractors,
    oldDistractorsParsed: oldDistractors,
    movedWords: movedFromPrompt,
  };
}

async function main() {
  const sql = postgres(DB_URL, { max: 4 });

  const allSongs = await sql`
    SELECT id, title, "artistName", "lyricPrompt", "lyricAnswer", distractors, "lyricSectionType"
    FROM songs
    WHERE "isActive" = true AND "approvalStatus" = 'approved'
    ORDER BY id ASC
  `;

  const stats = { total: allSongs.length, applied: 0, noop: 0, skipped: 0, errors: 0 };
  const checkpoint = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    entries: [],
  };
  const previews = [];

  const planned = []; // rows to write in the transaction
  for (const song of allSongs) {
    try {
      const r = computeResplit(song);
      if (r.skip) {
        stats.skipped += 1;
        previews.push({ id: song.id, title: song.title, status: "SKIP", reason: r.skip });
        continue;
      }
      const oldPromptNorm = (song.lyricPrompt ?? "").trim().replace(/\s+/g, " ");
      const oldAnswerNorm = (song.lyricAnswer ?? "").trim().replace(/\s+/g, " ");
      if (r.newPrompt === oldPromptNorm && r.newAnswer === oldAnswerNorm) {
        stats.noop += 1;
        previews.push({ id: song.id, title: song.title, status: "NOOP" });
        continue;
      }

      checkpoint.entries.push({
        id: song.id,
        title: song.title,
        before: {
          lyricPrompt: song.lyricPrompt,
          lyricAnswer: song.lyricAnswer,
          distractors: song.distractors,
        },
        after: {
          lyricPrompt: r.newPrompt,
          lyricAnswer: r.newAnswer,
          distractors: r.newDistractors,
        },
        movedWords: r.movedWords,
      });
      planned.push({
        id: song.id,
        prompt: r.newPrompt,
        answer: r.newAnswer,
        distractors: r.newDistractors,
      });
      previews.push({
        id: song.id,
        title: song.title,
        artist: song.artistName,
        status: "APPLY",
        before: { p: song.lyricPrompt, a: song.lyricAnswer, d: r.oldDistractorsParsed },
        after: { p: r.newPrompt, a: r.newAnswer, d: r.newDistractors },
      });
      stats.applied += 1;
    } catch (err) {
      stats.errors += 1;
      previews.push({ id: song.id, status: "ERROR", err: String(err) });
    }
  }

  // Always write the rollback checkpoint, dry-run or not.
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2));

  // Print preview of APPLY rows
  const sample = previews.filter((p) => p.status === "APPLY").slice(0, PREVIEW_LIMIT);
  console.log(`\n=== Preview (${sample.length} of ${stats.applied} APPLY rows) ===`);
  for (const s of sample) {
    console.log(`\n[${s.id}] "${s.title}" — ${s.artist}`);
    console.log(`  BEFORE  prompt: "${s.before.p}"`);
    console.log(`          answer: "${s.before.a}"`);
    console.log(`          distractors: ${JSON.stringify(s.before.d)}`);
    console.log(`  AFTER   prompt: "${s.after.p}"`);
    console.log(`          answer: "${s.after.a}"`);
    console.log(`          distractors: ${JSON.stringify(s.after.d)}`);
  }

  // Print SKIP samples (case B etc) so the user can spot patterns.
  const skips = previews.filter((p) => p.status === "SKIP").slice(0, 5);
  if (skips.length) {
    console.log(`\n=== Skipped sample (${skips.length} of ${stats.skipped}) ===`);
    for (const s of skips) {
      console.log(`  [${s.id}] "${s.title}" — ${s.reason}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  total:   ${stats.total}`);
  console.log(`  applied: ${stats.applied}${DRY_RUN ? " (DRY RUN — no DB writes)" : ""}`);
  console.log(`  noop:    ${stats.noop}`);
  console.log(`  skipped: ${stats.skipped}`);
  console.log(`  errors:  ${stats.errors}`);
  console.log(`\nRollback checkpoint: ${CHECKPOINT_PATH}`);

  if (!DRY_RUN && planned.length > 0) {
    console.log(`\nSnapshotting songs → songs_backup_pre_resplit_half ...`);
    await sql`DROP TABLE IF EXISTS songs_backup_pre_resplit_half`;
    await sql`CREATE TABLE songs_backup_pre_resplit_half AS SELECT * FROM songs`;
    console.log(`Snapshot created.`);

    console.log(`Applying ${planned.length} updates in one transaction ...`);
    await sql.begin(async (tx) => {
      for (const p of planned) {
        await tx`
          UPDATE songs
          SET "lyricPrompt" = ${p.prompt},
              "lyricAnswer" = ${p.answer},
              distractors   = ${JSON.stringify(p.distractors)}::jsonb
          WHERE id = ${p.id}
        `;
      }
    });
    console.log(`Applied ${planned.length} updates successfully.`);
  }

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
