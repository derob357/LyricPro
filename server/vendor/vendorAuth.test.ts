import { describe, expect, it, vi } from "vitest";
import { authenticateVendorKey, generateApiKey, hashKey } from "./vendorAuth";

function makeFakeDb(queue: unknown[][]) {
  let call = 0;
  return { execute: vi.fn().mockImplementation(() => Promise.resolve(queue[call++] ?? [])) };
}

const VENDOR_ROW = {
  key_id: 7, vendor_id: 3, name: "Acme", status: "active",
  scope_growth: true, scope_engagement: false, scope_content: true, scope_monetization: false,
  catalog_filter: { songIds: [1, 2] }, expires_at: null,
};

describe("generateApiKey", () => {
  it("produces lp_live_ + 40 base62 chars with matching prefix/last4/hash", () => {
    const k = generateApiKey();
    expect(k.plaintext).toMatch(/^lp_live_[A-Za-z0-9]{40}$/);
    expect(k.prefix).toBe(k.plaintext.slice(0, 12));
    expect(k.last4).toBe(k.plaintext.slice(-4));
    expect(k.hash).toBe(hashKey(k.plaintext));
    expect(k.hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("generates unique keys", () => {
    expect(generateApiKey().plaintext).not.toBe(generateApiKey().plaintext);
  });
});

describe("authenticateVendorKey", () => {
  it("returns VendorAuth for a valid key", async () => {
    const db = makeFakeDb([[VENDOR_ROW], [], []]);
    const auth = await authenticateVendorKey(db as never, "Bearer lp_live_" + "a".repeat(40));
    expect(auth).toEqual({
      keyId: 7,
      vendor: {
        id: 3, name: "Acme", status: "active",
        scopeGrowth: true, scopeEngagement: false, scopeContent: true, scopeMonetization: false,
        catalogFilter: { songIds: [1, 2] },
      },
    });
  });
  it("returns null for missing/malformed headers without touching the db", async () => {
    const db = makeFakeDb([]);
    expect(await authenticateVendorKey(db as never, undefined)).toBeNull();
    expect(await authenticateVendorKey(db as never, "Bearer wrong_format")).toBeNull();
    expect(await authenticateVendorKey(db as never, "Bearer lp_live_short")).toBeNull();
    expect(db.execute).not.toHaveBeenCalled();
  });
  it("returns null when no key row matches (unknown or revoked)", async () => {
    const db = makeFakeDb([[]]);
    expect(await authenticateVendorKey(db as never, "Bearer lp_live_" + "a".repeat(40))).toBeNull();
  });
  it("returns null for an expired key", async () => {
    const db = makeFakeDb([[{ ...VENDOR_ROW, expires_at: new Date("2020-01-01") }]]);
    expect(await authenticateVendorKey(db as never, "Bearer lp_live_" + "a".repeat(40))).toBeNull();
  });
  it("returns null for a suspended vendor", async () => {
    const db = makeFakeDb([[{ ...VENDOR_ROW, status: "suspended" }]]);
    expect(await authenticateVendorKey(db as never, "Bearer lp_live_" + "a".repeat(40))).toBeNull();
  });
});
