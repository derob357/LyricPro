// scripts/regenerate-lyrics.mjs
// One-shot rewriter. For each song, asks Claude to:
//   - Reconstruct the original lyric line as ≥6 words (relaxed for hook/chorus).
//   - Split it into prompt (first ~1/2) + answer (last ~1/2).
//   - Generate 3 distractors that rhyme with the answer and fit the meter/genre.
// Writes results to scripts/regenerate-lyrics.checkpoint.json. DB is NOT touched.
//
// Phase 4 verification gate: BEFORE writing any rewrite to the checkpoint, the
// script fetches the song's canonical lyrics (LRClib → Musixmatch → Genius) and
// verifies the generated `prompt + " " + answer` against those lyrics. If
// verification fails the Claude call is retried up to 3 times total. After 3
// failures the song is recorded with decision="regen-failed-verification" and
// the rewrite is NOT stored. Songs with no canonical source available are
// recorded with decision="no-canonical-source" and skipped.
//
// Usage:
//   node scripts/regenerate-lyrics.mjs               # process all remaining songs
//   node scripts/regenerate-lyrics.mjs 10            # process at most 10 (smoke test)
//   node scripts/regenerate-lyrics.mjs --dry-run     # plan only, no LLM/lyric calls
//   node scripts/regenerate-lyrics.mjs --dry-run 5   # smoke plan
//   node scripts/regenerate-lyrics.mjs --reset       # wipe checkpoint and start fresh

import postgres from "postgres";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

import { fetchCanonicalLyrics } from "./_lib/lyrics-sources.mjs";
import { verifyVariant } from "./_lib/verify-variant.mjs";

dotenv.config();

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("Set SUPABASE_SESSION_POOLER_STRING in .env");
  process.exit(1);
}

// ── CLI args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run") || argv.includes("--dry");
const RESET = argv.includes("--reset");
// Bare positional integer = limit (back-compat with `node script.mjs 10`).
let LIMIT = 0;
const limitFlagIdx = argv.findIndex((a) => a === "--limit");
if (limitFlagIdx >= 0 && limitFlagIdx + 1 < argv.length) {
  const v = parseInt(argv[limitFlagIdx + 1], 10);
  if (Number.isFinite(v) && v > 0) LIMIT = v;
}
if (LIMIT === 0) {
  const bare = argv.find((a) => /^\d+$/.test(a));
  if (bare) LIMIT = parseInt(bare, 10);
}

if (!DRY_RUN && !process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY in .env (or pass --dry-run)");
  process.exit(1);
}

const MUSIXMATCH_API_KEY = process.env.MUSIXMATCH_API_KEY ?? "";
const GENIUS_ACCESS_TOKEN = process.env.GENIUS_ACCESS_TOKEN ?? "";

// maxRetries=8 gives the SDK enough budget to recover from per-minute rate
// limit windows (org cap ~50 req/min on this model). The SDK respects the
// `retry-after` header from 429 responses, so retries wait the full window.
const anthropic = !DRY_RUN && process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ maxRetries: 8 })
  : null;
const MODEL = "claude-haiku-4-5-20251001";

const CHECKPOINT_PATH = path.resolve("scripts/regenerate-lyrics.checkpoint.json");
// Concurrency lowered to 2 to stay under the 50 req/min org cap. Combined with
// SDK retries this is sustainable; pushing higher caused ~32% rate-limit fails.
const CONCURRENCY = 2;
const MAX_REGEN_ATTEMPTS = 3;

// Anthropic tool definition — equivalent to OpenAI's response_format json_schema.
// The model is forced to call this tool with the structured args.
const TOOL = {
  name: "submit_rewrite",
  description: "Submit the rewritten lyric prompt, answer, and 3 distractors.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["prompt", "answer", "distractors"],
    properties: {
      prompt: {
        type: "string",
        description: "Visible part of the lyric (first ~1/2 of the line).",
      },
      answer: {
        type: "string",
        description: "Hidden part of the lyric (last ~1/2 of the line, 1-6 words).",
      },
      distractors: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: { type: "string" },
        description:
          "Three wrong endings that rhyme (or near-rhyme) with the actual answer and could plausibly finish the line.",
      },
    },
  },
};

const SYSTEM_PROMPT = `You rewrite trivia questions for a music app. For each given song, call the submit_rewrite tool with arguments that:
1. Reconstruct the actual lyric line. If the original snippet is short (e.g. just "yourself"), expand to a complete, well-known line (≥6 words) when the section is "verse" or "bridge"; for "hook" or "chorus" you may leave shorter iconic phrases as-is.
2. Split the line into prompt (first ~1/2 of the words) + answer (last ~1/2 of the words). The split is approximate; keep the answer to 1-6 words.
3. Generate 3 distractors that:
   - rhyme (or near-rhyme) with the actual answer,
   - fit the song's genre, register, and era,
   - are NOT the actual answer or trivial variants of it,
   - are plausible enough that a casual listener might believe them.

Use REAL, well-known lyrics from the named song — do not invent. The generated prompt+answer MUST appear as a real contiguous line in the song's actual lyrics; it will be checked against the canonical source-of-truth lyrics before being accepted.`;

