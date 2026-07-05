// API-key generation + authentication for the vendor REST API.
// Key-VALIDATION failures are deliberately indistinguishable to callers
// (uniform null) — the true reason is only ever logged by the caller.
// Infrastructure errors (DB down, query failure) PROPAGATE: the REST layer
// converts them to a generic 500, so outages don't masquerade as bad keys.
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { getDb } from "../db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export interface GeneratedKey {
  plaintext: string;
  prefix: string;
  last4: string;
  hash: string;
}

export interface VendorAuth {
  keyId: number;
  vendor: {
    id: number;
    name: string;
    status: string;
    scopeGrowth: boolean;
    scopeEngagement: boolean;
    scopeContent: boolean;
    scopeMonetization: boolean;
    catalogFilter: { songIds?: number[]; artists?: string[] } | null;
  };
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const KEY_RE = /^Bearer (lp_live_[A-Za-z0-9]{40})$/;

export function hashKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

export function generateApiKey(): GeneratedKey {
  let secret = "";
  for (let i = 0; i < 40; i++) secret += ALPHABET[crypto.randomInt(ALPHABET.length)];
  const plaintext = `lp_live_${secret}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, 12),
    last4: plaintext.slice(-4),
    hash: hashKey(plaintext),
  };
}

function toRows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result)
    ? (result as Record<string, unknown>[])
    : Array.from(result as Iterable<Record<string, unknown>>);
}

export async function authenticateVendorKey(
  db: Db,
  authHeader: string | undefined,
): Promise<VendorAuth | null> {
  const m = KEY_RE.exec(authHeader ?? "");
  if (!m) return null;
  const hash = hashKey(m[1]!);

  const rows = toRows(
    await db.execute(sql`
      SELECT k.id AS key_id, k.expires_at,
             v.id AS vendor_id, v.name, v.status,
             v.scope_growth, v.scope_engagement, v.scope_content, v.scope_monetization,
             v.catalog_filter
      FROM vendor_api_keys k
      JOIN vendors v ON v.id = k.vendor_id
      WHERE k.key_hash = ${hash} AND k.revoked_at IS NULL
      LIMIT 1
    `),
  );
  const row = rows[0];
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at as string | Date) < new Date()) return null;
  if (row.status !== "active") return null;

  const keyId = Number(row.key_id);
  // Fire-and-forget bookkeeping — auth latency must not pay for it, and a
  // bookkeeping failure must not fail the request.
  void Promise.allSettled([
    db.execute(sql`UPDATE vendor_api_keys SET last_used_at = now() WHERE id = ${keyId}`),
    db.execute(sql`
      INSERT INTO vendor_api_usage (key_id, date, request_count)
      VALUES (${keyId}, (now() AT TIME ZONE 'America/New_York')::date, 1)
      ON CONFLICT (key_id, date) DO UPDATE
        SET request_count = vendor_api_usage.request_count + 1
    `),
  ]).then((results) => {
    for (const r of results) {
      if (r.status === "rejected") console.error("[vendorAuth] bookkeeping error:", r.reason);
    }
  });

  return {
    keyId,
    vendor: {
      id: Number(row.vendor_id),
      name: String(row.name),
      status: String(row.status),
      scopeGrowth: Boolean(row.scope_growth),
      scopeEngagement: Boolean(row.scope_engagement),
      scopeContent: Boolean(row.scope_content),
      scopeMonetization: Boolean(row.scope_monetization),
      catalogFilter: (row.catalog_filter ?? null) as VendorAuth["vendor"]["catalogFilter"],
    },
  };
}
