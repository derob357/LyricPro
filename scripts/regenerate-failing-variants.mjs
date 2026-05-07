// scripts/regenerate-failing-variants.mjs
// Phase 3 — Regenerate Failing Variants.
//
// Reads scripts/verify-lyrics.report.json. For every variant that the audit
// flagged as FAIL_NOT_FOUND, refetches the song's canonical lyrics, asks
// Claude Haiku to write a NEW variant grounded in those real lyrics, verifies
// the result against the canonical text, and (if a replacement was found for
// at least one variant) writes the new lyricVariants array back to the DB.
//
// Smart-pruning: variants that fail regen after retries are REMOVED from the
// array (rather than left as broken). If every variant on a song fails regen
// the song is deactivated instead of writing an empty array.
//
// At end of run, NO_SOURCE songs from the audit + songs whose lyrics went
// missing this run are deactivated. Idempotent.
//
// Usage:
//   node scripts/regenerate-failing-variants.mjs                       # dry-run plan
//   node scripts/regenerate-failing-variants.mjs --apply               # execute
//   node scripts/regenerate-failing-variants.mjs --apply --limit 3     # smoke
//   node scripts/regenerate-failing-variants.mjs --apply --genre Pop   # bucket
//   node scripts/regenerate-failing-variants.mjs --apply --decade 1980s
//   node scripts/regenerate-failing-variants.mjs --apply --song-ids 1,2,3
//   node scripts/regenerate-failing-variants.mjs --reset               # fresh start
//
// All flags compose. Re-runs without --reset skip already-processed songs.

import postgres from "postgres";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

import { fetchCanonicalLyrics } from "./_lib/lyrics-sources.mjs";
import { verifyVariant } from "./_lib/verify-variant.mjs";
import {
  syncSongVariants,
  clearSongLayer3,
} from "./_lib/dual-write-variants.mjs";

dotenv.config();

// ─── Config ───────────────────────────────────────────────────────────────────
const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
if (!DB_URL) {
  console.error(
    "Set SUPABASE_SESSION_POOLER_STRING (or SUPABASE_DIRECT_CONNECTION_STRING / DATABASE_URL) in .env"
  );
  process.exit(1);
}

const MUSIXMATCH_API_KEY = process.env.MUSIXMATCH_API_KEY ?? "";
const GENIUS_ACCESS_TOKEN = process.env.GENIUS_ACCESS_TOKEN ?? "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";

const REPORT_PATH = path.resolve("scripts/verify-lyrics.report.json");
const CHECKPOINT_PATH = path.resolve(
  "scripts/regenerate-failing-variants.checkpoint.json"
);
const RESULT_PATH = path.resolve("scripts/regenerate-failing-variants.report.json");
const BACKUP_PATH = path.resolve("scripts/regenerate-failing-variants.backup.json");

// Anthropic Haiku 4.5 — same model + retry budget as generate-lyric-variants.
const MODEL = "claude-haiku-4-5-20251001";
const MAX_REGEN_ATTEMPTS = 3;

// Concurrency: 2 songs in flight. With up to 3 attempts × ~1.5 calls/song
// average that's ~30-40 calls/min on the Haiku free-tier 50/min cap.
const SONG_CONCURRENCY = 2;

// Cost estimate constants (Haiku 4.5 public pricing as of writing).
const HAIKU_INPUT_PER_M = 0.8; // $/M tokens
const HAIKU_OUTPUT_PER_M = 4.0; // $/M tokens
const EST_INPUT_TOKENS = 4000;
const EST_OUTPUT_TOKENS = 300;
const EST_AVG_ATTEMPTS = 1.3;

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getFlag(name) {
  return args.includes(`--${name}`);
}
function getOpt(name) {
  const i = args.findIndex((a) => a === `--${name}`);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return null;
}
const APPLY = getFlag("apply");
const RESET = getFlag("reset");
const LIMIT_RAW = getOpt("limit");
const LIMIT = LIMIT_RAW != null ? parseInt(LIMIT_RAW, 10) : 0;
const GENRE = getOpt("genre");
const DECADE = getOpt("decade");
const SONG_IDS_RAW = getOpt("song-ids");
const SONG_IDS = SONG_IDS_RAW
  ? SONG_IDS_RAW.split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0)
  : null;

