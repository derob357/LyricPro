// scripts/probe-rls.mjs
// SOC 2 RLS probe (gap T-03 evidence). Proves: (a) anon/authenticated cannot
// read deny-all tables, (b) a seeded authenticated user CAN join its own
// game:{room} private channel and CANNOT join a foreign room. Run before the
// policy migration (expect channel-join FAIL) and after (expect PASS).
// Usage: node scripts/probe-rls.mjs
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const URL = process.env.VITE_SUPABASE_PROJECT_URL;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SECRET_KEY;
const DB = process.env.SUPABASE_SESSION_POOLER_STRING ?? process.env.SUPABASE_DIRECT_CONNECTION_STRING ?? process.env.DATABASE_URL;
if (!URL || !ANON || !SERVICE || !DB) { console.error("Missing Supabase env var(s) — check names in .env"); process.exit(1); }

const TAG = "__rls_probe__";
const EMAIL = `${TAG}@example.com`;
const PASSWORD = TAG + "-Aa1!" + "x".repeat(8);
const sql = postgres(DB, { max: 1, prepare: false });
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`); if (!ok) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Subscribe to a private channel; resolve to true if SUBSCRIBED, false on error/timeout.
function tryJoin(client, topic, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let done = false;
    const ch = client.channel(topic, { config: { private: true } });
    const finish = (val) => { if (done) return; done = true; try { client.removeChannel(ch); } catch {} resolve(val); };
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") finish(true);
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") finish(false);
    });
    setTimeout(() => finish(false), timeoutMs);
  });
}

let authUserId, appUserId, roomId;
let authed;
try {
  // ---- seed ----
  const created = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
  if (created.error) throw created.error;
  authUserId = created.data.user.id;
  // SCHEMA ADJUSTMENT: public.users has no "nickname" column (that's on
  // guest_sessions). Using "name" (nullable text) instead — see
  // drizzle/schema.ts:219-263. Assertions below are unchanged.
  const [u] = await sql`
    INSERT INTO users ("openId", name, role) VALUES (${authUserId}, ${TAG}, 'user')
    ON CONFLICT ("openId") DO UPDATE SET name = EXCLUDED.name
    RETURNING id`;
  appUserId = u.id;
  // SCHEMA ADJUSTMENT: game_rooms also requires "roomCode" (varchar(8) NOT
  // NULL UNIQUE) and "selectedGenres"/"selectedDecades" (text NOT NULL, JSON
  // string per schema comment) with no defaults — see
  // drizzle/schema.ts:479-520. status/mode enum values ('waiting'/'solo')
  // were already valid and unchanged.
  const roomCode = Math.random().toString(36).slice(2, 10).toUpperCase();
  const [room] = await sql`
    INSERT INTO game_rooms (status, mode, "roomCode", "selectedGenres", "selectedDecades")
    VALUES ('waiting', 'solo', ${roomCode}, '[]', '[]') RETURNING id`;
  roomId = room.id;
  await sql`INSERT INTO room_players ("roomId", "userId") VALUES (${roomId}, ${appUserId})`;

  // ---- anon deny-all sample ----
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  for (const t of ["songs", "users", "golden_note_transactions", "vendor_api_keys"]) {
    const { data, error } = await anon.from(t).select("*").limit(1);
    check(`anon cannot read ${t}`, (data?.length ?? 0) === 0, error ? `err ${error.code}` : `rows ${data?.length}`);
  }

  // ---- authenticated session ----
  authed = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: sess, error: sErr } = await authed.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (sErr) throw sErr;
  await authed.realtime.setAuth(sess.session.access_token);
  await sleep(500);

  // own room join — the load-bearing assertion (FAIL before migration, PASS after)
  const ownJoin = await tryJoin(authed, `game:${roomId}`);
  check(`authenticated joins own game:${roomId}`, ownJoin === true, ownJoin ? "SUBSCRIBED" : "denied/timeout");

  // foreign room join must always fail (own-row scoping)
  const foreignJoin = await tryJoin(authed, `game:2147483000`);
  check(`authenticated CANNOT join foreign room`, foreignJoin === false, foreignJoin ? "WRONGLY SUBSCRIBED" : "denied");

  await authed.auth.signOut();
} catch (err) {
  console.error("PROBE ERROR:", err.message);
  failures++;
} finally {
  // ---- teardown ----
  if (roomId) await sql`DELETE FROM room_players WHERE "roomId" = ${roomId}`.catch(() => {});
  if (roomId) await sql`DELETE FROM game_rooms WHERE id = ${roomId}`.catch(() => {});
  if (appUserId) await sql`DELETE FROM users WHERE id = ${appUserId}`.catch(() => {});
  if (authUserId) await admin.auth.admin.deleteUser(authUserId).catch(() => {});
  // SCHEMA ADJUSTMENT: residual check filters on "name" (see above) instead
  // of "nickname".
  const [{ n: uLeft }] = await sql`SELECT count(*)::int AS n FROM users WHERE name = ${TAG}`;
  const rpLeft = roomId ? (await sql`SELECT count(*)::int AS n FROM room_players WHERE "roomId" = ${roomId}`)[0].n : 0;
  const grLeft = roomId ? (await sql`SELECT count(*)::int AS n FROM game_rooms WHERE id = ${roomId}`)[0].n : 0;
  check("teardown left 0 probe rows (users/room_players/game_rooms)", uLeft === 0 && rpLeft === 0 && grLeft === 0, `users ${uLeft}, room_players ${rpLeft}, game_rooms ${grLeft}`);
  try { await authed?.realtime?.disconnect(); } catch {}
  await sql.end();
}
console.log(failures === 0 ? "PROBE PASS" : `PROBE FAIL (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
