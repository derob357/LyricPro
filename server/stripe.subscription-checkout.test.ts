import { describe, it, expect, vi, beforeEach } from "vitest";

const sessionsCreate = vi.fn().mockResolvedValue({
  id: "cs_test_xyz",
  url: "https://checkout.stripe.com/c/cs_test_xyz",
});

vi.mock("stripe", () => {
  const Stripe = vi.fn().mockImplementation(() => ({
    checkout: { sessions: { create: sessionsCreate } },
    webhooks: { constructEvent: vi.fn() },
    subscriptions: { retrieve: vi.fn() },
  }));
  return { default: Stripe };
});

describe("createSubscriptionCheckout", () => {
  beforeEach(() => {
    sessionsCreate.mockClear();
    process.env.STRIPE_PRICE_PLAYER = "price_live_player_xxx";
    process.env.STRIPE_PRICE_PRO = "price_live_pro_xxx";
    process.env.STRIPE_PRICE_ELITE = "price_live_elite_xxx";
  });

  it("creates a subscription Checkout session with the correct price for player tier", async () => {
    const { createSubscriptionCheckout } = await import("./stripe-integration");
    await createSubscriptionCheckout(42, "user@example.com", "player", "https://playlyricpro.com");

    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer_email: "user@example.com",
        line_items: [
          expect.objectContaining({
            price: "price_live_player_xxx",
            quantity: 1,
          }),
        ],
        success_url: expect.stringContaining("https://playlyricpro.com/dashboard"),
        cancel_url: "https://playlyricpro.com/dashboard",
        client_reference_id: "42",
        allow_promotion_codes: true,
        metadata: expect.objectContaining({
          userId: "42",
          tier: "player",
          type: "subscription",
        }),
      })
    );
  });

  it("uses the pro price ID when tier is pro", async () => {
    const { createSubscriptionCheckout } = await import("./stripe-integration");
    await createSubscriptionCheckout(7, "u@x.io", "pro", "https://playlyricpro.com");
    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [expect.objectContaining({ price: "price_live_pro_xxx" })],
      })
    );
  });

  it("uses the elite price ID when tier is elite", async () => {
    const { createSubscriptionCheckout } = await import("./stripe-integration");
    await createSubscriptionCheckout(7, "u@x.io", "elite", "https://playlyricpro.com");
    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [expect.objectContaining({ price: "price_live_elite_xxx" })],
      })
    );
  });
});
