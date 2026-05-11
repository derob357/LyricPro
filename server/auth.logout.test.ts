import { describe, expect, it, vi } from "vitest";

// Stripe initialises at module load and throws without a real key.
// Mock the integration module so importing app-router doesn't error out.
vi.mock("./stripe-integration", () => ({
  createSubscriptionCheckout: vi.fn(),
  createOneTimeCheckout: vi.fn(),
  createPortalSession: vi.fn(),
}));

import { appRouter } from "./app-router";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "supabase",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };

  return { ctx };
}

describe("auth.logout", () => {
  // Cookie clearing was removed when Manus auth was dropped. Supabase signout
  // is handled client-side; the server mutation is a no-op that returns success.
  it("returns { success: true } without throwing", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
  });
});
