// scripts/generate-lyric-variants.mjs
// Per-song lyric-variant generator. For each approved+active song, asks
// Claude to produce 2 ADDITIONAL variants of the question (different lines
// from the song than the seed) and writes the composed array
// [seed, ...additional_variants] to songs.lyricVariants (jsonb).
//
// Skips songs that already have 3+ variants stored. Idempotent. Writes a
// checkpoint after each song so restarts skip done work.
//
// Phase 4 verification gate: BEFORE writing the composed array to the DB,
// the script:
//   1. Fetches canonical lyrics via LRClib → Musixmatch → Genius.
//   2. Verifies the SEED variant against canonical lyrics — if the seed
//      itself is hallucinated we don't compose new variants on top of it.
//   3. Verifies BOTH new variants against canonical lyrics. If either fails
//      the entire pair is bad, retries the Claude call up to 3 times.
//   4. After 3 failed attempts the song is logged and skipped (no DB write).
//   5. Songs with no canonical source are logged and skipped.
//
// Usage:
//   node scripts/generate-lyric-variants.mjs --dry-run        # plan only
//   node scripts/generate-lyric-variants.mjs --dry-run 5      # smoke plan
//   node scripts/generate-lyric-variants.mjs --limit 10       # smoke real
//   node scripts/generate-lyric-variants.mjs                  # full run
//
// Cost: 1+ Claude Haiku 4.5 call per song (1.3× avg with retries) + 1 lyrics
// fetch per song. Run intentionally — invocation is guarded by an explicit
// non-dry-run flag and checkpoint resumes prior runs.

import postgres from "postgres";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

import { fetchCanonicalLyrics } from "./_lib/lyrics-sources.mjs";
import { verifyVariant } from "./_lib/verify-variant.mjs";
import { syncSongVariants } from "./_lib/dual-write-variants.mjs";

dotenv.config();

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("Set SUPABASE_SESSION_POOLER_STRING in .env");
  process.exit(1);
}

// ── CLI flags ─────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run") || argv.includes("--dry");
const RESET = argv.includes("--reset");
function parseFlag(name) {
  const idx = argv.findIndex((a) => a === name || a === `${name.replace(/^-+/, "")}`);
  if (idx >= 0 && idx + 1 < argv.length) {
    const v = parseInt(argv[idx + 1], 10);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 0;
}
// Support `--limit 5` and the bare positional form `--dry-run 5`.
let LIMIT = parseFlag("--limit");
if (LIMIT === 0) {
  // Bare integer arg (any position) acts as a limit. Filter out flags first.
  const bare = argv.find((a) => /^\d+$/.test(a));
  if (bare) LIMIT = parseInt(bare, 10);
}

if (!DRY_RUN && !process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY in .env (or pass --dry-run)");
  process.exit(1);
}

const MUSIXMATCH_API_KEY = process.env.MUSIXMATCH_API_KEY ?? "";
const GENIUS_ACCESS_TOKEN = process.env.GENIUS_ACCESS_TOKEN ?? "";

// maxRetries=8 mirrors regenerate-lyrics.mjs — gives the SDK enough budget
// to ride out per-minute rate-limit windows on the org's Haiku quota.
const anthropic = !DRY_RUN && process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ maxRetries: 8 })
  : null;
const MODEL = "claude-haiku-4-5-20251001";

const CHECKPOINT_PATH = path.resolve(
  "scripts/generate-lyric-variants.checkpoint.json"
);
// Concurrency 2 stays under the 50 req/min org cap. Higher caused ~32%
// rate-limit failures during the regenerate-lyrics run.
const CONCURRENCY = 2;
const MAX_REGEN_ATTEMPTS = 3;

// ── Anthropic tool ────────────────────────────────────────────────────────────
const SECTION_TYPES = ["chorus", "hook", "verse", "bridge", "call-response"];

