# Lyric Question Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-author every song's lyric question so the prompt shows ~2/3 of the lyric and the multiple-choice answers are the last ~1/3, with stored per-song distractors that rhyme / fit the line. Also reweight the difficulty filter so verses dominate at medium/high while bridge and call-response remain occasional.

**Architecture:** One-shot migration script using the project's existing Forge LLM proxy (`BUILT_IN_FORGE_API_*`). Script writes results to a JSON checkpoint file first (resumable, reviewable) before committing to DB in a single transaction. New `distractors` jsonb column added to `songs`. Server's `getNextSong` is updated to read stored distractors instead of pulling random snippets from other songs, and the section-type filter is changed to a weighted random pick.

**Tech Stack:** Node.js (`.mjs`), `postgres` (already used in seed-large.mjs), Drizzle ORM, Forge OpenAI-compatible chat-completions endpoint, Zod for output validation.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `drizzle/schema.ts` | Add `distractors` jsonb column to `songs` table | Modify |
| `drizzle/migrations/<auto>_distractors.sql` | Generated SQL for the column add | Create (via `db:push`) |
| `scripts/regenerate-lyrics.mjs` | One-shot LLM-driven lyric rewriter; writes JSON checkpoint, resumable | Create |
| `scripts/regenerate-lyrics.checkpoint.json` | Output buffer (gitignored) | Create at runtime |
| `scripts/apply-lyrics-checkpoint.mjs` | Reads checkpoint and writes to DB in one transaction with backup table | Create |
| `server/routers/game.ts` | Update section-type filter to weighted pick; use stored distractors when present | Modify |
| `.gitignore` | Ignore checkpoint output file | Modify |

---

### Task 1: Add `distractors` column to songs schema

**Files:**
- Modify: `drizzle/schema.ts:192-220`

- [ ] **Step 1: Add the column to the songs table definition**

Find the `songs` pgTable definition at `drizzle/schema.ts:192` and add a `distractors` jsonb column after `lyricAnswer`:

```ts
import { jsonb } from "drizzle-orm/pg-core";
// ...
export const songs = pgTable("songs", {
  // ... existing columns ...
  lyricPrompt: text("lyricPrompt").notNull(),
  lyricAnswer: text("lyricAnswer").notNull(),
  distractors: jsonb("distractors").$type<string[]>(),  // NEW
  lyricSectionType: lyricSectionTypeEnum("lyricSectionType").notNull(),
  // ... rest unchanged ...
});
```

The column is nullable for now so existing rows don't break; the migration script populates it.

- [ ] **Step 2: Generate and apply the migration**

```bash
pnpm db:push
```

Expected: drizzle-kit generates a `*_distractors.sql` migration adding `distractors jsonb` to the `songs` table, then applies it. The dev server (running via tsx watch) will pick up the schema change on next request.

- [ ] **Step 3: Verify the column exists**

```bash
psql "$SUPABASE_DIRECT_CONNECTION_STRING" -c "\d songs" | grep distractors
```

Expected: a line like `distractors    | jsonb |   |   |` in the column list.

- [ ] **Step 4: Commit**

```bash
git add drizzle/schema.ts drizzle/migrations/
git commit -m "schema(songs): add distractors jsonb column"
```

---

### Task 2: Add gitignore entry for checkpoint file

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Append the checkpoint pattern**

Add to `.gitignore`:

```
# LLM rewrite checkpoint output (re-runnable, large)
scripts/regenerate-lyrics.checkpoint.json
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore lyric-rewrite checkpoint output"
```

---

### Task 3: Write the regeneration script (no DB writes)

**Files:**
- Create: `scripts/regenerate-lyrics.mjs`

This script reads every song from the DB, calls Forge per song to rewrite the lyric and generate 3 sensible distractors, and appends each result to a JSON checkpoint file. Resumable: re-running picks up where the last run left off by skipping IDs already in the checkpoint.

- [ ] **Step 1: Create the script**

```js
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
const CONCURRENCY = 6;       // parallel LLM calls
const LIMIT = parseInt(process.argv[2] ?? "0", 10);  // 0 = all; pass int to cap

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
```

