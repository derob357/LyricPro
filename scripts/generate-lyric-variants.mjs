// scripts/generate-lyric-variants.mjs
// Per-song lyric-variant generator. For each approved+active song, asks
// Claude to produce 2 ADDITIONAL variants of the question (different lines
// from the song than the seed) and writes the composed array
// [seed, ...additional_variants] to songs.lyricVariants (jsonb).
//
// Skips songs that already have 3+ variants stored. Idempotent. Writes a
// checkpoint after each song so restarts skip done work.
//
// Usage:
//   node scripts/generate-lyric-variants.mjs --dry-run        # plan only
//   node scripts/generate-lyric-variants.mjs --dry-run 5      # smoke plan
//   node scripts/generate-lyric-variants.mjs --limit 10       # smoke real
//   node scripts/generate-lyric-variants.mjs                  # full run
//
// Cost: 1 Claude Haiku 4.5 call per song. Run intentionally — invocation is
// guarded by an explicit non-dry-run flag and checkpoint resumes prior runs.

import postgres from "postgres";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

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

// maxRetries=8 mirrors regenerate-lyrics.mjs — gives the SDK enough budget
// to ride out per-minute rate-limit windows on the org's Haiku quota.
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ maxRetries: 8 })
  : null;
const MODEL = "claude-haiku-4-5-20251001";

const CHECKPOINT_PATH = path.resolve(
  "scripts/generate-lyric-variants.checkpoint.json"
);
// Concurrency 2 stays under the 50 req/min org cap. Higher caused ~32%
// rate-limit failures during the regenerate-lyrics run.
const CONCURRENCY = 2;

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

1. Use REAL, well-known lyrics from the named song. Do NOT invent. If you don't know the song well, leave the variant set short rather than hallucinate — but the tool requires exactly 2.
2. Each new variant must come from a DIFFERENT line of the song than the seed AND from the other new variant. Three distinct lines total.
3. Split each chosen line into prompt (first ~1/2 of the words) + answer (last ~1/2). Keep the answer to 1-6 words.
4. Generate 3 distractors per variant that:
   - rhyme or near-rhyme with the actual answer,
   - fit the song's genre, register, and era,
   - are NOT the actual answer or trivial variants of it,
   - are plausible enough that a casual listener might believe them.
5. sectionType must be one of: chorus | hook | verse | bridge | call-response. Choose the one that best describes where the line appears in the song's structure.`;

function buildUserMessage(song, seed) {
  return `Song: "${song.title}" by ${song.artistName} (${song.releaseYear}, ${song.genre})

Seed variant (already in production — DO NOT REPEAT this line):
  prompt:  "${seed.prompt}"
  answer:  "${seed.answer}"
  section: ${seed.sectionType}

Generate 2 additional variants from DIFFERENT lines of this song. Call submit_variants.`;
}

async function callClaude(song, seed) {
  if (!anthropic) throw new Error("Anthropic client not initialized (dry-run?)");
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "submit_variants" },
    messages: [{ role: "user", content: buildUserMessage(song, seed) }],
  });
  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("No tool_use block in response");
  return toolUse.input;
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

async function processSong(sql, song, cp) {
  const seed = seedFromSong(song);
  try {
    const result = await callClaude(song, seed);
    const additional = result.additional_variants ?? [];
    const composed = [seed, ...additional];
    if (!DRY_RUN) {
      await sql`
        UPDATE songs
        SET "lyricVariants" = ${JSON.stringify(composed)}::jsonb
        WHERE id = ${song.id}
      `;
    }
    cp.results[song.id] = {
      id: song.id,
      title: song.title,
      artist: song.artistName,
      seed,
      additional,
      composed_count: composed.length,
      wrote_db: !DRY_RUN,
    };
  } catch (err) {
    cp.results[song.id] = { id: song.id, error: String(err) };
  }
}

async function processBatch(sql, songs, cp) {
  await Promise.all(songs.map((s) => processSong(sql, s, cp)));
  saveCheckpoint(cp);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const sql = postgres(DB_URL, { max: 4 });
  const cp = loadCheckpoint();
  console.log(
    `Mode: ${DRY_RUN ? "DRY-RUN (no DB writes, no LLM calls if --dry-run is the only flag)" : "LIVE"}`
  );
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
    await sql.end();
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
  const todo = allSongs.filter((s) => {
    if (cp.results[s.id] && !cp.results[s.id].error) return false;
    const v = s.lyricVariants;
    if (Array.isArray(v) && v.length >= 3) return false;
    return true;
  });
  const slice = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
  console.log(
    `${allSongs.length} total approved+active. ${todo.length} need variants. Processing ${slice.length}.`
  );

  if (DRY_RUN) {
    // In dry-run we don't actually call the LLM — just print the plan.
    console.log("\nPlan (first 10 of slice):");
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
      `\nDry-run complete. ${slice.length} songs would receive 2 LLM-generated variants each.`
    );
    await sql.end();
    return;
  }

  let processed = 0;
  for (let i = 0; i < slice.length; i += CONCURRENCY) {
    const batch = slice.slice(i, i + CONCURRENCY);
    await processBatch(sql, batch, cp);
    processed += batch.length;
    if (processed % 60 === 0 || processed === slice.length) {
      console.log(`  ${processed}/${slice.length}`);
    }
  }

  await sql.end();
  console.log(`Done. Checkpoint at ${CHECKPOINT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