const TOOL = {
  name: "submit_variants",
  description:
    "Submit 2 ADDITIONAL lyric variants (different lines from the song than the seed) for variant-rotation playback.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["additional_variants"],
    properties: {
      additional_variants: {
        type: "array",
        minItems: 2,
        maxItems: 2,
        description:
          "Exactly 2 new variants, each from a DIFFERENT line of the song than the seed AND from each other.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["prompt", "answer", "distractors", "sectionType"],
          properties: {
            prompt: {
              type: "string",
              description:
                "Visible part of the lyric line (first ~1/2 of the words).",
            },
            answer: {
              type: "string",
              description:
                "Hidden part of the lyric line (last ~1/2, 1-6 words).",
            },
            distractors: {
              type: "array",
              minItems: 3,
              maxItems: 3,
              items: { type: "string" },
              description:
                "Three plausible wrong endings that rhyme or near-rhyme with the answer and fit the song's genre/era.",
            },
            sectionType: {
              type: "string",
              enum: SECTION_TYPES,
              description: "Which structural section of the song this line is from.",
            },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You generate ADDITIONAL lyric trivia questions for a music app's variant-rotation system. For each song you'll receive a "seed" variant (one line + answer + distractors that's already in production). Call submit_variants with exactly 2 additional variants that:

1. Use REAL, well-known lyrics from the named song. Do NOT invent. Each new variant's prompt+answer MUST appear as a real contiguous line in the song's actual lyrics — it will be checked against the canonical source-of-truth lyrics before being accepted.
2. Each new variant must come from a DIFFERENT line of the song than the seed AND from the other new variant. Three distinct lines total.
3. Split each chosen line into prompt (first ~1/2 of the words) + answer (last ~1/2). Keep the answer to 1-6 words.
4. Generate 3 distractors per variant that:
   - rhyme or near-rhyme with the actual answer,
   - fit the song's genre, register, and era,
   - are NOT the actual answer or trivial variants of it,
   - are plausible enough that a casual listener might believe them.
5. sectionType must be one of: chorus | hook | verse | bridge | call-response. Choose the one that best describes where the line appears in the song's structure.`;

const RETRY_NOTE = `PRIOR ATTEMPT FAILED VERIFICATION (one or more variants don't appear in the canonical lyrics). Use REAL lines from the song only — pick different actual lyric lines, not paraphrases or memories.`;

function buildUserMessage(song, seed, retryNote) {
  const base = `Song: "${song.title}" by ${song.artistName} (${song.releaseYear}, ${song.genre})

Seed variant (already in production — DO NOT REPEAT this line):
  prompt:  "${seed.prompt}"
  answer:  "${seed.answer}"
  section: ${seed.sectionType}

Generate 2 additional variants from DIFFERENT lines of this song. Call submit_variants.`;
  if (retryNote) return `${base}\n\n${retryNote}`;
  return base;
}

async function callClaudeOnce(song, seed, retryNote) {
  if (!anthropic) throw new Error("Anthropic client not initialized (dry-run?)");
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "submit_variants" },
    messages: [{ role: "user", content: buildUserMessage(song, seed, retryNote) }],
  });
  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("No tool_use block in response");
  return toolUse.input;
}

// Try up to MAX_REGEN_ATTEMPTS to get a verifiable PAIR of variants.
// Returns { ok, additional?, attempts, lastError?, verifyDetails? }.
async function generatePairWithVerification({
  song,
  seed,
  canonicalLyrics,
  anthrCallCounter,
}) {
  let lastError = null;
  let lastDetails = null;
  for (let attempt = 1; attempt <= MAX_REGEN_ATTEMPTS; attempt++) {
    try {
      anthrCallCounter.calls += 1;
      const result = await callClaudeOnce(
        song,
        seed,
        attempt > 1 ? RETRY_NOTE : null,
      );
      const additional = Array.isArray(result.additional_variants)
        ? result.additional_variants
        : [];
      if (additional.length < 2) {
        lastError = `claude returned ${additional.length} variants (need 2)`;
        continue;
      }
      const checks = additional.map((v, idx) => {
        const needle = `${v.prompt ?? ""} ${v.answer ?? ""}`;
        const r = verifyVariant(needle, canonicalLyrics);
        return { idx, ok: r.ok, matchType: r.matchType, editRate: r.editRate };
      });
      const allOk = checks.every((c) => c.ok);
      if (allOk) {
        return { ok: true, additional, attempts: attempt, verifyDetails: checks };
      }
      lastDetails = checks;
      lastError = `verify failed: ${checks
        .map((c) => `v${c.idx}=${c.ok ? "ok" : `editRate=${c.editRate}`}`)
        .join(", ")}`;
    } catch (err) {
      lastError = String(err?.message ?? err);
    }
  }
  return {
    ok: false,
    attempts: MAX_REGEN_ATTEMPTS,
    lastError,
    verifyDetails: lastDetails,
  };
}

// ── Checkpoint ────────────────────────────────────────────────────────────────
function loadCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_PATH)) return { results: {} };
  return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8"));
}
function saveCheckpoint(cp) {
  const tmp = `${CHECKPOINT_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cp, null, 2));
  fs.renameSync(tmp, CHECKPOINT_PATH);
}

// ── Per-song processing ───────────────────────────────────────────────────────
function seedFromSong(song) {
  return {
    prompt: song.lyricPrompt,
    answer: song.lyricAnswer,
    distractors: Array.isArray(song.distractors) ? song.distractors : [],
    sectionType: song.lyricSectionType,
  };
}

async function processSong(sql, song, cp, anthrCallCounter, lyricsFetchCounter) {
  const seed = seedFromSong(song);

  // 1. Fetch canonical lyrics first.
  lyricsFetchCounter.calls += 1;
  const fetched = await fetchCanonicalLyrics({
    title: song.title,
    artist: song.artistName,
    musixmatchKey: MUSIXMATCH_API_KEY,
    geniusToken: GENIUS_ACCESS_TOKEN,
  });

  if (fetched.source === "none" || !fetched.lyrics) {
    cp.results[song.id] = {
      id: song.id,
      title: song.title,
      artist: song.artistName,
      seed,
      decision: "no-canonical-source",
      lyricsSource: "none",
      missReasons: fetched.reasons ?? null,
      wrote_db: false,
    };
    console.log(
      `  #${song.id} "${song.title}" — no canonical source available; skipping generation`,
    );
    return;
  }

  // 2. Verify the SEED before generating on top of it.
  const seedNeedle = `${seed.prompt ?? ""} ${seed.answer ?? ""}`;
  const seedCheck = verifyVariant(seedNeedle, fetched.lyrics);
  if (!seedCheck.ok) {
    cp.results[song.id] = {
      id: song.id,
      title: song.title,
      artist: song.artistName,
      seed,
      decision: "seed-fails-verify",
      lyricsSource: fetched.source,
      seedEditRate: seedCheck.editRate,
      note: "needs regenerate-lyrics first",
      wrote_db: false,
    };
    console.log(
      `  #${song.id} "${song.title}" — seed FAILS verification (editRate=${seedCheck.editRate}); needs regenerate-lyrics first`,
    );
    return;
  }

  // 3. Generate + verify the pair with retries.
  const r = await generatePairWithVerification({
    song,
    seed,
    canonicalLyrics: fetched.lyrics,
    anthrCallCounter,
  });

  if (!r.ok) {
    cp.results[song.id] = {
      id: song.id,
      title: song.title,
      artist: song.artistName,
      seed,
      decision: "regen-failed-verification",
      lyricsSource: fetched.source,
      attempts: r.attempts,
      lastError: r.lastError,
      verifyDetails: r.verifyDetails,
      wrote_db: false,
    };
    console.log(
      `  #${song.id} "${song.title}" — pair verification FAILED after ${r.attempts} attempts; not written`,
    );
    return;
  }

  // 4. All good — compose and write.
  const composed = [seed, ...r.additional];
  // Phase 5d dual-write: write to BOTH the legacy jsonb column AND the
  // layer-3 lyric_moments + gameplay_items tables in a single transaction.
  // The helper preserves the postgres-js sql.json() pattern for the legacy
  // jsonb update (the previous bare UPDATE here had a comment about that
  // double-encoding gotcha — same handling lives inside the helper now).
  await syncSongVariants(sql, song.id, composed);
  cp.results[song.id] = {
    id: song.id,
    title: song.title,
    artist: song.artistName,
    seed,
    additional: r.additional,
    composed_count: composed.length,
    decision: "verified-and-written",
    lyricsSource: fetched.source,
    attempts: r.attempts,
    verifyDetails: r.verifyDetails,
    wrote_db: true,
  };
}