- [ ] **Step 2: Smoke-test on 10 songs**

```bash
node scripts/regenerate-lyrics.mjs 10
```

Expected: prints "10 remaining; processing 10." followed by progress lines, then "Done." Checkpoint file written. No DB writes.

- [ ] **Step 3: Inspect output**

```bash
node -e "const cp=require('./scripts/regenerate-lyrics.checkpoint.json'); const sample=Object.values(cp.results).slice(0,5); console.log(JSON.stringify(sample,null,2));"
```

Expected: each entry has `original` (preserved) and `rewritten: { prompt, answer, distractors[3] }`. Manual check — do the distractors actually rhyme? Are answers ≤6 words? If quality is poor, iterate on the system prompt and re-run (the script will skip already-completed entries).

- [ ] **Step 4: Commit the script (not the checkpoint)**

```bash
git add scripts/regenerate-lyrics.mjs
git commit -m "scripts: add lyric rewrite migration script (Forge LLM, resumable, no DB writes)"
```

---

### Task 4: Run the full migration to produce the checkpoint

**Files:**
- None (operational step)

- [ ] **Step 1: Pause the dev server**

If the dev server is running (`pnpm dev`), leave it — it doesn't conflict, but the LLM run uses ~6 concurrent connections, so DB pool pressure is minor.

- [ ] **Step 2: Run the full migration**

```bash
node scripts/regenerate-lyrics.mjs
```

Expected runtime: ~25–40 minutes for ~2,420 songs at concurrency 6. Progress prints every 60 rows. Resumable — Ctrl+C and re-run is safe.

- [ ] **Step 3: Verify completion stats**

```bash
node -e "const cp=require('./scripts/regenerate-lyrics.checkpoint.json'); const r=Object.values(cp.results); const errs=r.filter(x=>x.error); console.log('total:',r.length,'errors:',errs.length); if (errs.length) console.log('sample errors:', errs.slice(0,3));"
```

Expected: `total: 2420, errors: 0` (or a small number — re-run the script to retry only failed rows since it skips successful ones).

- [ ] **Step 4: Spot-check 20 random results across genres**

```bash
node -e "
const cp=require('./scripts/regenerate-lyrics.checkpoint.json');
const r=Object.values(cp.results).filter(x=>!x.error);
for (let i=0;i<20;i++) {
  const s = r[Math.floor(Math.random()*r.length)];
  console.log('---');
  console.log(s.title, 'by', s.artist, '['+s.section+']');
  console.log('  PROMPT :', s.rewritten.prompt);
  console.log('  ANSWER :', s.rewritten.answer);
  console.log('  DISTRA :', s.rewritten.distractors.join(' | '));
}
"
```

Manually review: do the distractors rhyme/fit? Are answers reasonable lengths? If a substantial fraction (>10%) look bad, **STOP** and refine the system prompt in Task 3, delete the checkpoint, and re-run.

---

### Task 5: Write the apply-checkpoint script

**Files:**
- Create: `scripts/apply-lyrics-checkpoint.mjs`

This script reads the checkpoint and writes new `lyricPrompt`, `lyricAnswer`, and `distractors` to `songs` in a single transaction. It also creates a `songs_backup_pre_rewrite` table snapshot first so we can roll back.

- [ ] **Step 1: Create the script**

