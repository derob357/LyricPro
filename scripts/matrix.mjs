import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.SUPABASE_SESSION_POOLER_STRING, { max: 1, prepare: false });
const rows = await sql`
  SELECT genre,
    CASE
      WHEN "releaseYear" < 1970 THEN 'pre-70s'
      WHEN "releaseYear" < 1980 THEN '70s'
      WHEN "releaseYear" < 1990 THEN '80s'
      WHEN "releaseYear" < 2000 THEN '90s'
      WHEN "releaseYear" < 2010 THEN '00s'
      WHEN "releaseYear" < 2020 THEN '10s'
      ELSE '20s'
    END AS decade,
    COUNT(*)::int AS count
  FROM songs
  WHERE "approvalStatus" = 'approved'
  GROUP BY genre, decade
  ORDER BY genre, decade
`;
const decades = ['pre-70s','70s','80s','90s','00s','10s','20s'];
const genres = [...new Set(rows.map(r=>r.genre))].sort();
const grid = {};
for (const g of genres) grid[g] = Object.fromEntries(decades.map(d=>[d,0]));
for (const r of rows) grid[r.genre][r.decade] = r.count;
console.log('Genre'.padEnd(12), decades.map(d=>d.padStart(7)).join(' '));
for (const g of genres) {
  const line = decades.map(d => {
    const c = grid[g][d];
    const mark = c >= 30 ? ' ' : '*';
    return (c.toString()+mark).padStart(7);
  }).join(' ');
  console.log(g.padEnd(12), line);
}
console.log('\n* = below 30');
await sql.end();