const RETRY_NOTE = `PRIOR ATTEMPT FAILED VERIFICATION (the prompt+answer you returned doesn't appear in the canonical lyrics for this song). Use REAL lines from the song only — pick a different actual lyric line, not a paraphrase or a memory.`;

function buildUserMessage(song, retryNote) {
  const base = `Song: "${song.title}" by ${song.artistName} (${song.releaseYear}, ${song.genre}, ${song.lyricSectionType})
Current snippet shown to player: "${song.lyricPrompt}"
Current expected answer: "${song.lyricAnswer}"

Rewrite per the rules and call submit_rewrite.`;
  if (retryNote) return `${base}\n\n${retryNote}`;
  return base;
}

async function callClaudeOnce(song, retryNote) {
  if (!anthropic) throw new Error("Anthropic client not initialized (dry-run?)");
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "submit_rewrite" },
    messages: [{ role: "user", content: buildUserMessage(song, retryNote) }],
  });

  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("No tool_use block in response");
  return toolUse.input;
}

// Try up to MAX_REGEN_ATTEMPTS to get a verifiable rewrite.
// Returns { ok, rewritten?, attempts, lastError?, matchType?, editRate? }.
async function regenerateWithVerification({ song, canonicalLyrics, anthrCallCounter }) {
  let lastError = null;
  let lastEditRate = null;
  for (let attempt = 1; attempt <= MAX_REGEN_ATTEMPTS; attempt++) {
    try {
      anthrCallCounter.calls += 1;
      const result = await callClaudeOnce(song, attempt > 1 ? RETRY_NOTE : null);
      const needle = `${result.prompt ?? ""} ${result.answer ?? ""}`;
      const v = verifyVariant(needle, canonicalLyrics);
      if (v.ok) {
        return {
          ok: true,
          rewritten: result,
          attempts: attempt,
          matchType: v.matchType,
          editRate: v.editRate,
        };
      }
      lastEditRate = v.editRate;
      lastError = `verify failed (editRate=${v.editRate})`;
    } catch (err) {
      lastError = String(err?.message ?? err);
    }
  }
  return {
    ok: false,
    attempts: MAX_REGEN_ATTEMPTS,
    lastError,
    editRate: lastEditRate,
  };
}

function loadCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_PATH)) return { results: {} };
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8"));
  } catch {
    return { results: {} };
  }
}

function saveCheckpoint(cp) {
  const tmp = `${CHECKPOINT_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cp, null, 2));
  fs.renameSync(tmp, CHECKPOINT_PATH);
}

// ── Per-song processing ──────────────────────────────────────────────────────
async function processSong({ song, cp, anthrCallCounter, lyricsFetchCounter }) {
  // 1. Fetch canonical lyrics first. If none available, skip.
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
      section: song.lyricSectionType,
      original: { prompt: song.lyricPrompt, answer: song.lyricAnswer },
      decision: "no-canonical-source",
      lyricsSource: "none",
      missReasons: fetched.reasons ?? null,
    };
    console.log(
      `  #${song.id} "${song.title}" — no canonical source available; skipping generation`,
    );
    return;
  }

  // 2. Generate + verify with retries.
  const r = await regenerateWithVerification({
    song,
    canonicalLyrics: fetched.lyrics,
    anthrCallCounter,
  });

  if (!r.ok) {
    cp.results[song.id] = {
      id: song.id,
      title: song.title,
      artist: song.artistName,
      section: song.lyricSectionType,
      original: { prompt: song.lyricPrompt, answer: song.lyricAnswer },
      decision: "regen-failed-verification",
      lyricsSource: fetched.source,
      attempts: r.attempts,
      lastError: r.lastError,
      lastEditRate: r.editRate,
    };
    console.log(
      `  #${song.id} "${song.title}" — verification FAILED after ${r.attempts} attempts (editRate=${r.editRate}); not stored`,
    );
    return;
  }

  // 3. Verified. Store rewrite to checkpoint (DB is not touched here).
  cp.results[song.id] = {
    id: song.id,
    title: song.title,
    artist: song.artistName,
    section: song.lyricSectionType,
    original: { prompt: song.lyricPrompt, answer: song.lyricAnswer },
    rewritten: r.rewritten,
    decision: "verified",
    lyricsSource: fetched.source,
    attempts: r.attempts,
    matchType: r.matchType,
    editRate: r.editRate,
  };
}

async function processBatch(songs, cp, anthrCallCounter, lyricsFetchCounter) {
  await Promise.all(
    songs.map(async (song) => {
      try {
        await processSong({ song, cp, anthrCallCounter, lyricsFetchCounter });
      } catch (err) {
        cp.results[song.id] = {
          id: song.id,
          title: song.title,
          artist: song.artistName,
          decision: "error",
          error: String(err?.message ?? err),
        };
      }
    }),
  );
  saveCheckpoint(cp);
}

