import { describe, it, expect, vi } from "vitest";

vi.mock("stripe", () => {
  const Stripe = vi.fn().mockImplementation(() => ({
    checkout: { sessions: { create: vi.fn() } },
    webhooks: { constructEvent: vi.fn() },
    subscriptions: { retrieve: vi.fn() },
    customers: { search: vi.fn().mockResolvedValue({ data: [] }) },
  }));
  return { default: Stripe };
});

import { hashUserId } from "./routers/game";

describe("hashUserId", () => {
  it("returns a 64-char hex digest", () => {
    const h = hashUserId(42);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same userId + pepper", () => {
    expect(hashUserId(42)).toBe(hashUserId(42));
  });

  it("returns different hashes for different userIds", () => {
    expect(hashUserId(42)).not.toBe(hashUserId(43));
  });
});
