// scripts/expand-library.mjs
// Phase 2b — expand the song library by +10 songs per (genre × decade) bucket.
//
// Per bucket flow:
//   1. Query existing songs in the bucket (genre + year range).
//   2. Ask Claude (Haiku) for 10 popular suggestions, excluding what we already have.
//   3. Verify each suggestion against MusicBrainz (serial, 1.1 s gap — 1 req/sec cap).
//   4. INSERT verified suggestions into `songs` with placeholder lyric fields.
//      `regenerate-lyrics.mjs` will fill prompt/answer/distractors later — it picks
//      these rows up automatically via WHERE isActive=true AND approvalStatus='approved'.
//
// Resumable via scripts/expand-library.checkpoint.json.
//
// Usage:
//   node scripts/expand-library.mjs                          # full run
//   node scripts/expand-library.mjs --resume                 # skip already-processed buckets
//   node scripts/expand-library.mjs --dry-run                # no DB writes
//   node scripts/expand-library.mjs --limit 2                # at most 2 buckets (smoke test)
//   node scripts/expand-library.mjs --genres "Pop,Rock"      # restrict genres
//   node scripts/expand-library.mjs --decades "1980s,1990s"  # restrict decades (short-form labels accepted)

import postgres from "postgres";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

dotenv.config();

// ─── Config ───────────────────────────────────────────────────────────────────
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

// maxRetries=8 mirrors regenerate-lyrics.mjs — gives the SDK enough budget to
// recover from per-minute rate-limit windows. The SDK respects retry-after.
const anthropic = new Anthropic({ maxRetries: 8 });
const MODEL = "claude-haiku-4-5-20251001";

const CHECKPOINT_PATH = path.resolve("scripts/expand-library.checkpoint.json");

// Canonical UI lists. Source of truth: client/src/pages/GameSetup.tsx.
// "Mixed" is a meta-selector that means all genres — we exclude it because
// every real song already lives in one of the concrete genres.
const ALL_GENRES = [
  "Country",
  "Hip Hop",
  "R&B",
  "Pop",
  "Rock",
  "Gospel",
  "Soul",
  "Jazz",
  "Blues",
  "Alternative",
  "Reggae",
];
const ALL_DECADES = [
  "1940–1950",
  "1950–1960",
  "1960–1970",
  "1970–1980",
  "1980–1990",
  "1990–2000",
  "2000–2010",
  "2010–2020",
  "2020–Present",
];

// MusicBrainz: 1 req/sec hard cap per client. 1100 ms gives us a comfort margin.
const MB_GAP_MS = 1100;
const MB_USER_AGENT = "LyricPro Ai/1.0 (deric@intentionai.ai)";

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
const DRY_RUN = getFlag("dry-run");
const RESUME = getFlag("resume");
const LIMIT = parseInt(getOpt("limit") ?? "0", 10);
const GENRE_FILTER = getOpt("genres");
const DECADE_FILTER = getOpt("decades");

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Convert a decade label ("1980–1990", "2020–Present") to {start, end} year range.
// Mirrors the parsing logic in server/routers/game.ts (lines 449-459):
// "1980–1990" covers 1980-1989 (end year is exclusive in label, inclusive after -1).
function decadeToRange(label) {
  const m = label.match(/(\d{4})[–-](\d{4}|Present)/);
  if (!m) throw new Error(`Bad decade label: ${label}`);
  const start = parseInt(m[1], 10);
  const endRaw =
    m[2] === "Present" ? new Date().getFullYear() + 1 : parseInt(m[2], 10);
  return { start, end: endRaw - 1 };
}

