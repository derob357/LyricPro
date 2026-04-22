// Regenerate exports/song-library-matrix.xlsx from the live Supabase songs
// table. Writes a workbook with two sheets:
//   "Matrix"  — genre × decade counts (Billboard-style target: ≥30 per cell)
//   "Songs"   — flat listing of approved, active songs
//
// Run: node scripts/export-matrix.mjs

import "dotenv/config";
import postgres from "postgres";
import XLSX from "xlsx";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("Missing SUPABASE_SESSION_POOLER_STRING in .env");
  process.exit(1);
}
const sql = postgres(DB_URL, { max: 1, prepare: false });

const DECADES = ["pre-70s", "70s", "80s", "90s", "00s", "10s", "20s"];
const decadeOf = (y) =>
  y < 1970 ? "pre-70s" :
  y < 1980 ? "70s" :
  y < 1990 ? "80s" :
  y < 2000 ? "90s" :
  y < 2010 ? "00s" :
  y < 2020 ? "10s" : "20s";

const rows = await sql`
  SELECT "title", "artistName", "genre", "releaseYear", "difficulty",
         "lyricSectionType"
  FROM songs
  WHERE "isActive" = true AND "approvalStatus" = 'approved'
  ORDER BY "genre", "releaseYear", "artistName", "title"
`;

// ── Matrix sheet ────────────────────────────────────────────────────────────
const genres = [...new Set(rows.map((r) => r.genre))].sort();
const grid = {};
for (const g of genres) {
  grid[g] = Object.fromEntries(DECADES.map((d) => [d, 0]));
}
for (const r of rows) grid[r.genre][decadeOf(r.releaseYear)]++;

const matrixAoA = [["Genre", ...DECADES, "Total"]];
for (const g of genres) {
  const counts = DECADES.map((d) => grid[g][d]);
  const total = counts.reduce((s, n) => s + n, 0);
  matrixAoA.push([g, ...counts, total]);
}
// Column totals
const colTotals = DECADES.map((d) => genres.reduce((s, g) => s + grid[g][d], 0));
matrixAoA.push(["Total", ...colTotals, rows.length]);

const matrixSheet = XLSX.utils.aoa_to_sheet(matrixAoA);

// ── Songs sheet ─────────────────────────────────────────────────────────────
const songsSheet = XLSX.utils.json_to_sheet(
  rows.map((r) => ({
    genre: r.genre,
    decade: decadeOf(r.releaseYear),
    year: r.releaseYear,
    title: r.title,
    artist: r.artistName,
    difficulty: r.difficulty,
    section: r.lyricSectionType,
  }))
);

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, matrixSheet, "Matrix");
XLSX.utils.book_append_sheet(wb, songsSheet, "Songs");

const outPath = "exports/song-library-matrix.xlsx";
mkdirSync(dirname(outPath), { recursive: true });
const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
writeFileSync(outPath, buf);

console.log(`Wrote ${outPath}`);
console.log(`Total approved songs: ${rows.length}`);
console.log(`Genres: ${genres.length}, decades: ${DECADES.length}`);

await sql.end();
