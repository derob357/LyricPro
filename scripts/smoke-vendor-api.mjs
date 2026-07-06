// scripts/smoke-vendor-api.mjs
// E2E smoke for /api/vendor/v1 against a locally running dev server
// (pnpm dev) which talks to the shared DB. Seeds a throwaway vendor + key,
// exercises auth/scope/data paths, then deletes the seed rows.
// Usage: node scripts/smoke-vendor-api.mjs [--base http://localhost:3000]
import crypto from "node:crypto";
import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config();
const BASE = (() => { const i = process.argv.indexOf("--base"); return i >= 0 ? process.argv[i + 1] : "http://localhost:3000"; })();
const DB_URL = process.env.SUPABASE_SESSION_POOLER_STRING ?? process.env.DATABASE_URL;
if (!DB_URL) { console.error("Set SUPABASE_SESSION_POOLER_STRING in .env"); process.exit(1); }

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
let secret = ""; for (let i = 0; i < 40; i++) secret += ALPHABET[crypto.randomInt(62)];
const KEY = `lp_live_${secret}`;
const HASH = crypto.createHash("sha256").update(KEY).digest("hex");

const sql = postgres(DB_URL, { max: 1, prepare: false });
let vendorId, keyId, failures = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); if (!cond) failures++; };

try {
  [{ id: vendorId }] = await sql`
    INSERT INTO vendors (name, status, scope_growth, scope_content)
    VALUES ('__smoke_test__', 'active', true, true) RETURNING id`;
  [{ id: keyId }] = await sql`
    INSERT INTO vendor_api_keys (vendor_id, label, key_prefix, last4, key_hash)
    VALUES (${vendorId}, 'smoke', ${KEY.slice(0, 12)}, ${KEY.slice(-4)}, ${HASH}) RETURNING id`;

  const get = (path, key = KEY) => fetch(`${BASE}${path}`, { headers: key ? { Authorization: `Bearer ${key}` } : {} });

  let r = await get("/api/vendor/v1/meta");
  check("meta 200", r.status === 200);
  const meta = await r.json();
  check("meta scopes", JSON.stringify((meta.data?.scopes ?? []).sort()) === '["content","growth"]', JSON.stringify(meta.data?.scopes));
  check("meta has definitions", Array.isArray(meta.meta?.definitions?.notes));

  r = await get("/api/vendor/v1/metrics/growth?from=2026-06-01&to=2026-07-01");
  check("growth 200", r.status === 200);
  const growth = await r.json();
  check("growth has data rows", Array.isArray(growth.data) && growth.data.length > 0, `rows=${growth.data?.length}`);

  r = await get("/api/vendor/v1/metrics/monetization?from=2026-06-01&to=2026-07-01");
  check("unscoped family 403", r.status === 403, `got ${r.status}`);

  r = await get("/api/vendor/v1/metrics/growth?from=2026-06-01&to=2026-07-01", "lp_live_" + "x".repeat(40));
  check("bad key 401", r.status === 401);
  check("bad key uniform body", (await r.json()).error === "invalid_api_key");

  r = await get("/api/vendor/v1/metrics/growth?from=2026-06-01&to=2026-07-01", null);
  check("no key 401", r.status === 401);

  r = await get("/api/vendor/v1/metrics/growth?from=2026-06-01&to=2026-07-01&format=csv");
  check("csv content-type", (r.headers.get("content-type") ?? "").includes("text/csv"));

  r = await fetch(`${BASE}/api/vendor/v1/reports`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reports: ["growth", "content"], from: "2026-06-01", to: "2026-07-01" }),
  });
  check("reports 200", r.status === 200);
  const rep = await r.json();
  check("reports families", "growth" in (rep.data ?? {}) && "content" in (rep.data ?? {}));

  // Malformed JSON body: exercises the body-parse envelope middleware
  // (vendorBodyParseErrorHandler in server/vendor/vendorRest.ts), which must
  // normalize express.json()'s SyntaxError into the vendor error envelope
  // rather than letting Express's default HTML error page leak through.
  r = await fetch(`${BASE}/api/vendor/v1/reports`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: "{not json",
  });
  check("malformed json 400", r.status === 400, `got ${r.status}`);
  check("malformed json envelope", (await r.json()).error === "invalid_json");

  // Rate limiting is NOT exercised here: the in-process limiter only engages
  // when NODE_ENV === "production" (see server/vendor/vendorRest.ts), and
  // this smoke runs against `pnpm dev` (NODE_ENV=development), so repeated
  // requests would never trip a 429 — asserting on it would be a false check.

  await sql`UPDATE vendor_api_keys SET revoked_at = now() WHERE id = ${keyId}`;
  r = await get("/api/vendor/v1/meta");
  check("revoked key 401", r.status === 401);
} finally {
  if (vendorId) await sql`DELETE FROM vendors WHERE id = ${vendorId}`; // cascades members/keys/usage
  await sql.end();
}
console.log(failures === 0 ? "SMOKE PASS" : `SMOKE FAIL (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
