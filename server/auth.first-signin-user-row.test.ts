import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @supabase/supabase-js before importing the module under test.
const getUser = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn().mockReturnValue({
    auth: { getUser },
  }),
}));

// Mock the DB helpers that supabase-auth.ts imports from ../db.
const getUserByOpenId = vi.fn();
const upsertUser = vi.fn();
vi.mock("./db", () => ({
  getUserByOpenId,
  upsertUser,
}));

describe("authenticateRequest first-sign-in user-row creation", () => {
  beforeEach(() => {
    getUser.mockReset();
    getUserByOpenId.mockReset();
    upsertUser.mockReset();
    process.env.VITE_SUPABASE_PROJECT_URL = "https://test.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "test_secret";
  });

  it("creates a public.users row when Supabase returns a valid JWT for a new user", async () => {
    getUser.mockResolvedValue({
      data: {
        user: {
          id: "supabase-uuid-123",
          email: "newuser@example.com",
          user_metadata: { full_name: "New User" },
          app_metadata: { provider: "email" },
        },
      },
      error: null,
    });
    getUserByOpenId
      .mockResolvedValueOnce(null) // first call: no existing row
      .mockResolvedValueOnce({ id: 1, email: "newuser@example.com" }); // after upsert
    upsertUser.mockResolvedValue(undefined);

    const { authenticateRequest } = await import("./_core/supabase-auth");
    const req = {
      headers: { authorization: "Bearer fake-jwt-token" },
    } as never;

    const user = await authenticateRequest(req);

    expect(getUser).toHaveBeenCalledWith("fake-jwt-token");
    expect(upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "newuser@example.com",
      })
    );
    expect(user).not.toBeNull();
  });

  it("creates a row when email is an Apple private-relay address", async () => {
    getUser.mockResolvedValue({
      data: {
        user: {
          id: "supabase-uuid-456",
          email: "abc123xyz@privaterelay.appleid.com",
          user_metadata: {},
          app_metadata: { provider: "apple" },
        },
      },
      error: null,
    });
    getUserByOpenId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 2, email: "abc123xyz@privaterelay.appleid.com" });
    upsertUser.mockResolvedValue(undefined);

    const { authenticateRequest } = await import("./_core/supabase-auth");
    const req = {
      headers: { authorization: "Bearer fake-jwt" },
    } as never;

    const user = await authenticateRequest(req);

    expect(upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "abc123xyz@privaterelay.appleid.com",
      })
    );
    expect(user).not.toBeNull();
  });

  it("does not insert when the user already exists in public.users", async () => {
    getUser.mockResolvedValue({
      data: {
        user: {
          id: "supabase-uuid-789",
          email: "existing@example.com",
          user_metadata: {},
          app_metadata: {},
        },
      },
      error: null,
    });
    getUserByOpenId.mockResolvedValue({ id: 99, email: "existing@example.com" });

    const { authenticateRequest } = await import("./_core/supabase-auth");
    const req = {
      headers: { authorization: "Bearer fake-jwt" },
    } as never;

    await authenticateRequest(req);

    expect(upsertUser).not.toHaveBeenCalled();
  });
});
