import { describe, it, expect, vi } from "vitest";

vi.mock("stripe", () => {
  return {
    default: vi.fn().mockImplementation(() => ({})),
  };
});

import { handleCustomerSubscriptionUpdated } from "./stripe-integration";

describe("handleCustomerSubscriptionUpdated", () => {
  it("returns updated subscription state with status, period end, tier, and userId", async () => {
    const subscription = {
      id: "sub_test_123",
      status: "past_due",
      current_period_end: 1893456000, // 2030-01-01
      items: {
        data: [{ price: { id: "price_pro_test" } }],
      },
      metadata: { tier: "pro", userId: "42" },
    } as never;

    const result = await handleCustomerSubscriptionUpdated(subscription);

    expect(result).toEqual({
      type: "subscription_updated",
      subscriptionId: "sub_test_123",
      status: "past_due",
      currentPeriodEnd: 1893456000,
      userId: 42,
      tier: "pro",
    });
  });

  it("handles status='active' transitions back from past_due", async () => {
    const subscription = {
      id: "sub_test_456",
      status: "active",
      current_period_end: 1893456000,
      items: { data: [{ price: { id: "price_player_test" } }] },
      metadata: { tier: "player", userId: "99" },
    } as never;

    const result = await handleCustomerSubscriptionUpdated(subscription);
    expect(result?.status).toBe("active");
    expect(result?.userId).toBe(99);
    expect(result?.tier).toBe("player");
  });

  it("returns undefined userId when metadata.userId missing", async () => {
    const subscription = {
      id: "sub_test_789",
      status: "trialing",
      current_period_end: 1893456000,
      items: { data: [{ price: { id: "price_x" } }] },
      metadata: {},
    } as never;

    const result = await handleCustomerSubscriptionUpdated(subscription);
    expect(result?.userId).toBeUndefined();
    expect(result?.tier).toBeUndefined();
    expect(result?.status).toBe("trialing");
  });
});
