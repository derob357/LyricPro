// scripts/regenerate-lyrics.mjs
// One-shot rewriter. For each song, asks Claude to:
//   - Reconstruct the original lyric line as ≥6 words (relaxed for hook/chorus).
//   - Split it into prompt (first ~2/3) + answer (last ~1/3).
//   - Generate 3 distractors that rhyme with the answer and fit the meter/genre.
// Writes results to scripts/regenerate-lyrics.checkpoint.json. DB is NOT touched.
//
// Usage:
//   node scripts/regenerate-lyrics.mjs           # process all remaining songs
//   node scripts/regenerate-lyrics.mjs 10        # process at most 10 (smoke test)

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

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY in .env");
  process.exit(1);
}

// maxRetries=8 gives the SDK enough budget to recover from per-minute rate
// limit windows (org cap ~50 req/min on this model). The SDK respects the
// `retry-after` header from 429 responses, so retries wait the full window.
const anthropic = new Anthropic({ maxRetries: 8 });
const MODEL = "claude-haiku-4-5-20251001";

const CHECKPOINT_PATH = path.resolve("scripts/regenerate-lyrics.checkpoint.json");
// Concurrency lowered to 2 to stay under the 50 req/min org cap. Combined with
// SDK retries this is sustainable; pushing higher caused ~32% rate-limit fails.
const CONCURRENCY = 2;
const LIMIT = parseInt(process.argv[2] ?? "0", 10);

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
        description: "Visible part of the lyric (first ~2/3 of the line).",
      },
      answer: {
        type: "string",
        description: "Hidden part of the lyric (last ~1/3 of the line, 1-6 words).",
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
2. Split the line into prompt (first ~2/3 of the words) + answer (last ~1/3 of the words). The split is approximate; keep the answer to 1-6 words.
3. Generate 3 distractors that:
   - rhyme (or near-rhyme) with the actual answer,
   - fit the song's genre, register, and era,
   - are NOT the actual answer or trivial variants of it,
   - are plausible enough that a casual listener might believe them.

Use real, well-known lyrics — do not invent. If you don't know the song, infer from title and artist style.`;

function buildUserMessage(song) {
  return `Song: "${song.title}" by ${song.artistName} (${song.releaseYear}, ${song.genre}, ${song.lyricSectionType})
Current snippet shown to player: "${song.lyricPrompt}"
Current expected answer: "${song.lyricAnswer}"

Rewrite per the rules and call submit_rewrite.`;
}

async function callClaude(song) {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "submit_rewrite" },
    messages: [{ role: "user", content: buildUserMessage(song) }],
  });

  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("No tool_use block in response");
  return toolUse.input;
}

function loadCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_PATH)) return { results: {} };
  return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8"));
}

function saveCheckpoint(cp) {
  const tmp = `${CHECKPOINT_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cp, null, 2));
  fs.renameSync(tmp, CHECKPOINT_PATH);
}

async function processBatch(songs, cp) {
  await Promise.all(
    songs.map(async (song) => {
      try {
        const result = await callClaude(song);
        cp.results[song.id] = {
          id: song.id,
          title: song.title,
          artist: song.artistName,
          section: song.lyricSectionType,
          original: { prompt: song.lyricPrompt, answer: song.lyricAnswer },
          rewritten: result,
        };
      } catch (err) {
        cp.results[song.id] = { id: song.id, error: String(err) };
      }
    })
  );
  saveCheckpoint(cp);
}

async function main() {
  const sql = postgres(DB_URL, { max: 4 });
  const cp = loadCheckpoint();
  console.log(
    `Loaded ${Object.keys(cp.results).length} prior results from checkpoint.`
  );

  const allSongs = await sql`
    SELECT id, title, "artistName", "releaseYear", genre, "lyricPrompt", "lyricAnswer", "lyricSectionType"
    FROM songs
    WHERE "isActive" = true AND "approvalStatus" = 'approved'
    ORDER BY id ASC
  `;
  const todo = allSongs.filter((s) => !cp.results[s.id]);
  const slice = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
  console.log(`${todo.length} remaining; processing ${slice.length}.`);

  let processed = 0;
  for (let i = 0; i < slice.length; i += CONCURRENCY) {
    const batch = slice.slice(i, i + CONCURRENCY);
    await processBatch(batch, cp);
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
