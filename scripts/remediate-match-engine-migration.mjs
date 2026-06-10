// scripts/remediate-match-engine-migration.mjs
// Incident remediation: 0016 triggers committed but 0015 rolled back (its unique
// index failed on 2 pre-existing duplicate round_results rows), leaving the
// game_rooms_broadcast trigger referencing a non-existent "roundPhase" column —
// which breaks every game_rooms UPDATE. This script runs each statement with
// AUTOCOMMIT (no wrapping transaction) so the column-add (the un-break) commits
// even if the later dedup/index step were to fail. Idempotent.
import postgres from "postgres";
import dotenv from "dotenv";
dotenv.config();
const DB_URL = process.env.SUPABASE_SESSION_POOLER_STRING ?? process.env.SUPABASE_DIRECT_CONNECTION_STRING ?? process.env.DATABASE_URL;
if (!DB_URL) { console.error("No DB URL in env"); process.exit(1); }
const sql = postgres(DB_URL, { max: 1, prepare: false });
try {
  // Step A — un-break: create the enum + columns the trigger references.
  console.log("A: creating round_phase type + columns ...");
  await sql.unsafe(`DO $$ BEGIN CREATE TYPE round_phase AS ENUM ('in_question','intermission','complete'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`).simple();
  await sql.unsafe(`ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS "roundPhase" round_phase;`);
  await sql.unsafe(`ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS "roundEndsAt" timestamptz;`);
  console.log("A: done — game_rooms_broadcast trigger is now valid (prod un-broken).");

  // Step B — dedupe the 2 offending groups, keeping the earliest row id.
  console.log("B: deduping round_results ...");
  const del = await sql.unsafe(`
    DELETE FROM round_results a USING round_results b
    WHERE a."roomId" IS NOT NULL AND a."activePlayerId" IS NOT NULL
      AND a."roomId"=b."roomId" AND a."roundNumber"=b."roundNumber" AND a."activePlayerId"=b."activePlayerId"
      AND a.id > b.id;`);
  console.log(`B: deleted ${del.count ?? 0} duplicate row(s).`);

  // Step C — create the partial unique index.
  console.log("C: creating unique index ...");
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS round_results_room_round_player_uq ON round_results ("roomId","roundNumber","activePlayerId") WHERE "roomId" IS NOT NULL AND "activePlayerId" IS NOT NULL;`);
  console.log("C: done.");

  // Verify
  const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='game_rooms' AND column_name IN ('roundPhase','roundEndsAt') ORDER BY column_name`;
  const idx = await sql`SELECT indexname FROM pg_indexes WHERE indexname='round_results_room_round_player_uq'`;
  const dupTotal = await sql`SELECT count(*) c FROM (SELECT 1 FROM round_results WHERE "roomId" IS NOT NULL AND "activePlayerId" IS NOT NULL GROUP BY "roomId","roundNumber","activePlayerId" HAVING count(*)>1) x`;
  console.log(`VERIFY: columns=[${cols.map(c=>c.column_name).join(", ")}] index=${idx.length?"yes":"no"} remaining_dups=${Number(dupTotal[0].c)}`);
} catch (e) { console.error("REMEDIATION ERROR:", e.message); process.exit(1); } finally { await sql.end(); }
