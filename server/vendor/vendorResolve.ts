// Resolves a signed-in user's vendor membership for the tRPC vendorProcedure.
// The membership row + active vendor status is the authority — the user's
// role enum is only a client-side hint.
import { sql } from "drizzle-orm";
import type { getDb } from "../db";
import type { VendorAuth } from "./vendorAuth";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type ResolvedVendor = VendorAuth["vendor"];

function toRows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result)
    ? (result as Record<string, unknown>[])
    : Array.from(result as Iterable<Record<string, unknown>>);
}

export async function resolveVendorForUser(db: Db, userId: number): Promise<ResolvedVendor | null> {
  const rows = toRows(
    await db.execute(sql`
      SELECT v.id, v.name, v.status,
             v.scope_growth, v.scope_engagement, v.scope_content, v.scope_monetization,
             v.catalog_filter
      FROM vendor_members m
      JOIN vendors v ON v.id = m.vendor_id
      WHERE m.user_id = ${userId}
      LIMIT 1
    `),
  );
  const row = rows[0];
  if (!row || row.status !== "active") return null;
  return {
    id: Number(row.id),
    name: String(row.name),
    status: String(row.status),
    scopeGrowth: Boolean(row.scope_growth),
    scopeEngagement: Boolean(row.scope_engagement),
    scopeContent: Boolean(row.scope_content),
    scopeMonetization: Boolean(row.scope_monetization),
    catalogFilter: (row.catalog_filter ?? null) as ResolvedVendor["catalogFilter"],
  };
}
