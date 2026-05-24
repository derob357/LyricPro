import { describe, it, expect, vi } from "vitest";

// Stripe initialises at module load with STRIPE_SECRET_KEY. Mock it so tests
// that import appRouter don't require a real key in the environment.
vi.mock("stripe", () => {
  const Stripe = vi.fn().mockImplementation(() => ({
    checkout: { sessions: { create: vi.fn() } },
    webhooks: { constructEvent: vi.fn() },
    subscriptions: { retrieve: vi.fn() },
    customers: { search: vi.fn().mockResolvedValue({ data: [] }) },
  }));
  return { default: Stripe };
});

import { appRouter } from "../app-router";
import { chatRouter } from "./chat";

describe("chatRouter", () => {
  it("is registered on appRouter under the 'chat' namespace", () => {
    // appRouter is the t.router output; structural type — check presence by
    // existence of a known procedure once Phase 2 adds them. For Phase 1
    // we just confirm the namespace exists.
    expect(appRouter._def.record).toHaveProperty("chat");
  });

  it("exports an empty router (no procedures yet — Phase 2 adds endpoints)", () => {
    expect(Object.keys(chatRouter._def.record)).toEqual([]);
  });
});
