import { describe, expect, it, vi } from "vitest";
import { resolveVendorForUser } from "./vendorResolve";

function makeFakeDb(queue: unknown[][]) {
  let call = 0;
  return { execute: vi.fn().mockImplementation(() => Promise.resolve(queue[call++] ?? [])) };
}

const ROW = {
  id: 3, name: "Acme", status: "active",
  scope_growth: true, scope_engagement: false, scope_content: true, scope_monetization: false,
  catalog_filter: { artists: ["Queen"] },
};

describe("resolveVendorForUser", () => {
  it("resolves an active vendor membership into the VendorAuth vendor shape", async () => {
    const db = makeFakeDb([[ROW]]);
    expect(await resolveVendorForUser(db as never, 42)).toEqual({
      id: 3, name: "Acme", status: "active",
      scopeGrowth: true, scopeEngagement: false, scopeContent: true, scopeMonetization: false,
      catalogFilter: { artists: ["Queen"] },
    });
  });
  it("returns null when the user has no membership", async () => {
    const db = makeFakeDb([[]]);
    expect(await resolveVendorForUser(db as never, 42)).toBeNull();
  });
  it("returns null when the vendor is suspended", async () => {
    const db = makeFakeDb([[{ ...ROW, status: "suspended" }]]);
    expect(await resolveVendorForUser(db as never, 42)).toBeNull();
  });
});
