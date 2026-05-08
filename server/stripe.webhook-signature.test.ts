import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("stripe", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      checkout: { sessions: { create: vi.fn() } },
      webhooks: {
        constructEvent: vi.fn().mockImplementation(() => {
          throw new Error("No signatures found matching the expected signature for payload");
        }),
      },
      subscriptions: { retrieve: vi.fn() },
    })),
  };
});

vi.mock("../server/db", () => ({ getDb: vi.fn().mockResolvedValue(null) }));
vi.mock("../server/db-monetization", () => ({ updateSubscription: vi.fn() }));

import { handleStripeWebhook } from "./_core/stripeWebhook";

describe("Stripe webhook signature verification", () => {
  let originalSecret: string | undefined;

  beforeEach(() => {
    originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_dummy";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
  });

  function makeReqRes(body: Buffer, signature?: string) {
    const req = {
      headers: signature ? { "stripe-signature": signature } : {},
      body,
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    return { req, res };
  }

  it("returns 400 when stripe-signature header is missing", async () => {
    const { req, res } = makeReqRes(Buffer.from("{}"));
    await handleStripeWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when signature is invalid", async () => {
    const { req, res } = makeReqRes(
      Buffer.from(JSON.stringify({ id: "evt_test_anything" })),
      "t=1,v1=invalid"
    );
    await handleStripeWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 500 when STRIPE_WEBHOOK_SECRET is unset", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { req, res } = makeReqRes(
      Buffer.from(JSON.stringify({ id: "evt_test_anything" })),
      "t=1,v1=anything"
    );
    await handleStripeWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("returns 500 when STRIPE_WEBHOOK_SECRET is the placeholder value", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_placeholder";
    const { req, res } = makeReqRes(
      Buffer.from(JSON.stringify({ id: "evt_test_anything" })),
      "t=1,v1=anything"
    );
    await handleStripeWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
