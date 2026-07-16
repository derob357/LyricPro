import { describe, it, expect } from "vitest";
import { assertSafeTestDb, resolveDbHost } from "./test-db-guard";

const prod = "postgresql://postgres:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres?options=project%3Dprodref";
const test = "postgresql://postgres:pw@localhost:5432/postgres";

describe("test-db-guard", () => {
  it("no DB configured → no throw (tests self-skip)", () => {
    expect(() => assertSafeTestDb({})).not.toThrow();
  });
  it("throws when host matches the prod project ref", () => {
    expect(() =>
      assertSafeTestDb({
        SUPABASE_SESSION_POOLER_STRING: prod,
        VITE_SUPABASE_PROJECT_URL: "https://prodref.supabase.co",
      }),
    ).toThrow(/prod/i);
  });
  it("throws when NODE_ENV=production", () => {
    expect(() =>
      assertSafeTestDb({ DATABASE_URL: test, NODE_ENV: "production" }),
    ).toThrow(/production/i);
  });
  it("allows a non-prod host", () => {
    expect(() =>
      assertSafeTestDb({ DATABASE_URL: test, VITE_SUPABASE_PROJECT_URL: "https://prodref.supabase.co" }),
    ).not.toThrow();
  });
  it("resolveDbHost prefers session pooler then falls back", () => {
    expect(resolveDbHost({ DATABASE_URL: test })).toBe("localhost");
  });
});
