// scripts/regenerate-lyrics.mjs
// One-shot rewriter. For each song, asks the Forge LLM to:
//   - Reconstruct the original lyric line as ≥6 words (relaxed for hook/chorus).
//   - Split it into prompt (first ~2/3) + answer (last ~1/3).
//   - Generate 3 distractors that rhyme with the answer and fit the meter/genre.
// Writes results to scripts/regenerate-lyrics.checkpoint.json. DB is NOT touched.

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

const FORGE_URL = (process.env.BUILT_IN_FORGE_API_URL ?? "").replace(/\/$/, "");
const FORGE_KEY = process.env.BUILT_IN_FORGE_API_KEY;
if (!FORGE_URL || !FORGE_KEY) {
  console.error("Set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY in .env");
  process.exit(1);
}
const FORGE_ENDPOINT = `${FORGE_URL}/v1/chat/completions`;

const CHECKPOINT_PATH = path.resolve("scripts/regenerate-lyrics.checkpoint.json");
const CONCURRENCY = 6;
const LIMIT = parseInt(process.argv[2] ?? "0", 10);

const SCHEMA = {
  name: "lyric_rewrite",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["prompt", "answer", "distractors"],
    properties: {
      prompt: { type: "string", description: "Visible part of the lyric (first ~2/3)." },
      answer: { type: "string", description: "Hidden part of the lyric (last ~1/3)." },
      distractors: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: { type: "string" },
        description: "Three wrong endings that rhyme with answer and could plausibly finish the line.",
      },
    },
  },
  strict: true,
};

function buildMessages(song) {
  const sysPrompt = `You rewrite trivia questions for a music app. For the given song, output a JSON object that:
1. Reconstructs the actual lyric line. If the original snippet is short (e.g. just "yourself"), expand to a complete, well-known line (≥6 words) when the section is "verse" or "bridge"; for "hook" or "chorus" you may leave shorter iconic phrases as-is.
2. Splits it as prompt (first ~2/3 of the words) + answer (last ~1/3 of the words). Word count split is approximate; keep the answer to 1-6 words.
3. Generates 3 distractors that:
   - rhyme (or near-rhyme) with the actual answer,
   - fit the song's genre, register, and era,
   - are NOT the actual answer or trivial variants of it,
   - are plausible enough that a casual listener might believe them.

Return ONLY the JSON. Use real, well-known lyrics — do not invent. If you don't know the song, return your best inference based on title and artist style.`;

  const userPrompt = `Song: "${song.title}" by ${song.artistName} (${song.releaseYear}, ${song.genre}, ${song.lyricSectionType})
Current snippet shown to player: "${song.lyricPrompt}"
Current expected answer: "${song.lyricAnswer}"

Rewrite per the rules.`;

  return [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];
}

async function callForge(song) {
  const body = {
    model: "gemini-2.5-flash",
    messages: buildMessages(song),
    max_tokens: 1024,
    response_format: { type: "json_schema", json_schema: SCHEMA },
  };
  const res = await fetch(FORGE_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${FORGE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Forge ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("No content in response");
  return JSON.parse(content);
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
  await Promise.all(songs.map(async (song) => {
    try {
      const result = await callForge(song);
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
  }));
  saveCheckpoint(cp);
}

async function main() {
  const sql = postgres(DB_URL, { max: 4 });
  const cp = loadCheckpoint();
  console.log(`Loaded ${Object.keys(cp.results).length} prior results from checkpoint.`);

  const allSongs = await sql`
    SELECT id, title, "artistName", "releaseYear", genre, "lyricPrompt", "lyricAnswer", "lyricSectionType"
    FROM songs
    WHERE "isActive" = true AND "approvalStatus" = 'approved'
    ORDER BY id ASC
  `;
  const todo = allSongs.filter(s => !cp.results[s.id]);
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

main().catch(err => {
  console.error(err);
  process.exit(1);
});
