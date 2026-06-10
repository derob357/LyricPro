import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Router mock ──────────────────────────────────────────────────────────────
const navigate = vi.fn();
vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return {
    ...actual,
    useLocation: () => ["/shop", navigate],
    useSearch: () => "",
    Link: ({ href, children, ...rest }: any) => (
      <a href={href} {...rest}>{children}</a>
    ),
  };
});

// ── Auth mock ─────────────────────────────────────────────────────────────────
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, email: "test@example.com", lifetimeScore: 0 },
    loading: false,
    isAuthenticated: true,
  }),
}));

// ── Platform mock — make CAN_PURCHASE = true so spend section renders ─────────
vi.mock("@/lib/platform", () => ({ CAN_PURCHASE: true, IS_WEB: true }));

// ── Heavy component stubs ─────────────────────────────────────────────────────
vi.mock("@/components/SubscriptionTierSelector", () => ({
  SubscriptionTierSelector: () => null,
}));

// ── Mutation / query capture ──────────────────────────────────────────────────
const purchaseExtraGameMutate = vi.fn();
const invalidateGetMyBalance = vi.fn();
const invalidateGetTransactions = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      goldenNotes: {
        getMyBalance: { invalidate: invalidateGetMyBalance },
        getTransactions: { invalidate: invalidateGetTransactions },
      },
    }),
    goldenNotes: {
      getMyBalance: {
        useQuery: () => ({
          data: { balance: 5, earnedBalance: 0, purchasedBalance: 5,
                  lifetimePurchased: 5, lifetimeSpent: 0,
                  lifetimeGiftedSent: 0, lifetimeGiftedReceived: 0,
                  lastPurchaseAt: null },
        }),
      },
      getPacks: { useQuery: () => ({ data: [] }) },
      getTransactions: { useQuery: () => ({ data: [] }) },
      createPurchaseCheckout: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      purchaseExtraGame: {
        useMutation: (opts: { onSuccess?: () => void; onError?: (e: Error) => void }) => ({
          mutate: purchaseExtraGameMutate,
          isPending: false,
          // Capture onSuccess/onError so tests can trigger them.
          _opts: opts,
        }),
      },
    },
    monetization: {
      getSubscription: { useQuery: () => ({ data: { tier: "free" } }) },
      createSubscriptionCheckout: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

import Shop from "./Shop";

describe("Shop spend section", () => {
  beforeEach(() => {
    navigate.mockClear();
    purchaseExtraGameMutate.mockClear();
    invalidateGetMyBalance.mockClear();
    invalidateGetTransactions.mockClear();
  });

  it("Buy button for Extra Game calls purchaseExtraGame.mutate with an idempotencyKey", () => {
    render(<Shop />);
    const buyBtn = screen.getByRole("button", { name: /Buy — 1 GN/i });
    expect(buyBtn).toBeTruthy();
    fireEvent.click(buyBtn);
    expect(purchaseExtraGameMutate).toHaveBeenCalledTimes(1);
    const arg = purchaseExtraGameMutate.mock.calls[0][0];
    expect(arg).toHaveProperty("idempotencyKey");
    // idempotencyKey must be a non-empty string (UUID from crypto.randomUUID)
    expect(typeof arg.idempotencyKey).toBe("string");
    expect(arg.idempotencyKey.length).toBeGreaterThan(0);
  });

  it("Advanced Mode cards are absent from the page", () => {
    render(<Shop />);
    expect(screen.queryByText(/Advanced Mode/i)).toBeNull();
  });

  it("Browse Tournaments button navigates to /tournaments", () => {
    render(<Shop />);
    const browseBtn = screen.getByRole("button", { name: /Browse Tournaments/i });
    fireEvent.click(browseBtn);
    expect(navigate).toHaveBeenCalledWith("/tournaments");
  });
});
