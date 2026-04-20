import mysql from "mysql2/promise";
import { readFileSync } from "fs";

const db = await mysql.createConnection(process.env.DATABASE_URL);
const songs = JSON.parse(readFileSync("/home/ubuntu/merged_songs.json", "utf8"));

console.log(`Seeding ${songs.length} songs...`);

let inserted = 0;
let skipped = 0;

for (const song of songs) {
  const {
    title,
    artistName,
    lyricPrompt,
    lyricAnswer,
    releaseYear,
    decade,
    difficulty,
    genre,
  } = song;

  // Validate required fields
  if (!title || !artistName || !lyricPrompt || !lyricAnswer || !releaseYear) {
    skipped++;
    continue;
  }

  // Map difficulty to enum values the DB accepts
  const diffMap = { easy: "low", medium: "medium", hard: "high" };
  const dbDifficulty = diffMap[difficulty] || "medium";

  // Compute decadeRange from decade string or releaseYear
  let decadeRange = decade || "";
  if (!decadeRange && releaseYear) {
    const d = Math.floor(Number(releaseYear) / 10) * 10;
    decadeRange = `${d}s`;
  }

  try {
    await db.execute(
      `INSERT IGNORE INTO songs
        (title, artistName, lyricPrompt, lyricAnswer, releaseYear, decadeRange, difficulty, genre, approvalStatus, isActive, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', 1, NOW(), NOW())`,
      [
        String(title).slice(0, 255),
        String(artistName).slice(0, 255),
        String(lyricPrompt).slice(0, 500),
        String(lyricAnswer).slice(0, 500),
        Number(releaseYear),
        String(decadeRange).slice(0, 32),
        dbDifficulty,
        String(genre).slice(0, 64),
      ]
    );
    inserted++;
  } catch (err) {
    console.error(`Failed to insert "${title}" by ${artistName}:`, err.message);
    skipped++;
  }
}

await db.end();
console.log(`Done. Inserted: ${inserted}, Skipped/Duplicate: ${skipped}`);

// Print final count
const conn2 = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn2.execute("SELECT genre, COUNT(*) as cnt FROM songs WHERE isActive=1 GROUP BY genre ORDER BY cnt DESC");
console.log("\nSong counts by genre:");
for (const row of rows) {
  console.log(`  ${row.genre}: ${row.cnt}`);
}
const [total] = await conn2.execute("SELECT COUNT(*) as total FROM songs WHERE isActive=1");
console.log(`\nTotal active songs: ${total[0].total}`);
await conn2.end();
