import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return { ...actual, useLocation: () => ["/", navigate] };
});
const authState = vi.hoisted(() => ({ value: { user: null as any, isAuthenticated: false } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => authState.value }));
vi.mock("@/components/PlayNowCard", () => ({
  __esModule: true,
  default: () => <div data-testid="play-now-card" />,
}));

// Stub heavy/trpc-dependent components that Home imports
vi.mock("@/components/SocialShareButtons", () => ({ default: () => null }));
vi.mock("@/components/WeaknessPackCard", () => ({ WeaknessPackCard: () => null }));
vi.mock("@/components/SuggestionCard", () => ({ SuggestionCard: () => null }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    system: {
      libraryStats: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

import Home from "./Home";

describe("Home hero", () => {
  beforeEach(() => { navigate.mockClear(); authState.value = { user: null, isAuthenticated: false }; });

  it("renders the PlayNowCard in the hero and no old CTA buttons", () => {
    render(<Home />);
    expect(screen.getByTestId("play-now-card")).toBeTruthy();
    expect(screen.queryByText(/Play Now — Free to try/)).toBeNull();
  });

  it("Host a Game button below the card; unauthenticated click opens the auth dialog", () => {
    render(<Home />);
    const host = screen.getByRole("button", { name: /Host a Game/i });
    fireEvent.click(host);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