// Short-form label ("1980s") used as alt match in DB rows. game.ts derives this
// the same way at line 457.
function decadeShort(label) {
  return `${label.slice(0, 3)}0s`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Loose equality for MusicBrainz title/artist matching. Lower-case, strip
// non-alnum, then check substring containment in either direction.
function looseMatch(a, b) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// ─── Checkpoint ───────────────────────────────────────────────────────────────
function loadCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_PATH)) return { buckets: {} };
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8"));
  } catch {
    return { buckets: {} };
  }
}
function saveCheckpoint(cp) {
  const tmp = `${CHECKPOINT_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cp, null, 2));
  fs.renameSync(tmp, CHECKPOINT_PATH);
}
function bucketKey(genre, decade) {
  return `${genre}|${decade}`;
}

// ─── Claude tool ──────────────────────────────────────────────────────────────
const SUGGEST_TOOL = {
  name: "submit_suggestions",
  description:
    "Submit 10 popular song suggestions for the given genre and decade.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["suggestions"],
    properties: {
      suggestions: {
        type: "array",
        minItems: 10,
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "artist", "year"],
          properties: {
            title: { type: "string", description: "Song title." },
            artist: { type: "string", description: "Primary artist name." },
            year: {
              type: "integer",
              description: "Release year, must be inside the bucket range.",
            },
          },
        },
      },
    },
  },
};

function buildSuggestionPrompt(genre, range, exclusions) {
  const exclusionLines = exclusions
    .slice(0, 200) // hard cap to keep tokens reasonable
    .map((s) => `- "${s.title}" — ${s.artist}`)
    .join("\n");
  return `Genre: ${genre}
Year range: ${range.start}-${range.end}

We already have these songs (do NOT suggest any of them):
${exclusionLines || "(none)"}

Suggest 10 additional ${genre} songs released between ${range.start} and ${range.end} that are popular and well-known to average listeners. Avoid obscure deep cuts. Each suggestion's year must fall inside ${range.start}-${range.end}. Call submit_suggestions with the array.`;
}

const SUGGEST_SYSTEM = `You suggest popular, real, commercially released songs for a music trivia game. Each suggestion must be:
- a real song that was commercially released,
- not present in the exclusion list provided by the user,
- popular enough that average listeners would recognize the title or artist,
- released within the specified year range.
Avoid obscure deep cuts, demos, live-only tracks, or fan covers. Prefer songs that charted, won awards, or are widely cited as classics of the genre/era.`;

async function suggestSongs(genre, range, exclusions) {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SUGGEST_SYSTEM,
    tools: [SUGGEST_TOOL],
    tool_choice: { type: "tool", name: "submit_suggestions" },
    messages: [
      { role: "user", content: buildSuggestionPrompt(genre, range, exclusions) },
    ],
  });
  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("No tool_use block in suggestion response");
  return toolUse.input.suggestions;
}

