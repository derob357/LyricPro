import { describe, it, expect, vi, beforeEach } from "vitest";

const navigate = vi.fn();
vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return {
    ...actual,
    useLocation: () => ["/play/ROOM42", navigate],
    useParams: () => ({ roomCode: "ROOM42" }),
    useSearch: () => "",
  };
});
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAuthenticated: false }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/pauseState", () => ({ usePaused: () => false }));

type MutationOpts = { onSuccess?: (data: unknown) => void; onError?: (e: unknown) => void };
const captured = vi.hoisted(() => ({ submitOpts: null as MutationOpts | null }));
const submitMutate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ goldenNotes: { getMyBalance: { invalidate: vi.fn() } } }),
    game: {
      getRoom: {
        useQuery: () => ({
          data: {
            id: 1, roomCode: "ROOM42", status: "in_progress", mode: "solo",
            currentRound: 1, roundsTotal: 3, timerSeconds: 90, difficulty: "low",
            rankingMode: "standard", streakInsurance: false,
            players: [{ id: 1, userId: null, guestToken: "guest-tok", score: 0, currentStreak: 0 }],
          },
          refetch: vi.fn(),
        }),
      },
      getNextSong: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      submitAnswer: {
        useMutation: (opts: MutationOpts) => {
          captured.submitOpts = opts;
          return { mutate: submitMutate, isPending: false };
        },
      },
      nextRound: { useMutation: () => ({ mutate: vi.fn() }) },
      useHint: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      startGame: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

import { render, act } from "@testing-library/react";
import Gameplay from "./Gameplay";

describe("Gameplay auto-advance to results", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigate.mockClear();
    captured.submitOpts = null;
    localStorage.setItem("lyricpro_guest_token", "guest-tok");
  });

  it("navigates to round results ~600ms after a successful last-answer submit", () => {
    render(<Gameplay />);
    expect(captured.submitOpts?.onSuccess).toBeTruthy();
    act(() => {
      captured.submitOpts!.onSuccess!({
        total: 125, newScore: 125, newStreak: 1, correctCount: 4, celebrationCount: 4,
        lyricCorrect: true, titleCorrect: true, artistCorrect: true,
        lyricPoints: 25, titlePoints: 25, artistPoints: 25, yearPoints: 50,
        speedBonus: 0, streakBonus: 0,
        correctLyric: "x", correctArtist: "y", correctYear: 1999, difficulty: "low",
      });
    });
    act(() => { vi.advanceTimersByTime(700); });
    expect(navigate).toHaveBeenCalledWith("/results/round/ROOM42");
  });

  it("a submit error does NOT navigate and re-enables answering", () => {
    render(<Gameplay />);
    act(() => { captured.submitOpts!.onError!(new Error("boom")); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(navigate).not.toHaveBeenCalled();
  });
});