async function processBatch(sql, songs, cp, anthrCallCounter, lyricsFetchCounter) {
  await Promise.all(
    songs.map(async (s) => {
      try {
        await processSong(sql, s, cp, anthrCallCounter, lyricsFetchCounter);
      } catch (err) {
        cp.results[s.id] = {
          id: s.id,
          title: s.title,
          artist: s.artistName,
          decision: "error",
          error: String(err?.message ?? err),
        };
      }
    }),
  );
  saveCheckpoint(cp);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("─".repeat(60));
  console.log("generate-lyric-variants");
  console.log("─".repeat(60));
  console.log(`mode:           ${DRY_RUN ? "DRY-RUN (no DB writes, no LLM calls, no lyric fetches)" : "LIVE"}`);
  console.log(`limit:          ${LIMIT > 0 ? LIMIT : "none"}`);
  console.log(`reset:          ${RESET ? "yes" : "no"}`);
  console.log(`anthropic key:  ${process.env.ANTHROPIC_API_KEY ? "set" : "unset"}`);
  console.log(`musixmatch:     ${MUSIXMATCH_API_KEY ? "set" : "unset"}`);
  console.log(`genius:         ${GENIUS_ACCESS_TOKEN ? "set" : "unset"}`);
  console.log(`checkpoint:     ${CHECKPOINT_PATH}`);
  console.log("─".repeat(60));

  if (RESET && fs.existsSync(CHECKPOINT_PATH)) {
    fs.unlinkSync(CHECKPOINT_PATH);
    console.log(`[reset] removed ${CHECKPOINT_PATH}`);
  }

  const sql = postgres(DB_URL, { max: 4 });
  try {
    const cp = loadCheckpoint();
    console.log(
      `Loaded ${Object.keys(cp.results).length} prior results from checkpoint.`
    );

    // Probe whether the lyricVariants column has been applied to the live DB
    // (Phase 2a migration: 0007_lyric_variants.sql). The script remains usable
    // pre-migration in dry-run mode so the user can preview the plan first.
    const [colExistsRow] = await sql`
      SELECT 1 AS exists
      FROM information_schema.columns
      WHERE table_name = 'songs' AND column_name = 'lyricVariants'
      LIMIT 1
    `;
    const hasVariantsCol = !!colExistsRow;
    if (!hasVariantsCol && !DRY_RUN) {
      console.error(
        "songs.lyricVariants column missing. Run scripts/apply-lyric-variants-migration.mjs first."
      );
      process.exit(1);
    }
    if (!hasVariantsCol) {
      console.warn(
        "(Note: songs.lyricVariants column not yet applied — running plan-only.)"
      );
    }

    const allSongs = hasVariantsCol
      ? await sql`
          SELECT id, title, "artistName", "releaseYear", genre,
                 "lyricPrompt", "lyricAnswer", distractors, "lyricSectionType",
                 "lyricVariants"
          FROM songs
          WHERE "isActive" = true AND "approvalStatus" = 'approved'
          ORDER BY id ASC
        `
      : await sql`
          SELECT id, title, "artistName", "releaseYear", genre,
                 "lyricPrompt", "lyricAnswer", distractors, "lyricSectionType"
          FROM songs
          WHERE "isActive" = true AND "approvalStatus" = 'approved'
          ORDER BY id ASC
        `;

    // Skip songs that already have 3+ variants OR already processed in this checkpoint.
    // A "completed" checkpoint entry is anything that's not an unrecoverable
    // error — including no-canonical-source and seed-fails-verify, which we
    // do NOT want to retry on every run.
    const todo = allSongs.filter((s) => {
      const r = cp.results[s.id];
      if (r && !r.error && r.decision !== "error") return false;
      const v = s.lyricVariants;
      if (Array.isArray(v) && v.length >= 3) return false;
      return true;
    });
    const slice = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
    console.log(
      `${allSongs.length} total approved+active. ${todo.length} need variants. Processing ${slice.length}.`
    );

    if (DRY_RUN) {
      // Cost estimate: ~1.3 attempts/song avg, 1 lyrics fetch/song.
      const estLlmCalls = Math.ceil(slice.length * 1.3);
      const estLyricsCalls = slice.length;
      console.log("");
      console.log("Cost estimate (live run):");
      console.log(`  est. Anthropic calls: ${estLlmCalls} (1.3× avg attempts/song)`);
      console.log(`  est. lyrics fetches:  ${estLyricsCalls} (free for LRClib; counts against MM/Genius quotas)`);
      console.log("");
      console.log("DRY-RUN PLAN:");
      console.log(`  ${slice.length} songs would receive 2 LLM-generated variants each.`);
      console.log(`  Each would fetch canonical lyrics, verify seed, retry up to ${MAX_REGEN_ATTEMPTS}× on pair-verify-fail.`);
      console.log(`  Songs with no canonical source would be skipped.`);
      console.log(`  Songs whose seed fails verification would be skipped (need regenerate-lyrics first).`);
      console.log(`  Songs whose 2 new variants fail all ${MAX_REGEN_ATTEMPTS} retries would be skipped.`);
      console.log("\nFirst 10 of slice:");
      for (const s of slice.slice(0, 10)) {
        const seed = seedFromSong(s);
        console.log(
          `  #${s.id.toString().padStart(5, " ")} "${s.title}" by ${s.artistName} (${s.releaseYear})`
        );
        console.log(
          `       seed[${seed.sectionType}] prompt="${seed.prompt}" answer="${seed.answer}"`
        );
      }
      if (slice.length > 10) {
        console.log(`  … and ${slice.length - 10} more.`);
      }
      console.log(
        `\nDry-run complete. ${slice.length} songs would be processed. No DB writes, no LLM calls, no lyric fetches.`
      );
      return;
    }

    const anthrCallCounter = { calls: 0 };
    const lyricsFetchCounter = { calls: 0 };
    let processed = 0;
    for (let i = 0; i < slice.length; i += CONCURRENCY) {
      const batch = slice.slice(i, i + CONCURRENCY);
      await processBatch(sql, batch, cp, anthrCallCounter, lyricsFetchCounter);
      processed += batch.length;
      if (processed % 60 === 0 || processed === slice.length) {
        console.log(`  ${processed}/${slice.length}`);
      }
    }

    const all = Object.values(cp.results);
    const totals = {
      verifiedWritten: all.filter((r) => r.decision === "verified-and-written").length,
      noSource: all.filter((r) => r.decision === "no-canonical-source").length,
      seedFails: all.filter((r) => r.decision === "seed-fails-verify").length,
      regenFailed: all.filter((r) => r.decision === "regen-failed-verification").length,
      legacyEntries: all.filter((r) => !r.decision && r.composed_count).length,
      errors: all.filter((r) => r.decision === "error" || r.error).length,
    };

    console.log("");
    console.log("═".repeat(60));
    console.log("SUMMARY (cumulative across all checkpoint entries)");
    console.log("═".repeat(60));
    console.log(`verified-and-written:     ${totals.verifiedWritten}`);
    console.log(`no-canonical-source:      ${totals.noSource}`);
    console.log(`seed-fails-verify:        ${totals.seedFails}`);
    console.log(`regen-failed-verification:${totals.regenFailed}`);
    console.log(`legacy (pre-Phase4):      ${totals.legacyEntries}`);
    console.log(`errors:                   ${totals.errors}`);
    console.log(`anthropic calls (run):    ${anthrCallCounter.calls}`);
    console.log(`lyrics fetches (run):     ${lyricsFetchCounter.calls}`);
    console.log(`Done. Checkpoint at ${CHECKPOINT_PATH}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