```js
// scripts/apply-lyrics-checkpoint.mjs
// Applies regenerate-lyrics.checkpoint.json to the songs table.
// Snapshots songs to songs_backup_pre_rewrite first (drop+recreate) for rollback.

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

const CHECKPOINT_PATH = path.resolve("scripts/regenerate-lyrics.checkpoint.json");
if (!fs.existsSync(CHECKPOINT_PATH)) {
  console.error("Checkpoint not found. Run regenerate-lyrics.mjs first.");
  process.exit(1);
}
const cp = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8"));
const successes = Object.values(cp.results).filter(r => !r.error && r.rewritten);
console.log(`Will apply ${successes.length} rewrites.`);

const sql = postgres(DB_URL, { max: 2 });

await sql`DROP TABLE IF EXISTS songs_backup_pre_rewrite`;
await sql`CREATE TABLE songs_backup_pre_rewrite AS SELECT * FROM songs`;
console.log("Backup table created: songs_backup_pre_rewrite");

await sql.begin(async (tx) => {
  for (const r of successes) {
    await tx`
      UPDATE songs
      SET "lyricPrompt" = ${r.rewritten.prompt},
          "lyricAnswer" = ${r.rewritten.answer},
          distractors  = ${JSON.stringify(r.rewritten.distractors)}::jsonb
      WHERE id = ${r.id}
    `;
  }
});
console.log(`Applied ${successes.length} rewrites in one transaction.`);

await sql.end();
```

- [ ] **Step 2: Run the apply script**

```bash
node scripts/apply-lyrics-checkpoint.mjs
```

Expected: prints `Backup table created: songs_backup_pre_rewrite` then `Applied N rewrites in one transaction.`

- [ ] **Step 3: Verify a few rows updated**

```bash
psql "$SUPABASE_DIRECT_CONNECTION_STRING" -c "SELECT id, \"lyricPrompt\", \"lyricAnswer\", distractors FROM songs ORDER BY random() LIMIT 5"
```

Expected: 5 rows showing rewritten prompts, answers, and 3-element JSON distractor arrays.

- [ ] **Step 4: Commit the script**

```bash
git add scripts/apply-lyrics-checkpoint.mjs
git commit -m "scripts: add apply-lyrics-checkpoint script with backup table"
```

---

### Task 6: Update `getNextSong` to use stored distractors and weighted section pick

**Files:**
- Modify: `server/routers/game.ts:322-325` (difficulty filter)
- Modify: `server/routers/game.ts:469-472` (lyric distractor source)

- [ ] **Step 1: Replace the difficulty filter with weighted picks**

Find lines 322-325 in `server/routers/game.ts`:

```ts
let difficultyFilter: ("chorus" | "hook" | "verse" | "call-response" | "bridge")[] = [];
if (room.difficulty === "low") difficultyFilter = ["chorus", "hook"];
else if (room.difficulty === "medium") difficultyFilter = ["chorus", "hook", "verse", "bridge"];
else difficultyFilter = ["verse", "call-response"];
```

Replace with:

```ts
// Section-type filter PLUS a weighted bias applied during the candidate pick.
// Low: hooks/choruses only. Medium/High: chorus + hook + verse dominant, with
// bridge and call-response as occasional picks (low weight).
type SectionType = "chorus" | "hook" | "verse" | "call-response" | "bridge";
let difficultyFilter: SectionType[];
let sectionWeights: Record<SectionType, number>;
if (room.difficulty === "low") {
  difficultyFilter = ["chorus", "hook"];
  sectionWeights = { chorus: 1, hook: 1, verse: 0, "call-response": 0, bridge: 0 };
} else if (room.difficulty === "medium") {
  difficultyFilter = ["chorus", "hook", "verse", "bridge", "call-response"];
  sectionWeights = { chorus: 1, hook: 1, verse: 3, bridge: 0.3, "call-response": 0.3 };
} else {
  difficultyFilter = ["chorus", "hook", "verse", "bridge", "call-response"];
  sectionWeights = { chorus: 1, hook: 1, verse: 3, bridge: 0.3, "call-response": 0.3 };
}
```

- [ ] **Step 2: Replace the random song pick with a weighted pick**

Find line 407: `const song = candidateSongs[Math.floor(Math.random() * candidateSongs.length)];`

Replace with:

```ts
// Weighted random pick: each candidate gets weight = sectionWeights[section].
// Songs whose section has weight 0 are excluded (matches the strict low filter).
const weighted = candidateSongs
  .map(s => ({ s, w: sectionWeights[(s.lyricSectionType as SectionType)] ?? 0 }))
  .filter(x => x.w > 0);
const totalWeight = weighted.reduce((acc, x) => acc + x.w, 0);
const pickPool = weighted.length > 0 ? weighted : candidateSongs.map(s => ({ s, w: 1 }));
const totalForPick = weighted.length > 0 ? totalWeight : pickPool.length;
let r = Math.random() * totalForPick;
let song = pickPool[0].s;
for (const x of pickPool) {
  r -= x.w;
  if (r <= 0) { song = x.s; break; }
}
```

