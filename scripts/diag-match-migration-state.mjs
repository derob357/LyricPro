// scripts/diag-match-migration-state.mjs — READ-ONLY diagnostic. No writes.
import postgres from "postgres";
import dotenv from "dotenv";
dotenv.config();
const DB_URL = process.env.SUPABASE_SESSION_POOLER_STRING ?? process.env.SUPABASE_DIRECT_CONNECTION_STRING ?? process.env.DATABASE_URL;
if (!DB_URL) { console.error("No DB URL"); process.exit(1); }
const sql = postgres(DB_URL, { max: 1, prepare: false });
try {
  const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='game_rooms' AND column_name IN ('roundPhase','roundEndsAt','currentQuestion') ORDER BY column_name`;
  console.log("game_rooms new columns:", cols.map(c => c.column_name).join(", ") || "(none)");
  const trg = await sql`SELECT tgname FROM pg_trigger WHERE tgname IN ('game_rooms_broadcast_trg','round_results_broadcast_trg') ORDER BY tgname`;
  console.log("match triggers present:", trg.map(t => t.tgname).join(", ") || "(none)");
  const fns = await sql`SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ('game_rooms_broadcast','round_results_broadcast') ORDER BY proname`;
  console.log("match trigger fns present:", fns.map(f => f.proname).join(", ") || "(none)");
  const pol = await sql`SELECT polname FROM pg_policy WHERE polname='realtime_game_channel_join'`;
  console.log("game RLS policy present:", pol.length ? "yes" : "no");
  const idx = await sql`SELECT indexname FROM pg_indexes WHERE indexname='round_results_room_round_player_uq'`;
  console.log("unique index present:", idx.length ? "yes" : "no");
  const dups = await sql`SELECT "roomId","roundNumber","activePlayerId", count(*) c FROM round_results WHERE "roomId" IS NOT NULL AND "activePlayerId" IS NOT NULL GROUP BY 1,2,3 HAVING count(*)>1 ORDER BY c DESC LIMIT 5`;
  console.log("duplicate (roomId,round,player) groups:", dups.length, dups.length ? JSON.stringify(dups.map(d => ({ ...d, c: Number(d.c) }))) : "");
  const dupTotal = await sql`SELECT count(*) c FROM (SELECT 1 FROM round_results WHERE "roomId" IS NOT NULL AND "activePlayerId" IS NOT NULL GROUP BY "roomId","roundNumber","activePlayerId" HAVING count(*)>1) x`;
  console.log("total duplicate groups:", Number(dupTotal[0].c));
} catch (e) { console.error("diag error:", e.message); process.exit(1); } finally { await sql.end(); }