async function main() {
  console.log("─".repeat(60));
  console.log("regenerate-lyrics");
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

  if (DRY_RUN) {
    // Dry-run: connect briefly to count songs and print plan. No LLM, no fetch.
    const sql = postgres(DB_URL, { max: 4 });
    try {
      const cp = loadCheckpoint();
      console.log(`Loaded ${Object.keys(cp.results).length} prior results from checkpoint.`);

      const allSongs = await sql`
        SELECT id, title, "artistName", "releaseYear", genre, "lyricPrompt", "lyricAnswer", "lyricSectionType"
        FROM songs
        WHERE "isActive" = true AND "approvalStatus" = 'approved'
        ORDER BY id ASC
      `;
      // Same idempotency: skip any song already with a non-error checkpoint entry.
      const todo = allSongs.filter((s) => {
        const r = cp.results[s.id];
        if (!r) return true;
        // Re-attempt errors and the legacy entries that have no decision recorded
        // would already be skipped (they'd have rewritten present). Keep skip
        // semantics permissive: any checkpoint entry without an explicit error
        // counts as done.
        if (r.error) return true;
        return false;
      });
      const slice = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;

      // Cost estimate: ~1.3 attempts/song avg, 1 lyrics fetch/song.
      const estLlmCalls = Math.ceil(slice.length * 1.3);
      const estLyricsCalls = slice.length;
      console.log("");
      console.log(`approved+active songs: ${allSongs.length}`);
      console.log(`pending this run:      ${slice.length}`);
      console.log("");
      console.log("Cost estimate (live run):");
      console.log(`  est. Anthropic calls: ${estLlmCalls} (1.3× avg attempts/song)`);
      console.log(`  est. lyrics fetches:  ${estLyricsCalls} (free for LRClib; counts against MM/Genius quotas)`);
      console.log("");
      console.log("DRY-RUN PLAN:");
      console.log(`  ${slice.length} songs would be regenerated with verification gate.`);
      console.log(`  Each would fetch canonical lyrics, retry up to ${MAX_REGEN_ATTEMPTS}× on verify-fail.`);
      console.log(`  Songs with no canonical source would be marked "no-canonical-source" and skipped.`);
      console.log(`  Songs that fail all ${MAX_REGEN_ATTEMPTS} retries would be marked "regen-failed-verification".`);
      console.log("\nFirst 10 songs in plan:");
      for (const s of slice.slice(0, 10)) {
        console.log(`  #${s.id} "${s.title}" — ${s.artistName} (${s.releaseYear}, ${s.genre}, ${s.lyricSectionType})`);
      }
      if (slice.length > 10) console.log(`  … and ${slice.length - 10} more.`);
      console.log("\nDry-run complete. No DB writes, no LLM calls, no lyrics fetches.");
    } finally {
      await sql.end({ timeout: 5 });
    }
    return;
  }

  // ─── Live path ─────────────────────────────────────────────────────────────
  const sql = postgres(DB_URL, { max: 4 });
  try {
    const cp = loadCheckpoint();
    console.log(`Loaded ${Object.keys(cp.results).length} prior results from checkpoint.`);

    const allSongs = await sql`
      SELECT id, title, "artistName", "releaseYear", genre, "lyricPrompt", "lyricAnswer", "lyricSectionType"
      FROM songs
      WHERE "isActive" = true AND "approvalStatus" = 'approved'
      ORDER BY id ASC
    `;
    const todo = allSongs.filter((s) => {
      const r = cp.results[s.id];
      if (!r) return true;
      if (r.error) return true;
      return false;
    });
    const slice = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
    console.log(`${todo.length} remaining; processing ${slice.length}.`);

    const anthrCallCounter = { calls: 0 };
    const lyricsFetchCounter = { calls: 0 };
    let processed = 0;
    for (let i = 0; i < slice.length; i += CONCURRENCY) {
      const batch = slice.slice(i, i + CONCURRENCY);
      await processBatch(batch, cp, anthrCallCounter, lyricsFetchCounter);
      processed += batch.length;
      if (processed % 60 === 0 || processed === slice.length) {
        console.log(`  ${processed}/${slice.length}`);
      }
    }

    // Summary
    const all = Object.values(cp.results);
    const totals = {
      verified: all.filter((r) => r.decision === "verified").length,
      noSource: all.filter((r) => r.decision === "no-canonical-source").length,
      regenFailed: all.filter((r) => r.decision === "regen-failed-verification")
        .length,
      legacyEntries: all.filter((r) => !r.decision && r.rewritten).length,
      errors: all.filter((r) => r.decision === "error" || r.error).length,
    };

    console.log("");
    console.log("═".repeat(60));
    console.log("SUMMARY (cumulative across all checkpoint entries)");
    console.log("═".repeat(60));
    console.log(`verified rewrites:        ${totals.verified}`);
    console.log(`no-canonical-source:      ${totals.noSource}`);
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