// ─── MusicBrainz ──────────────────────────────────────────────────────────────
// Lucene-escape special chars inside a quoted phrase so we don't blow up the
// query parser on titles like "C.R.E.A.M." or "Don't Stop 'Til You Get Enough".
function mbEscape(s) {
  return s.replace(/[\\"]/g, "\\$&");
}

async function mbVerify(suggestion) {
  const titleQ = mbEscape(suggestion.title);
  const artistQ = mbEscape(suggestion.artist);
  const query = `recording:"${titleQ}" AND artist:"${artistQ}"`;
  const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(
    query,
  )}&fmt=json&limit=5`;

  let res;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": MB_USER_AGENT,
        Accept: "application/json",
      },
    });
  } catch (err) {
    return { verified: false, reason: `network: ${String(err)}` };
  }
  if (!res.ok) {
    return {
      verified: false,
      reason: `http ${res.status}`,
    };
  }

  let body;
  try {
    body = await res.json();
  } catch (err) {
    return { verified: false, reason: `parse: ${String(err)}` };
  }

  const recordings = body.recordings ?? [];
  if (recordings.length === 0) {
    return { verified: false, reason: "no MB recording match" };
  }

  // Walk candidates; first that satisfies title + artist + year(±2 or has-release) wins.
  let lastReason = "no candidate matched title+artist";
  for (const rec of recordings) {
    const titleOk = looseMatch(rec.title ?? "", suggestion.title);
    if (!titleOk) continue;
    const artistName = rec["artist-credit"]?.[0]?.name ?? "";
    const artistOk = looseMatch(artistName, suggestion.artist);
    if (!artistOk) continue;

    // Year check — prefer rec.releases[].date, fall back to rec["first-release-date"].
    const dates = [];
    if (rec["first-release-date"]) dates.push(rec["first-release-date"]);
    for (const r of rec.releases ?? []) {
      if (r.date) dates.push(r.date);
    }
    const years = dates
      .map((d) => parseInt(String(d).slice(0, 4), 10))
      .filter((y) => !isNaN(y));

    let yearOk = false;
    if (years.length === 0) {
      // No date data but recording exists with releases — accept (lenient).
      yearOk = (rec.releases?.length ?? 0) > 0;
    } else {
      yearOk = years.some((y) => Math.abs(y - suggestion.year) <= 2);
    }

    if (yearOk) {
      return {
        verified: true,
        canonicalTitle: rec.title ?? suggestion.title,
        canonicalArtist: artistName || suggestion.artist,
        mbYear: years[0],
      };
    }
    // Title + artist matched but year didn't — keep looking, but record reason.
    lastReason = `year mismatch (MB years=${years.join(",")} vs sugg=${suggestion.year})`;
  }

  return { verified: false, reason: lastReason };
}

// ─── Bucket processing ────────────────────────────────────────────────────────
async function processBucket(sql, genre, decadeLabel, cp) {
  const range = decadeToRange(decadeLabel);
  const key = bucketKey(genre, decadeLabel);
  const bucketResult = {
    genre,
    decade: decadeLabel,
    range,
    suggested: 0,
    verified: 0,
    inserted: 0,
    rejections: [],
    insertedRows: [],
  };

  // 1. Existing songs in bucket
  const existing = await sql`
    SELECT title, "artistName"
    FROM songs
    WHERE genre = ${genre}
      AND "releaseYear" >= ${range.start}
      AND "releaseYear" <= ${range.end}
  `;
  const exclusions = existing.map((r) => ({
    title: r.title,
    artist: r.artistName,
  }));

  // 2. Claude suggestions
  let suggestions;
  try {
    suggestions = await suggestSongs(genre, range, exclusions);
  } catch (err) {
    bucketResult.rejections.push({
      reason: `claude error: ${String(err)}`,
    });
    cp.buckets[key] = bucketResult;
    saveCheckpoint(cp);
    console.log(
      `[bucket] ${genre} / ${decadeLabel}: claude error — ${String(err)}`,
    );
    return bucketResult;
  }
  bucketResult.suggested = suggestions.length;

  // 3. MB verification (serial, 1.1 s gap)
  const verifiedList = [];
  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i];

    // Range guard — Claude occasionally drifts outside the requested window.
    if (s.year < range.start || s.year > range.end) {
      bucketResult.rejections.push({
        title: s.title,
        artist: s.artist,
        reason: `year ${s.year} outside bucket ${range.start}-${range.end}`,
      });
      continue;
    }

    // Skip MB call if we already have this title+artist (case-insensitive).
    const dup = exclusions.some(
      (e) => looseMatch(e.title, s.title) && looseMatch(e.artist, s.artist),
    );
    if (dup) {
      bucketResult.rejections.push({
        title: s.title,
        artist: s.artist,
        reason: "duplicate of existing bucket song",
      });
      continue;
    }

    const result = await mbVerify(s);
    if (result.verified) {
      verifiedList.push({
        title: result.canonicalTitle,
        artist: result.canonicalArtist,
        year: s.year, // keep Claude's year — within ±2 of MB
        mbYear: result.mbYear,
      });
    } else {
      bucketResult.rejections.push({
        title: s.title,
        artist: s.artist,
        reason: result.reason,
      });
    }

    // Rate-limit gap. Skip after the last one.
    if (i < suggestions.length - 1) await sleep(MB_GAP_MS);
  }
  bucketResult.verified = verifiedList.length;

  // 4. Insert
  if (!DRY_RUN && verifiedList.length > 0) {
    for (const v of verifiedList) {
      try {
        const inserted = await sql`
          INSERT INTO songs (
            title, "artistName", genre, "releaseYear", "decadeRange",
            "lyricPrompt", "lyricAnswer", distractors, "lyricSectionType",
            difficulty, "explicitFlag", "approvalStatus", "isActive"
          ) VALUES (
            ${v.title}, ${v.artist}, ${genre}, ${v.year}, ${decadeLabel},
            ${""}, ${""}, ${sql.json([])}, ${"chorus"},
            ${"medium"}, ${false}, ${"approved"}, ${true}
          )
          ON CONFLICT (title, "artistName") DO NOTHING
          RETURNING id
        `;
        if (inserted.length > 0) {
          bucketResult.inserted += 1;
          bucketResult.insertedRows.push({
            id: inserted[0].id,
            title: v.title,
            artist: v.artist,
            year: v.year,
          });
        } else {
          bucketResult.rejections.push({
            title: v.title,
            artist: v.artist,
            reason: "duplicate (title+artist exists in another bucket)",
          });
        }
      } catch (err) {
        bucketResult.rejections.push({
          title: v.title,
          artist: v.artist,
          reason: `insert error: ${String(err)}`,
        });
      }
    }
  } else if (DRY_RUN) {
    // Record what we WOULD have inserted, for the plan summary.
    bucketResult.insertedRows = verifiedList.map((v) => ({
      title: v.title,
      artist: v.artist,
      year: v.year,
      _dryRun: true,
    }));
  }

  cp.buckets[key] = bucketResult;
  saveCheckpoint(cp);

  console.log(
    `[bucket] ${genre} / ${decadeLabel}: suggested=${bucketResult.suggested} verified=${bucketResult.verified} inserted=${bucketResult.inserted}${DRY_RUN ? " (DRY RUN)" : ""}`,
  );

  return bucketResult;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Filter genres / decades by CLI flags.
  let genres = [...ALL_GENRES];
  let decades = [...ALL_DECADES];
  if (GENRE_FILTER) {
    const want = GENRE_FILTER.split(",").map((s) => s.trim());
    genres = genres.filter((g) => want.includes(g));
  }
  if (DECADE_FILTER) {
    const want = DECADE_FILTER.split(",").map((s) => s.trim());
    decades = decades.filter(
      (d) => want.includes(d) || want.includes(decadeShort(d)),
    );
  }

  // Build full bucket list (genre × decade).
  const allBuckets = [];
  for (const g of genres) {
    for (const d of decades) {
      allBuckets.push({ genre: g, decade: d });
    }
  }

  const cp = loadCheckpoint();
  const skipped = [];
  let pending = allBuckets;
  if (RESUME) {
    pending = allBuckets.filter((b) => {
      const done = cp.buckets[bucketKey(b.genre, b.decade)];
      if (done && typeof done.suggested === "number") {
        skipped.push(b);
        return false;
      }
      return true;
    });
  }
  if (LIMIT > 0) pending = pending.slice(0, LIMIT);

  // Cost / timing estimate banner.
  const claudeCalls = pending.length;
  const mbCalls = pending.length * 10;
  const mbMinutes = Math.ceil((mbCalls * MB_GAP_MS) / 1000 / 60);
  console.log("─".repeat(60));
  console.log(`expand-library — Phase 2b`);
  console.log(`  mode:       ${DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE"}`);
  console.log(`  buckets:    ${pending.length} pending (${allBuckets.length} total, ${skipped.length} skipped via --resume)`);
  console.log(`  genres:     ${genres.join(", ")}`);
  console.log(`  decades:    ${decades.join(", ")}`);
  console.log(`  claude:     ~${claudeCalls} calls (Haiku) ≈ $${(claudeCalls * 0.006).toFixed(2)}`);
  console.log(`  musicbrainz: ${mbCalls} calls @ ${MB_GAP_MS}ms = ~${mbMinutes} min minimum`);
  console.log(`  checkpoint: ${CHECKPOINT_PATH}`);
  console.log("─".repeat(60));

  if (pending.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const sql = postgres(DB_URL, { max: 4 });

  // Buckets are processed serially because MusicBrainz rate-limits per client.
  // Claude suggestion calls are also serial but lightweight; concurrency=2
  // wouldn't help here because the MB step dominates wall-clock per bucket.
  const results = [];
  for (const b of pending) {
    const r = await processBucket(sql, b.genre, b.decade, cp);
    results.push(r);
  }

  // Final report.
  const totalSuggested = results.reduce((a, r) => a + r.suggested, 0);
  const totalVerified = results.reduce((a, r) => a + r.verified, 0);
  const totalInserted = results.reduce((a, r) => a + r.inserted, 0);
  const allRejections = results.flatMap((r) => r.rejections);
  const reasonCounts = {};
  for (const rej of allRejections) {
    const key = rej.reason.split(":")[0].trim();
    reasonCounts[key] = (reasonCounts[key] ?? 0) + 1;
  }

  console.log("");
  console.log("═".repeat(60));
  console.log("FINAL REPORT");
  console.log("═".repeat(60));
  console.log(`buckets processed: ${results.length}`);
  console.log(`total suggested:   ${totalSuggested}`);
  console.log(`total verified:    ${totalVerified}`);
  console.log(`total inserted:    ${totalInserted}${DRY_RUN ? " (DRY RUN — no writes)" : ""}`);
  console.log(`total rejected:    ${allRejections.length}`);
  console.log("rejection reasons:");
  for (const [reason, n] of Object.entries(reasonCounts).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${n.toString().padStart(4, " ")} × ${reason}`);
  }
  console.log(`checkpoint: ${CHECKPOINT_PATH}`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
