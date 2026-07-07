# RLS Realtime Restoration + Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore multiplayer + chat Realtime (broken by out-of-band RLS enablement that left 4 channel-authorization tables deny-all) by adding 4 additive `authenticated` SELECT policies, verify with a probe + owner smoke, then capture SOC 2 evidence and flip T-03 → met.

**Architecture:** RLS is already enabled on all 57 prod `public` tables. The only change is 4 additive SELECT policies on `users`/`room_players`/`tournament_members`/`tournaments` (the tables the `realtime.messages` channel-join policies read as `authenticated`) + `search_path` hardening on 3 helper functions. A probe script proves the before (channel-join fails) and after (channel-join succeeds, deny-all still holds). Spec: `docs/superpowers/specs/2026-07-07-rls-backstop-design.md`.

**Tech Stack:** Postgres/Supabase, `@supabase/supabase-js` (probe), postgres.js runner, node ESM scripts. No app code changes.

## Global Constraints

- **RLS is ALREADY enabled on all tables** — this plan adds NO `ENABLE ROW LEVEL SECURITY`. Only additive `CREATE POLICY` + `ALTER FUNCTION … SET search_path`.
- Never `FORCE ROW LEVEL SECURITY` — server pooler (`postgres`, table owner) must keep bypassing.
- Never name `service_role` in a policy (it bypasses; naming is a no-op).
- Policies use the `(select …)` initplan-cached form, never bare `auth.uid()` / helper calls (research #5).
- Exact column names (confirmed from prod, they differ per table): `users."openId"` (quoted camelCase), `room_players."userId"` (quoted camelCase), `tournament_members.user_id`/`.tournament_id`/`.left_at` (snake_case), `tournaments.id`.
- Single-Supabase topology → migration + probe hit **prod**. Dry-run before apply. Policies are additive (reversible via `DROP POLICY`; no security-reducing state).
- Migration convention: `scripts/migrations/applied/YYYY-MM-DD-<name>.sql` applied via `node scripts/apply-kpi-migration.mjs <file> [--dry-run]`; idempotent (`DO $$ … EXCEPTION WHEN duplicate_object`).
- SECURITY: never print env values / connection strings; don't Read `.env`. Probe seeds are namespaced `__rls_probe__` and torn down (verify 0 residual). Conventional commits, NO Co-Authored-By.
- TypeScript strict/ESM elsewhere in repo; these are plain `.mjs`/`.sql`. Server suite: `pnpm test:server`.

---

### Task 1: Probe script — prove the broken state (red)

**Files:**
- Create: `scripts/probe-rls.mjs`

**Interfaces:**
- Produces: `node scripts/probe-rls.mjs` → prints a PASS/FAIL matrix + `PROBE PASS`/`PROBE FAIL (<n>)`, exit 0/1. Reusable for quarterly access-review evidence. Two supabase-js clients (anon; a seeded authenticated user). Seeds `__rls_probe__` auth user + `public.users` row + a `game_rooms` row + `room_players` row; tears them all down in a `finally`.

- [ ] **Step 1: Write the probe script**

```javascript
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
try {
  // ---- seed ----
  const created = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
  if (created.error) throw created.error;
  authUserId = created.data.user.id;
  const [u] = await sql`
    INSERT INTO users ("openId", nickname, role) VALUES (${authUserId}, ${TAG}, 'user')
    ON CONFLICT ("openId") DO UPDATE SET nickname = EXCLUDED.nickname
    RETURNING id`;
  appUserId = u.id;
  const [room] = await sql`
    INSERT INTO game_rooms (status, mode) VALUES ('waiting', 'solo') RETURNING id`;
  roomId = room.id;
  await sql`INSERT INTO room_players ("roomId", "userId") VALUES (${roomId}, ${appUserId})`;

  // ---- anon deny-all sample ----
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  for (const t of ["songs", "users", "golden_note_transactions", "vendor_api_keys"]) {
    const { data, error } = await anon.from(t).select("*").limit(1);
    check(`anon cannot read ${t}`, (data?.length ?? 0) === 0, error ? `err ${error.code}` : `rows ${data?.length}`);
  }

  // ---- authenticated session ----
  const authed = createClient(URL, ANON, { auth: { persistSession: false } });
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
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM users WHERE nickname = ${TAG}`;
  check("teardown left 0 probe users", n === 0, `residual ${n}`);
  await sql.end();
}
console.log(failures === 0 ? "PROBE PASS" : `PROBE FAIL (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
```

- [ ] **Step 2: Run the baseline probe (expect the own-room join to FAIL — this confirms the diagnosis)**

Run: `node scripts/probe-rls.mjs`
Expected: `anon cannot read …` all PASS; **`authenticated joins own game:<room>` FAILS** (denied/timeout — realtime is currently broken); `CANNOT join foreign room` PASS; teardown PASS. Overall `PROBE FAIL (1)`.
This red state is the point — it proves the broken realtime authorization before we fix it. If the own-room join unexpectedly PASSES, STOP: the diagnosis is wrong, do not proceed to Task 2; report.

Note on schema columns: the seed uses `users("openId", nickname, role)`, `game_rooms(status, mode)`, `room_players("roomId","userId")`. If any column name/NOT-NULL differs from the live schema and the INSERT errors, read the failing column from the error, check `drizzle/schema.ts` for the real name/required fields, and adjust the seed only (never the assertions). Record any adjustment in the report.

- [ ] **Step 3: Commit**

```bash
git add scripts/probe-rls.mjs
git commit -m "test(rls): realtime channel-join + deny-all probe (SOC2 T-03 evidence)"
```

---

### Task 2: Policy migration — restore realtime (green)

**Files:**
- Create: `scripts/migrations/applied/2026-07-07-restore-realtime-rls-policies.sql`

**Interfaces:**
- Consumes: the probe from Task 1 (rerun to verify). Helper signatures confirmed from prod: `current_chat_user_id()`, `is_chat_admin(integer)`, `is_chat_banned(integer, chat_ban_scope, integer)`.
- Produces: 4 `authenticated` SELECT policies (`users_select_own`, `room_players_select_own`, `tournament_members_select_own`, `tournaments_select_member`) + search_path on 3 helpers.

- [ ] **Step 1: Write the migration**

```sql
-- 2026-07-07-restore-realtime-rls-policies.sql
-- RLS was enabled out-of-band on all public tables, leaving users / room_players /
-- tournament_members / tournaments deny-all with no policy. The realtime.messages
-- channel-join policies read those tables as `authenticated` via current_chat_user_id()
-- (LANGUAGE sql STABLE, NOT security definer), so current_chat_user_id() returns NULL and
-- every game:{id} / chat:* private-channel join fails → multiplayer + chat realtime broken.
-- These 4 additive SELECT policies restore channel authorization. RLS is ALREADY enabled;
-- no ENABLE statements here. Idempotent. Applied via scripts/apply-kpi-migration.mjs.

-- Helper hygiene: pin search_path (defense-in-depth; functions stay STABLE, non-definer).
ALTER FUNCTION public.current_chat_user_id() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_chat_admin(integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.is_chat_banned(integer, chat_ban_scope, integer) SET search_path = public, pg_temp;

-- users: own row only. Uses auth.uid() DIRECTLY (not the helper — the helper reads users;
-- referencing it here would recurse).
DO $$ BEGIN
  CREATE POLICY users_select_own ON public.users
    FOR SELECT TO authenticated
    USING ("openId" = (select auth.uid())::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- room_players: own memberships. Feeds realtime_game_channel_join EXISTS.
DO $$ BEGIN
  CREATE POLICY room_players_select_own ON public.room_players
    FOR SELECT TO authenticated
    USING ("userId" = (select public.current_chat_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- tournament_members: own active memberships. Feeds realtime_chat_channel_join EXISTS.
DO $$ BEGIN
  CREATE POLICY tournament_members_select_own ON public.tournament_members
    FOR SELECT TO authenticated
    USING (user_id = (select public.current_chat_user_id()) AND left_at IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- tournaments: tournaments the caller is an active member of. Feeds the chat:tournament join.
DO $$ BEGIN
  CREATE POLICY tournaments_select_member ON public.tournaments
    FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.tournament_members tm
      WHERE tm.tournament_id = tournaments.id
        AND tm.user_id = (select public.current_chat_user_id())
        AND tm.left_at IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ROLLBACK (uncomment to revert to the current deny-all/broken-but-safe state):
-- DROP POLICY IF EXISTS users_select_own ON public.users;
-- DROP POLICY IF EXISTS room_players_select_own ON public.room_players;
-- DROP POLICY IF EXISTS tournament_members_select_own ON public.tournament_members;
-- DROP POLICY IF EXISTS tournaments_select_member ON public.tournaments;
```

- [ ] **Step 2: Dry-run, then apply to prod**

Run: `node scripts/apply-kpi-migration.mjs scripts/migrations/applied/2026-07-07-restore-realtime-rls-policies.sql --dry-run`
Expected: preview, exit 0.
Run: `node scripts/apply-kpi-migration.mjs scripts/migrations/applied/2026-07-07-restore-realtime-rls-policies.sql`
Expected: `Applied OK.`
If the `ALTER FUNCTION` fails on a signature mismatch, get the real signature from prod (`SELECT proname, pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname='is_chat_banned'`) and correct only that line.

- [ ] **Step 3: Re-run the probe (expect green)**

Run: `node scripts/probe-rls.mjs`
Expected: **`authenticated joins own game:<room>` PASS (SUBSCRIBED)**; `CANNOT join foreign room` PASS; all anon deny-all PASS; teardown PASS. Overall `PROBE PASS`, exit 0.
If the own-room join still fails, STOP — do not claim success; capture the channel error and report (likely a column-name mismatch in a policy `USING`).

- [ ] **Step 4: Server suite unaffected (bypass path)**

Run: `pnpm test:server`
Expected: 296 passed / 134 skipped (the additive policies don't touch the service-role/pooler path).

- [ ] **Step 5: Commit**

```bash
git add scripts/migrations/applied/2026-07-07-restore-realtime-rls-policies.sql
git commit -m "fix(rls): restore realtime channel authorization via 4 SELECT policies"
```

---

### Task 3: Owner smoke, evidence capture, T-03 close-out

**Files:**
- Create: `compliance/evidence/2026-07-07-rls/README.md` (+ probe output dumps)
- Modify: `compliance/assessments/technical-gap-assessment.md` (T-03 → met), `todo.md`, `drizzle/` snapshot

- [ ] **Step 1: Owner two-browser smoke (OWNER ACTION — gate)**

Ask the owner to: sign in as a real account in two browsers, start a live multiplayer round, confirm round-transition events arrive in both, and confirm a chat message appears in real time. This is the one thing the probe can't fully prove (browser realtime event flow). Record the result (pass/fail + date) in the evidence README. If it fails despite a green probe, STOP and investigate before closing T-03.

- [ ] **Step 2: Capture evidence**

Dump current RLS state to the evidence folder (read-only queries):

```bash
mkdir -p compliance/evidence/2026-07-07-rls
node -e "
import('postgres').then(async ({default: postgres}) => {
  (await import('dotenv')).config({quiet:true});
  const sql = postgres(process.env.SUPABASE_SESSION_POOLER_STRING ?? process.env.DATABASE_URL, { max: 1, prepare: false });
  const t = await sql\`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY tablename\`;
  const p = await sql\`SELECT schemaname, tablename, policyname, roles, cmd FROM pg_policies WHERE schemaname IN ('public','realtime') ORDER BY 1,2,3\`;
  const fs = await import('node:fs');
  fs.writeFileSync('compliance/evidence/2026-07-07-rls/pg_tables_rowsecurity.json', JSON.stringify(t,null,2));
  fs.writeFileSync('compliance/evidence/2026-07-07-rls/pg_policies.json', JSON.stringify(p,null,2));
  console.log('tables', t.length, 'rls_on', t.filter(x=>x.rowsecurity).length, 'policies', p.length);
  await sql.end();
});"
node scripts/probe-rls.mjs 2>&1 | tee compliance/evidence/2026-07-07-rls/probe-after.txt
```

Expected: all 57 tables `rowsecurity=true`; `probe-after.txt` ends `PROBE PASS`.

- [ ] **Step 2b: Write the evidence README**

```markdown
# RLS Control Evidence — 2026-07-07 (SOC 2 T-03, CC6.1/CC6.3)

**Control:** Row Level Security enabled on all 57 `public` tables; client roles
(anon/authenticated) have no table access except 4 narrow own-row SELECT policies
required by Realtime channel authorization. Server access is via the RLS-bypassing
service-role/pooler connection only. App-layer authz (tRPC) is the primary control;
RLS is the defense-in-depth backstop.

**Finding history:** Gap assessment T-03 read a stale drizzle snapshot showing
`isRLSEnabled:false`. Live prod query on 2026-07-07 found RLS already enabled on all
tables (out-of-band). That enablement had silently broken Realtime (4 channel-auth
tables were deny-all with no policy); restored via
`scripts/migrations/applied/2026-07-07-restore-realtime-rls-policies.sql`.

**Evidence files:** `pg_tables_rowsecurity.json` (all 57 = true),
`pg_policies.json`, `probe-after.txt` (PROBE PASS).

**Owner realtime smoke:** <PASS/FAIL + date — filled at Step 1>

**Reproduce:** `node scripts/probe-rls.mjs` (quarterly access-review evidence).
```

- [ ] **Step 3: Flip T-03 in the gap assessment**

Edit `compliance/assessments/technical-gap-assessment.md` T-03: change Status `gap` → `met`; append: "Verified 2026-07-07 — RLS already enabled on all 57 public tables (was mis-recorded from a stale drizzle snapshot); realtime restored via 4 additive SELECT policies; evidence in `compliance/evidence/2026-07-07-rls/`. Residual: `T-04` guestToken checks (app-layer, separate)."

- [ ] **Step 4: Regenerate the drizzle snapshot so it reflects reality**

Run: `pnpm exec drizzle-kit generate --name rls_state_sync`
If it emits a migration that only sets RLS flags / adds the policies, prepend the "ALREADY APPLIED TO PROD … do NOT re-apply" header (per repo convention) and keep it; if it emits unrelated drift, discard and note in the report that snapshot RLS-state sync needs a separate look. Run `pnpm check` → clean.

- [ ] **Step 5: Update todo.md**

Under the SOC 2 section: mark T-03 done (`- [x] T-03 RLS backstop — verified already enabled + realtime restored 2026-07-07`), and add:

```markdown
- [ ] Investigate HOW RLS got enabled out-of-band (dashboard lint "fix all"?) and add a guard/checklist so future dashboard actions don't silently break realtime again
- [ ] T-04 (SE-D04): add roomPlayers membership check to setReady/getNextSong/submitAnswer/assignTeam (app-layer, unrelated to RLS)
```

- [ ] **Step 6: Commit**

```bash
git add compliance/ todo.md drizzle/
git commit -m "docs(soc2): T-03 met — RLS evidence + realtime restoration close-out"
```
(Note: `compliance/` is gitignored/local-only; this commit records the drizzle snapshot + todo.md. The evidence files stay local — that is intended.)
