import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return { ...actual, useLocation: () => ["/", navigate] };
});
const authState = vi.hoisted(() => ({ value: { user: null as any, isAuthenticated: false } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => authState.value }));
const createGuestSession = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
const createRoom = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
// Default counts: Pop/1990–2000 has ≥5 songs so existing tests stay green.
// Individual tests may override `genreDecadeCountsData.value` to exercise filtering.
const genreDecadeCountsData = vi.hoisted(() => ({
  value: {
    counts: {
      Pop: { "1990–2000": 10, "2000–2010": 8, "2010–2020": 7, "2020–Present": 6 },
    } as Record<string, Record<string, number>>,
  } as { counts: Record<string, Record<string, number>> } | undefined,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    game: {
      createGuestSession: { useMutation: () => createGuestSession },
      createRoom: { useMutation: () => createRoom },
      genreDecadeCounts: { useQuery: () => ({ data: genreDecadeCountsData.value }) },
    },
  },
}));

import PlayNowCard from "./PlayNowCard";

function fillRequired() {
  fireEvent.change(screen.getByTestId("genre-trigger"), { target: { value: "Pop" } });
  fireEvent.click(screen.getByTestId("decade-trigger"));
  fireEvent.click(screen.getByTestId("decade-opt-1990–2000"));
}

describe("PlayNowCard", () => {
  beforeEach(() => {
    navigate.mockClear();
    createGuestSession.mutateAsync.mockReset().mockResolvedValue({ token: "guest-tok", nickname: "jamie" });
    createRoom.mutateAsync.mockReset().mockResolvedValue({ roomCode: "ROOM42" });
    authState.value = { user: null, isAuthenticated: false };
    localStorage.clear();
    // Reset to default counts (Pop 1990–2000 has ≥5 so all existing tests pass)
    genreDecadeCountsData.value = {
      counts: {
        Pop: { "1990–2000": 10, "2000–2010": 8, "2010–2020": 7, "2020–Present": 6 },
      },
    };
  });

  it("guest: requires email + genre + decade before Start enables; opt-in NOT required", () => {
    render(<PlayNowCard />);
    const start = screen.getByTestId("play-start") as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("email-input"), { target: { value: "jamie@example.com" } });
    fillRequired();
    expect(start.disabled).toBe(false);
  });

  it("guest: opt-in checkbox is UNCHECKED by default and passes false", async () => {
    render(<PlayNowCard />);
    fireEvent.change(screen.getByTestId("email-input"), { target: { value: "jamie@example.com" } });
    fillRequired();
    fireEvent.click(screen.getByTestId("play-start"));
    await waitFor(() => expect(createGuestSession.mutateAsync).toHaveBeenCalled());
    expect(createGuestSession.mutateAsync).toHaveBeenCalledWith({
      email: "jamie@example.com",
      marketingOptIn: false,
      consentSource: "home-play-card",
    });
  });

  it("guest: checking opt-in passes true", async () => {
    render(<PlayNowCard />);
    fireEvent.change(screen.getByTestId("email-input"), { target: { value: "jamie@example.com" } });
    fireEvent.click(screen.getByTestId("optin-checkbox"));
    fillRequired();
    fireEvent.click(screen.getByTestId("play-start"));
    await waitFor(() => expect(createGuestSession.mutateAsync).toHaveBeenCalled());
    expect(createGuestSession.mutateAsync.mock.calls[0][0].marketingOptIn).toBe(true);
  });

  it("guest flow: quick-start config preserved + navigate", async () => {
    render(<PlayNowCard />);
    fireEvent.change(screen.getByTestId("email-input"), { target: { value: "jamie@example.com" } });
    fillRequired();
    fireEvent.click(screen.getByTestId("play-start"));
    await waitFor(() => expect(createRoom.mutateAsync).toHaveBeenCalled());
    expect(localStorage.getItem("lyricpro_guest_token")).toBe("guest-tok");
    expect(createRoom.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      mode: "solo", genres: ["Pop"], decades: ["1990–2000"],
      difficulty: "low", timerSeconds: 90, rounds: 3, explicitFilter: false, guestToken: "guest-tok",
    }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/play/ROOM42"));
  });

  it("authenticated: no email field, no opt-in checkbox, no guest session", async () => {
    authState.value = { user: { id: "u1" }, isAuthenticated: true };
    render(<PlayNowCard />);
    expect(screen.queryByTestId("email-input")).toBeNull();
    expect(screen.queryByTestId("optin-checkbox")).toBeNull();
    fillRequired();
    fireEvent.click(screen.getByTestId("play-start"));
    await waitFor(() => expect(createRoom.mutateAsync).toHaveBeenCalled());
    expect(createGuestSession.mutateAsync).not.toHaveBeenCalled();
  });

  it("hides a decade option when it has <5 songs for the chosen genre", () => {
    // Pop only has 2 songs in 1940–1950 (below threshold) — 1990–2000 has 10 (above)
    genreDecadeCountsData.value = {
      counts: {
        Pop: { "1940–1950": 2, "1990–2000": 10 },
      },
    };
    render(<PlayNowCard />);
    // Select Pop
    fireEvent.change(screen.getByTestId("genre-trigger"), { target: { value: "Pop" } });
    // Open the decades popover
    fireEvent.click(screen.getByTestId("decade-trigger"));
    // 1940–1950 should NOT appear (only 2 songs for Pop)
    expect(screen.queryByTestId("decade-opt-1940–1950")).toBeNull();
    // 1990–2000 should still appear (10 songs for Pop)
    expect(screen.getByTestId("decade-opt-1990–2000")).toBeTruthy();
  });
});