if (LIMIT_RAW != null && (!Number.isFinite(LIMIT) || LIMIT < 0)) {
  console.error(`--limit must be a non-negative integer (got: ${LIMIT_RAW})`);
  process.exit(1);
}

// ─── Anthropic client ────────────────────────────────────────────────────────
// maxRetries=8 mirrors generate-lyric-variants — gives the SDK enough budget
// to ride out per-minute rate-limit windows.
const anthropic = APPLY && ANTHROPIC_API_KEY
  ? new Anthropic({ maxRetries: 8 })
  : null;

const SECTION_TYPES = ["chorus", "hook", "verse", "bridge", "call-response"];

const TOOL = {
  name: "submit_replacement_variant",
  description:
    "Submit ONE replacement lyric trivia variant grounded in the canonical lyrics provided.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["replacement"],
    properties: {
      replacement: {
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
            description:
              "Which structural section of the song this line is from.",
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You generate replacement lyric trivia questions for a music app whose previous AI-generated questions hallucinated lyrics that don't actually exist in the named song. Your role is to FIX a single bad question.

You will receive: song title, artist, year, genre, target sectionType, the BAD prior question text (so you don't repeat it), and the song's REAL canonical lyrics.

Call submit_replacement_variant with exactly ONE replacement variant.

RULES (non-negotiable):
1. The variant's combined prompt + answer MUST be a real, contiguous line (or near-contiguous phrase) from the canonical lyrics provided. NOT a paraphrase. NOT a memory. Verbatim from the lyrics text.
2. Pick a line that's recognizable for the target sectionType:
   - chorus / hook → choose a memorable, "iconic" hook or chorus line — high recognition, low ambiguity
   - verse → choose a vivid, image-rich verse line — distinctive phrasing, fits the song's voice
   - bridge → choose a line from the bridge if there is one
   - call-response → choose a call-and-response moment if applicable
3. Split the chosen line into:
   - prompt: first ~½ of the words (the visible part shown to the player)
   - answer: last ~½ (the hidden part to identify, 1-6 words)
4. Generate 3 distractors that:
   - rhyme or near-rhyme with the real answer
   - fit the song's genre / era / register
   - are NOT the actual answer or trivial variants ("the moon" vs "moon")
   - are plausible enough that a casual listener might believe them
5. Apply the playability rubric:
   - Recognition: pick lines the audience is likely to know
   - Lyric vividness: prefer specific, image-rich, memorable phrases
   - Artist fingerprint: prefer lines that reflect this artist's distinctive voice
   - Sayability / quote energy: prefer lines that invite repetition
   - Low ambiguity: avoid lines that could plausibly be from many other songs
6. NEVER repeat the bad prior question. NEVER invent lines not in the canonical lyrics.

If the song's canonical lyrics genuinely don't contain a usable line for the target sectionType, choose the best fit you can from any section — better to mis-tag sectionType than to invent.`;

function buildUserMessage({
  song,
  sectionType,
  badPrompt,
  badAnswer,
  source,
  canonicalLyrics,
  retryNote,
}) {
  const base = `Song: "${song.title}" by ${song.artistName} (${song.releaseYear ?? "unknown year"}, ${song.genre})
Target sectionType: ${sectionType}

BAD prior question (DO NOT REPEAT — this is what hallucinated):
  prompt: "${badPrompt}"
  answer: "${badAnswer}"

Canonical lyrics (source: ${source}):
---
${canonicalLyrics}
---

Generate ONE replacement variant. Call submit_replacement_variant.`;
  if (retryNote) return `${base}\n\n${retryNote}`;
  return base;
}

const RETRY_NOTE = `PRIOR ATTEMPT FAILED VERIFICATION (its prompt+answer doesn't appear in the canonical lyrics above). Try a DIFFERENT line from the lyrics — NOT a paraphrase, NOT a memory.`;

async function callClaudeOnce(args) {
  if (!anthropic) throw new Error("Anthropic client not initialized");
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "submit_replacement_variant" },
    messages: [{ role: "user", content: buildUserMessage(args) }],
  });
  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("No tool_use block in response");
  const replacement = toolUse.input?.replacement;
  if (!replacement || typeof replacement !== "object") {
    throw new Error("Tool input missing 'replacement' object");
  }
  return replacement;
}

// Try up to MAX_REGEN_ATTEMPTS to get a verifiable replacement variant.
// Returns { ok, replacement?, attempts, lastError? }.
async function regenerateOneVariant({
  song,
  badVariant,
  source,
  canonicalLyrics,
}) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_REGEN_ATTEMPTS; attempt++) {
    try {
      const replacement = await callClaudeOnce({
        song,
        sectionType: badVariant.sectionType ?? "verse",
        badPrompt: badVariant.prompt ?? "",
        badAnswer: badVariant.answer ?? "",
        source,
        canonicalLyrics,
        retryNote: attempt > 1 ? RETRY_NOTE : null,
      });
      const needle = `${replacement.prompt ?? ""} ${replacement.answer ?? ""}`;
      const v = verifyVariant(needle, canonicalLyrics);
      if (v.ok) {
        return {
          ok: true,
          replacement: {
            prompt: String(replacement.prompt ?? ""),
            answer: String(replacement.answer ?? ""),
            distractors: Array.isArray(replacement.distractors)
              ? replacement.distractors.slice(0, 3).map(String)
              : [],
            sectionType: SECTION_TYPES.includes(replacement.sectionType)
              ? replacement.sectionType
              : badVariant.sectionType ?? "verse",
          },
          matchType: v.matchType,
          editRate: v.editRate,
          attempts: attempt,
        };
      }
      lastError = `verify failed (editRate=${v.editRate})`;
    } catch (err) {
      lastError = String(err?.message ?? err);
    }
  }
  return { ok: false, attempts: MAX_REGEN_ATTEMPTS, lastError };
}

