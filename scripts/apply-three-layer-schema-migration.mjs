// scripts/apply-three-layer-schema-migration.mjs
// Phase 5b — DDL: applies the three-layer content schema additions.
//
// Reads scripts/migrations/applied/2026-05-06-three-layer-schema.sql and
// executes the entire file as a single transaction (Postgres supports
// transactional DDL).
//
// Idempotent — every clause uses IF NOT EXISTS / DO $$ ... duplicate_object
// guards. Safe to re-run.
//
// Usage:
//   node scripts/apply-three-layer-schema-migration.mjs --dry-run
//   node scripts/apply-three-layer-schema-migration.mjs

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

const DRY_RUN =
  process.argv.includes("--dry-run") || process.argv.includes("--dry");

const SQL_FILE = path.resolve(
  "scripts/migrations/applied/2026-05-06-three-layer-schema.sql",
);

if (!fs.existsSync(SQL_FILE)) {
  console.error(`Missing SQL file: ${SQL_FILE}`);
  process.exit(1);
}

const ddlSource = fs.readFileSync(SQL_FILE, "utf8");

if (DRY_RUN) {
  console.log(`Dry-run. Would execute ${ddlSource.length} bytes of DDL from`);
  console.log(`  ${SQL_FILE}`);
  console.log("(single transaction; idempotent guards on every clause)");
  process.exit(0);
}

const sql = postgres(DB_URL, { max: 2 });

try {
  console.log("Applying three-layer schema migration in a single transaction ...");

  // We must split on top-level semicolons because postgres.js .unsafe()
  // executes one statement at a time. The DDL file uses DO $$ ... END $$
  // blocks which contain inner semicolons — those must NOT be treated as
  // statement boundaries. Strategy: split with a tiny tokenizer that tracks
  // dollar-quoted strings.
  const statements = splitSqlStatements(ddlSource);
  console.log(`  Parsed ${statements.length} top-level statements.`);

  await sql.begin(async (tx) => {
    for (const stmt of statements) {
      await tx.unsafe(stmt);
    }
  });

  console.log("DDL applied. Running post-apply verification ...");

  // Sanity SELECTs — confirm the new tables exist and the new columns landed.
  const [{ count: lmCount }] =
    await sql`SELECT COUNT(*)::int AS count FROM "lyric_moments"`;
  const [{ count: giCount }] =
    await sql`SELECT COUNT(*)::int AS count FROM "gameplay_items"`;
  const [songsColCheck] = await sql`
    SELECT COUNT(*)::int AS new_col_count
    FROM information_schema.columns
    WHERE table_name = 'songs'
      AND column_name IN (
        'featured_artist', 'licensing_status', 'approved_for_game',
        'in_curated_bank', 'curator_notes'
      )
  `;
  const [{ count: nullableSongCount }] = await sql`
    SELECT COUNT(*)::int AS count FROM "songs" WHERE "featured_artist" IS NULL
  `;
  const [{ count: defaultedSongCount }] = await sql`
    SELECT COUNT(*)::int AS count FROM "songs" WHERE "in_curated_bank" = false
  `;

  console.log(`  lyric_moments rows:                 ${lmCount}`);
  console.log(`  gameplay_items rows:                ${giCount}`);
  console.log(`  new songs columns present:          ${songsColCheck.new_col_count} / 5`);
  console.log(`  songs with featured_artist IS NULL: ${nullableSongCount}`);
  console.log(`  songs with in_curated_bank = false: ${defaultedSongCount}`);

  if (songsColCheck.new_col_count !== 5) {
    throw new Error(
      `Expected 5 new columns on songs; found ${songsColCheck.new_col_count}`,
    );
  }

  console.log("DDL verification passed.");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
//
// Split SQL into statements while respecting:
//   - dollar-quoted blocks: $$ ... $$ or $tag$ ... $tag$
//   - line comments: -- to end of line
//   - block comments: /* ... */
//   - single-quoted strings: '...' (with '' escapes)
//   - double-quoted identifiers: "..." (with "" escapes)
function splitSqlStatements(src) {
  const out = [];
  let buf = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    // Line comment
    if (c === "-" && c2 === "-") {
      while (i < n && src[i] !== "\n") {
        buf += src[i++];
      }
      continue;
    }
    // Block comment
    if (c === "/" && c2 === "*") {
      buf += src[i++];
      buf += src[i++];
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        buf += src[i++];
      }
      if (i < n) {
        buf += src[i++];
        buf += src[i++];
      }
      continue;
    }
    // Single-quoted string
    if (c === "'") {
      buf += src[i++];
      while (i < n) {
        if (src[i] === "'" && src[i + 1] === "'") {
          buf += src[i++];
          buf += src[i++];
          continue;
        }
        if (src[i] === "'") {
          buf += src[i++];
          break;
        }
        buf += src[i++];
      }
      continue;
    }
    // Double-quoted identifier
    if (c === '"') {
      buf += src[i++];
      while (i < n) {
        if (src[i] === '"' && src[i + 1] === '"') {
          buf += src[i++];
          buf += src[i++];
          continue;
        }
        if (src[i] === '"') {
          buf += src[i++];
          break;
        }
        buf += src[i++];
      }
      continue;
    }
    // Dollar-quoted block: $tag$ ... $tag$
    if (c === "$") {
      // Read tag: $ optional_word $
      const tagMatch = src.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        buf += tag;
        i += tag.length;
        const closeIdx = src.indexOf(tag, i);
        if (closeIdx === -1) {
          // unterminated; just consume the rest
          buf += src.slice(i);
          i = n;
        } else {
          buf += src.slice(i, closeIdx + tag.length);
          i = closeIdx + tag.length;
        }
        continue;
      }
    }
    // Statement terminator
    if (c === ";") {
      const trimmed = buf.trim();
      if (trimmed.length > 0) out.push(trimmed);
      buf = "";
      i++;
      continue;
    }
    buf += src[i++];
  }
  const tail = buf.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}