- [ ] **Step 3: Use stored distractors when present**

Find line 472:

```ts
const lyricOptions = shuffle([song.lyricAnswer, ...pickDistractors(3, s => s.lyricAnswer, song.lyricAnswer)]);
```

Replace with:

```ts
// Prefer stored distractors authored alongside the song; fall back to the old
// other-song-snippet method for any rows not yet rewritten.
const stored = Array.isArray(song.distractors) ? song.distractors.filter(d => typeof d === "string" && d.length > 0) : [];
const lyricDistractors = stored.length >= 3
  ? stored.slice(0, 3)
  : [...stored, ...pickDistractors(3 - stored.length, s => s.lyricAnswer, song.lyricAnswer)];
const lyricOptions = shuffle([song.lyricAnswer, ...lyricDistractors]);
```

- [ ] **Step 4: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 5: Manually test in the running dev server**

Open http://localhost:3000/, log in, start a solo game on Medium difficulty. Verify:
- Most rounds use a verse (you should see ~50–60% verses across 10 rounds).
- A few rounds may surface bridges or call-response.
- The lyric multiple-choice options now look like rhyming/sensible distractors, not random snippets from unrelated songs.

- [ ] **Step 6: Commit**

```bash
git add server/routers/game.ts
git commit -m "feat(game): weighted section pick + use stored distractors"
```

---

### Task 7: Final verification

**Files:**
- None (verification step)

- [ ] **Step 1: Type-check the whole project**

```bash
pnpm exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 2: Run unit tests**

```bash
pnpm test
```

Expected: all tests pass. The scoring tests don't touch lyric content so they should be unaffected.

- [ ] **Step 3: Smoke-test 3 difficulties end-to-end**

Open the running app, play one round at Low / Medium / High and confirm the section distribution feels right and the multiple-choice options for the lyric look sensible.

- [ ] **Step 4: Note rollback path**

Document for the next session: if a regression is reported, restore from backup with:

```sql
TRUNCATE songs;
INSERT INTO songs SELECT * FROM songs_backup_pre_rewrite;
```

(After confidence is established, drop `songs_backup_pre_rewrite` to reclaim space.)

---

## Self-Review

**1. Spec coverage:**
- "2/3 prompt + 1/3 answer" → Task 3 system prompt enforces split.
- "≥6 words, looser for hook/chorus" → Task 3 system prompt explicitly relaxes for hook/chorus.
- "Distractors rhyme / fit verse sensibly" → Task 3 distractor instructions; Task 6 uses them at runtime.
- "More verses on medium/high" → Task 6 weights verse 3× chorus/hook.
- "Bridge & call-response occasional" → Task 6 weights them 0.3× (not dropped).

**2. Placeholders:** None — every step has runnable code or commands.

**3. Type consistency:** `SectionType`, `sectionWeights`, `distractors` jsonb column, all used consistently across Task 1, 5, and 6.

---

## Risks & Mitigations

- **LLM quality:** Forge's default model is `gemini-2.5-flash`. If a spot-check shows poor distractor quality, switch the script's `model` field to a stronger model (e.g., `claude-sonnet-4-6`). Iteration is cheap because the checkpoint file is the source of truth — re-running the script only touches missing/failed entries.
- **Lyric accuracy:** LLMs occasionally invent lyrics. The system prompt instructs it to reject inventions and use known lines, but a small fraction may still drift. The QA spot-check in Task 4 surfaces this; bad rows can be re-prompted by deleting them from the checkpoint and re-running.
- **DB migration safety:** Task 5 backs up the songs table before applying. Rollback is a single SQL block.
- **Mid-flight aborts:** All scripts are resumable (checkpoint-based). Apply step is single-transaction so a crash mid-apply rolls back cleanly.