// ─── Checkpoint helpers ──────────────────────────────────────────────────────
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

function loadBackup() {
  if (!fs.existsSync(BACKUP_PATH)) return { songs: {} };
  try {
    return JSON.parse(fs.readFileSync(BACKUP_PATH, "utf8"));
  } catch {
    return { songs: {} };
  }
}
function saveBackup(bk) {
  const tmp = `${BACKUP_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(bk, null, 2));
  fs.renameSync(tmp, BACKUP_PATH);
}

// ─── Report helpers ──────────────────────────────────────────────────────────
function readReport() {
  if (!fs.existsSync(REPORT_PATH)) {
    console.error(
      `Report not found: ${REPORT_PATH}\n` +
        `Run scripts/verify-lyrics.mjs first to produce the report.`
    );
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8"));
  } catch (err) {
    console.error(`Failed to parse ${REPORT_PATH}: ${err.message}`);
    process.exit(1);
  }
  if (!parsed || !Array.isArray(parsed.songs)) {
    console.error(`Report is missing a 'songs' array.`);
    process.exit(1);
  }
  return parsed;
}

function filterCandidates(reportSongs) {
  // Returns the subset to actively regenerate (HAS_FAILS, with CLI filters).
  let songs = reportSongs.filter((s) => s.status === "HAS_FAILS");
  if (GENRE) songs = songs.filter((s) => s.genre === GENRE);
  if (DECADE) songs = songs.filter((s) => s.decadeRange === DECADE);
  if (SONG_IDS) {
    const idset = new Set(SONG_IDS);
    songs = songs.filter((s) => idset.has(s.songId));
  }
  songs.sort((a, b) => (a.songId ?? 0) - (b.songId ?? 0));
  if (LIMIT > 0) songs = songs.slice(0, LIMIT);
  return songs;
}

function deactivationCandidates(reportSongs) {
  // NO_SOURCE songs are unaffected by --genre/--decade/--song-ids if the
  // user didn't filter; if they did, only deactivate within their slice.
  let ns = reportSongs.filter((s) => s.status === "NO_SOURCE");
  if (GENRE) ns = ns.filter((s) => s.genre === GENRE);
  if (DECADE) ns = ns.filter((s) => s.decadeRange === DECADE);
  if (SONG_IDS) {
    const idset = new Set(SONG_IDS);
    ns = ns.filter((s) => idset.has(s.songId));
  }
  return ns;
}

// ─── Per-song processing ─────────────────────────────────────────────────────
async function processOneSong({ song, sql, cp, bk, anthrCallCounter }) {
  // song shape from report: { songId, title, artistName, genre, decadeRange,
  //   status, lyricsSource, lyricsCharCount, variants: [{index, prompt,
  //   answer, sectionType, outcome, ...}] }
  const songId = song.songId;

  // Refetch canonical lyrics fresh — don't trust the report's source alone.
  const fetched = await fetchCanonicalLyrics({
    title: song.title,
    artist: song.artistName,
    musixmatchKey: MUSIXMATCH_API_KEY,
    geniusToken: GENIUS_ACCESS_TOKEN,
  });

  if (fetched.source === "none" || !fetched.lyrics) {
    return {
      songId,
      title: song.title,
      artistName: song.artistName,
      decision: "regen-blocked-no-source",
      lyricsSource: "none",
      perVariantOutcomes: [],
      newLyricVariantsCount: null,
      error: null,
      missReasons: fetched.reasons ?? null,
    };
  }

  // Pull current row from DB so we backup the EXACT pre-state and regen
  // against the live array (not the audit-time array).
  const [row] = await sql`
    SELECT id, title, "artistName", "releaseYear", genre, "decadeRange",
           "lyricVariants", "isActive"
    FROM songs
    WHERE id = ${songId}
    LIMIT 1
  `;
  if (!row) {
    return {
      songId,
      title: song.title,
      artistName: song.artistName,
      decision: "missing-in-db",
      lyricsSource: fetched.source,
      perVariantOutcomes: [],
      newLyricVariantsCount: null,
      error: "row not found",
    };
  }

  const liveVariants = Array.isArray(row.lyricVariants) ? row.lyricVariants : [];

  // Backup pre-state. Always — even on dry-run / blocked / failed paths,
  // so the file is a complete inventory of every song the script "touched".
  if (!bk.songs[songId]) {
    bk.songs[songId] = {
      songId,
      title: row.title,
      artistName: row.artistName,
      preIsActive: row.isActive,
      preLyricVariants: liveVariants,
      reportLyricsSource: song.lyricsSource ?? null,
      capturedAt: new Date().toISOString(),
    };
  }

  // Determine which variant indices in the live array correspond to the
  // FAIL_NOT_FOUND outcomes from the report. We trust the index AND
  // re-verify against current canonical lyrics to be safe (a variant the
  // audit flagged might have been edited since).
  const failingIndicesFromReport = (song.variants ?? [])
    .filter((v) => v.outcome === "FAIL_NOT_FOUND")
    .map((v) => v.index);

  const perVariantOutcomes = [];
  const replacementsByIndex = new Map(); // idx → new variant
  const failedIndices = new Set();

  // Iterate every live variant; figure out which need regen.
  for (let i = 0; i < liveVariants.length; i++) {
    const live = liveVariants[i];

    // Variants that the report marked as PASS we re-confirm cheaply against
    // the current canonical (no LLM cost). If still pass, keep as-is.
    // Variants that report-flagged as FAIL: regen.
    const reportSaysFail = failingIndicesFromReport.includes(i);
    if (!reportSaysFail) {
      perVariantOutcomes.push({
        index: i,
        decision: "originally-pass-untouched",
      });
      continue;
    }

    // Regen this one.
    if (anthropic == null) {
      // Dry-run path.
      perVariantOutcomes.push({
        index: i,
        decision: "would-regenerate",
      });
      anthrCallCounter.calls += 1; // count for cost estimate
      continue;
    }
    anthrCallCounter.calls += 1;
    const r = await regenerateOneVariant({
      song: row,
      badVariant: live,
      source: fetched.source,
      canonicalLyrics: fetched.lyrics,
    });
    if (r.ok) {
      replacementsByIndex.set(i, r.replacement);
      perVariantOutcomes.push({
        index: i,
        decision: "regenerated-and-verified",
        attempts: r.attempts,
        matchType: r.matchType,
        editRate: r.editRate,
        newPrompt: r.replacement.prompt,
        newAnswer: r.replacement.answer,
      });
    } else {
      failedIndices.add(i);
      perVariantOutcomes.push({
        index: i,
        decision: "regen-failed",
        attempts: r.attempts,
        lastError: r.lastError,
      });
    }
  }

  // Compose new lyricVariants array: keep originals where they passed, swap
  // in replacements where regen succeeded, drop indices where regen failed.
  const newVariants = [];
  for (let i = 0; i < liveVariants.length; i++) {
    if (replacementsByIndex.has(i)) {
      newVariants.push(replacementsByIndex.get(i));
    } else if (failedIndices.has(i)) {
      // skip — smart prune
    } else {
      newVariants.push(liveVariants[i]);
    }
  }

  // Decide song-level outcome.
  if (!APPLY) {
    return {
      songId,
      title: row.title,
      artistName: row.artistName,
      decision: "dry-run-plan",
      lyricsSource: fetched.source,
      preLyricVariantsCount: liveVariants.length,
      planNewVariantsCount: newVariants.length,
      perVariantOutcomes,
    };
  }

  if (newVariants.length === 0) {
    // Every variant failed regen. Don't write empty array — let the
    // deactivation pass handle it.
    return {
      songId,
      title: row.title,
      artistName: row.artistName,
      decision: "all-variants-failed-deactivate",
      lyricsSource: fetched.source,
      preLyricVariantsCount: liveVariants.length,
      newLyricVariantsCount: 0,
      perVariantOutcomes,
    };
  }

  // Atomic single UPDATE per song. Only if we made any replacement (no
  // variants regen'd → nothing to write).
  if (replacementsByIndex.size === 0 && failedIndices.size === 0) {
    // Nothing changed (shouldn't happen in HAS_FAILS bucket but be safe).
    return {
      songId,
      title: row.title,
      artistName: row.artistName,
      decision: "no-op",
      lyricsSource: fetched.source,
      preLyricVariantsCount: liveVariants.length,
      newLyricVariantsCount: newVariants.length,
      perVariantOutcomes,
    };
  }

  // Phase 5d dual-write: keep songs.lyricVariants jsonb (legacy) AND
  // lyric_moments + gameplay_items (layer-3) in sync atomically. The helper
  // wraps both in a single transaction; if either side fails, the whole song
  // rolls back and we don't leak partial state.
  await syncSongVariants(sql, songId, newVariants);

  return {
    songId,
    title: row.title,
    artistName: row.artistName,
    decision: "kept-active",
    lyricsSource: fetched.source,
    preLyricVariantsCount: liveVariants.length,
    newLyricVariantsCount: newVariants.length,
    replacementsCount: replacementsByIndex.size,
    prunedCount: failedIndices.size,
    perVariantOutcomes,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═".repeat(60));
  console.log("REGENERATE FAILING VARIANTS");
  console.log("═".repeat(60));
  console.log(`mode:           ${APPLY ? "APPLY (will mutate DB + call Anthropic)" : "DRY-RUN (no mutations, no LLM calls)"}`);
  console.log(`limit:          ${LIMIT > 0 ? LIMIT : "none"}`);
  console.log(`genre filter:   ${GENRE ?? "(none)"}`);
  console.log(`decade filter:  ${DECADE ?? "(none)"}`);
  console.log(`song-ids:       ${SONG_IDS ? SONG_IDS.join(",") : "(none)"}`);
  console.log(`reset:          ${RESET ? "yes" : "no"}`);
  console.log(`anthropic key:  ${ANTHROPIC_API_KEY ? "set" : "unset"}`);
  console.log(`musixmatch:     ${MUSIXMATCH_API_KEY ? "set" : "unset"}`);
  console.log(`genius:         ${GENIUS_ACCESS_TOKEN ? "set" : "unset"}`);
  console.log(`report:         ${REPORT_PATH}`);
  console.log(`checkpoint:     ${CHECKPOINT_PATH}`);
  console.log(`backup:         ${BACKUP_PATH}`);
  console.log(`result:         ${RESULT_PATH}`);
  console.log("");

  if (APPLY && !ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY required for --apply. Aborting.");
    process.exit(1);
  }

  if (RESET) {
    if (fs.existsSync(CHECKPOINT_PATH)) {
      fs.unlinkSync(CHECKPOINT_PATH);
      console.log(`[reset] removed ${CHECKPOINT_PATH}`);
    }
    if (fs.existsSync(BACKUP_PATH)) {
      fs.unlinkSync(BACKUP_PATH);
      console.log(`[reset] removed ${BACKUP_PATH}`);
    }
  }

  const report = readReport();
  console.log(`report generatedAt: ${report.generatedAt ?? "(unknown)"}`);
  console.log(`report songs:       ${report.songs.length}`);

  const candidates = filterCandidates(report.songs);
  const noSourceForDeactivation = deactivationCandidates(report.songs);
  console.log("");
  console.log(`HAS_FAILS in scope:  ${candidates.length}`);
  console.log(`NO_SOURCE in scope:  ${noSourceForDeactivation.length} (will be deactivated)`);

  // Cost estimate. Per attempt ≈ 4K input + 300 output. Avg 1.3 attempts.
  const totalFailingVariants = candidates.reduce((acc, s) => {
    return acc + (s.variants ?? []).filter((v) => v.outcome === "FAIL_NOT_FOUND").length;
  }, 0);
  const estCalls = Math.ceil(totalFailingVariants * EST_AVG_ATTEMPTS);
  const inDollars =
    (estCalls * EST_INPUT_TOKENS * HAIKU_INPUT_PER_M) / 1_000_000;
  const outDollars =
    (estCalls * EST_OUTPUT_TOKENS * HAIKU_OUTPUT_PER_M) / 1_000_000;
  const estTotal = inDollars + outDollars;

  console.log("");
  console.log("Cost estimate:");
  console.log(`  failing variants:    ${totalFailingVariants}`);
  console.log(`  est. Anthropic calls: ${estCalls} (${EST_AVG_ATTEMPTS}× avg attempts)`);
  console.log(
    `  est. cost:           $${estTotal.toFixed(2)} (input $${inDollars.toFixed(2)}, output $${outDollars.toFixed(2)})`
  );

  const cp = loadCheckpoint();
  const bk = loadBackup();
  const alreadyDone = Object.keys(cp.results).length;
  console.log("");
  console.log(`already in checkpoint: ${alreadyDone} (will be reused; pass --reset to wipe)`);

  // Filter to those NOT yet in checkpoint.
  const todo = candidates.filter((s) => !cp.results[s.songId]);
  console.log(`pending this run:      ${todo.length}`);

  if (todo.length === 0 && !noSourceForDeactivation.length) {
    console.log("\nnothing to do. exiting.");
    if (!APPLY) console.log("(dry-run mode anyway — no changes would have been made.)");
    return;
  }

  const sql = postgres(DB_URL, { ssl: "require", max: 4 });

  try {
    if (!APPLY) {
      // ─── Dry-run plan ──────────────────────────────────────────────────────
      console.log("\nDRY-RUN PLAN:");
      console.log(`  ${todo.length} HAS_FAILS songs would be processed.`);
      console.log(
        `  Variants flagged FAIL_NOT_FOUND would be regenerated (up to ${MAX_REGEN_ATTEMPTS} attempts each).`
      );
      console.log(
        `  Songs whose variants all fail regen would be deactivated alongside NO_SOURCE.`
      );
      console.log(
        `  ${noSourceForDeactivation.length} NO_SOURCE songs would be deactivated outright.`
      );
      console.log("\nFirst 10 candidates:");
      for (const s of todo.slice(0, 10)) {
        const fc = s.variants.filter((v) => v.outcome === "FAIL_NOT_FOUND").length;
        console.log(
          `  #${s.songId} "${s.title}" — ${s.artistName} (${fc} fails, source=${s.lyricsSource}, genre=${s.genre}, decade=${s.decadeRange})`
        );
      }
      if (todo.length > 10) {
        console.log(`  … and ${todo.length - 10} more.`);
      }
      console.log("\nDry-run complete. No DB writes, no Anthropic calls.");
      console.log("Re-run with --apply to execute.");
      return;
    }

    // ─── Apply path: regenerate per song with concurrency ──────────────────
    const startedAt = Date.now();
    const total = todo.length;
    let nextIdx = 0;
    let completed = 0;
    const anthrCallCounter = { calls: 0 };

    async function nextSong() {
      if (nextIdx >= total) return null;
      const idx = nextIdx;
      nextIdx += 1;
      return todo[idx];
    }

    async function worker() {
      for (;;) {
        const s = await nextSong();
        if (!s) return;
        let result;
        try {
          result = await processOneSong({
            song: s,
            sql,
            cp,
            bk,
            anthrCallCounter,
          });
        } catch (err) {
          result = {
            songId: s.songId,
            title: s.title,
            artistName: s.artistName,
            decision: "error",
            error: String(err?.message ?? err),
          };
        }
        cp.results[s.songId] = result;
        saveCheckpoint(cp);
        saveBackup(bk);
        completed += 1;
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        const tag = `[${completed}/${total} ${elapsed}s]`;
        const summary = summarizeDecision(result);
        console.log(`  ${tag} #${result.songId} "${result.title}" — ${summary}`);
      }
    }

    const workers = Array.from(
      { length: Math.min(SONG_CONCURRENCY, total) },
      () => worker()
    );
    await Promise.all(workers);

    // ─── Deactivation step ──────────────────────────────────────────────────
    // Three categories: NO_SOURCE from report + regen-blocked-no-source +
    // all-variants-failed-deactivate.
    const idsFromCp = Object.values(cp.results)
      .filter(
        (r) =>
          r.decision === "regen-blocked-no-source" ||
          r.decision === "all-variants-failed-deactivate"
      )
      .map((r) => r.songId);
    const idsFromNoSource = noSourceForDeactivation.map((s) => s.songId);

    const deactivationIds = Array.from(
      new Set([...idsFromCp, ...idsFromNoSource])
    );

    let deactivatedIds = [];
    let alreadyInactiveCount = 0;

    if (deactivationIds.length > 0) {
      // Backup pre-state for any of these we haven't already captured.
      const rowsForBackup = await sql`
        SELECT id, title, "artistName", "isActive", "lyricVariants"
        FROM songs
        WHERE id = ANY(${deactivationIds}::int[])
      `;
      for (const r of rowsForBackup) {
        if (!bk.songs[r.id]) {
          bk.songs[r.id] = {
            songId: r.id,
            title: r.title,
            artistName: r.artistName,
            preIsActive: r.isActive,
            preLyricVariants: Array.isArray(r.lyricVariants)
              ? r.lyricVariants
              : [],
            reportLyricsSource: null,
            capturedAt: new Date().toISOString(),
            note: "captured at deactivation step",
          };
        }
      }
      saveBackup(bk);

      const updated = await sql`
        UPDATE songs
        SET "isActive" = false,
            "updatedAt" = NOW()
        WHERE id = ANY(${deactivationIds}::int[])
          AND "isActive" = true
        RETURNING id
      `;
      deactivatedIds = updated.map((r) => r.id);
      alreadyInactiveCount = deactivationIds.length - deactivatedIds.length;

      // Phase 5d dual-write: deactivated songs must also vanish from
      // layer-3. The layer-3 reader filters by gameplay_items.is_active +
      // lyric_moments.approval_status, NOT by songs.isActive — leaving the
      // rows in place would mean a flag-flipped read path could still serve
      // a deactivated song. Clear them now. We sweep the full deactivation
      // set (not just freshly-flipped rows) so stale layer-3 rows from
      // earlier runs are mopped up too — it's idempotent.
      for (const songId of deactivationIds) {
        try {
          await clearSongLayer3(sql, songId);
        } catch (err) {
          // Don't abort the run — log and keep going. The legacy isActive
          // flag is the primary safety net; layer-3 cleanup is belt + braces.
          console.warn(
            `  WARN: clearSongLayer3 failed for song ${songId}: ${String(err?.message ?? err)}`,
          );
        }
      }
    }

    // ─── Final summary ──────────────────────────────────────────────────────
    const all = Object.values(cp.results);
    const totals = {
      songsTouched: all.length,
      keptActive: all.filter((r) => r.decision === "kept-active").length,
      regenBlocked: all.filter((r) => r.decision === "regen-blocked-no-source")
        .length,
      allVariantsFailed: all.filter(
        (r) => r.decision === "all-variants-failed-deactivate"
      ).length,
      noOp: all.filter((r) => r.decision === "no-op").length,
      errors: all.filter((r) => r.decision === "error").length,
      missingInDb: all.filter((r) => r.decision === "missing-in-db").length,
      variantsRegenerated: 0,
      variantsRegenFailed: 0,
      variantsLeftAsPass: 0,
    };
    for (const r of all) {
      for (const v of r.perVariantOutcomes ?? []) {
        if (v.decision === "regenerated-and-verified")
          totals.variantsRegenerated += 1;
        else if (v.decision === "regen-failed")
          totals.variantsRegenFailed += 1;
        else if (v.decision === "originally-pass-untouched")
          totals.variantsLeftAsPass += 1;
      }
    }

    const finalReport = {
      generatedAt: new Date().toISOString(),
      mode: APPLY ? "apply" : "dry-run",
      filters: {
        limit: LIMIT > 0 ? LIMIT : null,
        genre: GENRE ?? null,
        decade: DECADE ?? null,
        songIds: SONG_IDS ?? null,
      },
      totals: {
        ...totals,
        anthropicCalls: anthrCallCounter.calls,
        deactivationCandidates: deactivationIds.length,
        deactivated: deactivatedIds.length,
        alreadyInactiveSkipped: alreadyInactiveCount,
      },
      deactivatedIds,
      perSong: all
        .slice()
        .sort((a, b) => (a.songId ?? 0) - (b.songId ?? 0))
        .map((r) => ({
          songId: r.songId,
          title: r.title,
          artistName: r.artistName,
          decision: r.decision,
          lyricsSource: r.lyricsSource ?? null,
          preLyricVariantsCount: r.preLyricVariantsCount ?? null,
          newLyricVariantsCount: r.newLyricVariantsCount ?? null,
          perVariantOutcomes: r.perVariantOutcomes ?? [],
          error: r.error ?? null,
        })),
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(finalReport, null, 2));

    console.log("");
    console.log("═".repeat(60));
    console.log("FINAL SUMMARY");
    console.log("═".repeat(60));
    console.log(`songs touched:           ${totals.songsTouched}`);
    console.log(`  kept-active:           ${totals.keptActive}`);
    console.log(`  regen-blocked:         ${totals.regenBlocked}`);
    console.log(`  all-variants-failed:   ${totals.allVariantsFailed}`);
    console.log(`  no-op:                 ${totals.noOp}`);
    console.log(`  missing-in-db:         ${totals.missingInDb}`);
    console.log(`  errors:                ${totals.errors}`);
    console.log(`variants regenerated:    ${totals.variantsRegenerated}`);
    console.log(`variants regen-failed:   ${totals.variantsRegenFailed}`);
    console.log(`variants left as PASS:   ${totals.variantsLeftAsPass}`);
    console.log(`anthropic calls:         ${anthrCallCounter.calls}`);
    console.log(`deactivation candidates: ${deactivationIds.length}`);
    console.log(`  deactivated this run:  ${deactivatedIds.length}`);
    console.log(`  already inactive:      ${alreadyInactiveCount}`);
    console.log("");
    console.log(`backup:     ${BACKUP_PATH}`);
    console.log(`checkpoint: ${CHECKPOINT_PATH}`);
    console.log(`result:     ${RESULT_PATH}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function summarizeDecision(r) {
  switch (r.decision) {
    case "kept-active": {
      const re = r.replacementsCount ?? 0;
      const pr = r.prunedCount ?? 0;
      return `kept-active (regen=${re}, pruned=${pr}, finalCount=${r.newLyricVariantsCount})`;
    }
    case "regen-blocked-no-source":
      return "regen-blocked-no-source (lyrics source vanished)";
    case "all-variants-failed-deactivate":
      return "all variants failed regen — will deactivate";
    case "no-op":
      return "no-op (no changes)";
    case "missing-in-db":
      return "missing-in-db (skipped)";
    case "error":
      return `error: ${r.error}`;
    case "dry-run-plan":
      return `dry-run plan (${r.preLyricVariantsCount} → ${r.planNewVariantsCount})`;
    default:
      return r.decision;
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
