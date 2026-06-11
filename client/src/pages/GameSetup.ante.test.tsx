import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return {
    ...actual,
    useLocation: () => ["/setup", navigate],
    useSearch: () => "",
  };
});

const authState = vi.hoisted(() => ({
  value: {
    user: { id: 1, firstName: "Deric" } as any,
    isAuthenticated: true,
    logout: vi.fn(),
  },
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => authState.value }));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// Capture the createRoom mutate call so tests can assert on it.
const createRoomMutate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/trpc", () => ({
  trpc: {
    game: {
      getMyGamePrefs: { useQuery: () => ({ data: undefined, isLoading: false }) },
      saveGamePrefs: { useMutation: () => ({ mutate: vi.fn() }) },
      createRoom: {
        useMutation: (opts: any) => ({
          mutate: createRoomMutate,
          isPending: false,
          ...opts,
        }),
      },
      // Returning undefined counts triggers loading-passthrough in availableDecades
      // so all existing decades remain visible and existing tests stay green.
      genreDecadeCounts: { useQuery: () => ({ data: undefined }) },
    },
    liveRoom: {
      createLiveRoom: {
        useMutation: (opts: any) => ({ mutate: vi.fn(), isPending: false, ...opts }),
      },
    },
    goldenNotes: {
      getMyBalance: {
        useQuery: () => ({
          data: { balance: 130, earnedBalance: 80, purchasedBalance: 50 },
          isLoading: false,
        }),
      },
    },
  },
}));

import GameSetup from "./GameSetup";

/** Select genres + decades so the Start button is not disabled. */
function fillRequiredFields() {
  fireEvent.click(screen.getByText("Pop"));
  fireEvent.click(screen.getByText("1990–2000"));
}

describe("GameSetup ante stepper", () => {
  beforeEach(() => {
    navigate.mockClear();
    createRoomMutate.mockClear();
    authState.value = {
      user: { id: 1, firstName: "Deric" } as any,
      isAuthenticated: true,
      logout: vi.fn(),
    };
  });

  it("ante stepper renders for signed-in solo with default 50 and shows stakeable balance", () => {
    // earned=80 → floor(80/25)*25 = 75 is max; default min(50, 75) = 50
    render(<GameSetup />);
    expect(screen.getByTestId("ante-value").textContent).toBe("50");
    // "Stakeable: 80" hint is visible
    expect(screen.getByText(/stakeable/i).textContent).toMatch(/80/);
  });

  it("ante steps by 25 and clamps at earned balance (max 75 for earned=80)", () => {
    render(<GameSetup />);
    // start at 50
    fireEvent.click(screen.getByTestId("ante-up"));   // → 75
    expect(screen.getByTestId("ante-value").textContent).toBe("75");
    fireEvent.click(screen.getByTestId("ante-up"));   // would be 100 > 75 (maxAnte) → stays 75
    expect(screen.getByTestId("ante-value").textContent).toBe("75");
    fireEvent.click(screen.getByTestId("ante-down")); // → 50
    fireEvent.click(screen.getByTestId("ante-down")); // → 25
    fireEvent.click(screen.getByTestId("ante-down")); // → 0
    fireEvent.click(screen.getByTestId("ante-down")); // floor at 0
    expect(screen.getByTestId("ante-value").textContent).toBe("0");
    // "Playing for fun" note at 0
    expect(screen.getByText(/playing for fun/i)).toBeTruthy();
  });

  it("createRoom payload includes the ante", () => {
    render(<GameSetup />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /start game/i }));
    expect(createRoomMutate).toHaveBeenCalledOnce();
    const payload = createRoomMutate.mock.calls[0][0];
    expect(payload).toHaveProperty("ante", 50);
  });

  it("guests see no ante section", () => {
    authState.value = { user: null, isAuthenticated: false, logout: vi.fn() };
    render(<GameSetup />);
    expect(screen.queryByTestId("ante-value")).toBeNull();
  });
});
