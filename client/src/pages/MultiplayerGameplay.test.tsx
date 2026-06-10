/**
 * MultiplayerGameplay — synchronized match screen.
 *
 * Mocks (model on Interstitial.test.tsx + VideoLobby.start.test.tsx):
 *   - wouter: useParams (roomCode = "ROOM42"), useLocation ([path, navigate])
 *   - @/lib/game/useGameChannel: no-op
 *   - @/_core/hooks/useAuth: { user: { id: 1 } }
 *   - @/lib/livekit/useLiveKitRoom: idle/null (no WebRTC)
 *   - @/components/livekit/VideoGrid: no-op div
 *   - @/lib/trpc: match.getMatchState.useQuery (in_question round w/ question),
 *     match.submitAnswer/revealRound/advanceRound.useMutation (hoisted mutateAsync),
 *     liveRoom.refreshToken/leaveLiveRoom.useMutation
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── wouter ──────────────────────────────────────────────────────────────────
const navigate = vi.fn();
vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return {
    ...actual,
    useParams: () => ({ roomCode: "ROOM42" }),
    useLocation: () => ["/match/ROOM42", navigate],
  };
});

// ── useGameChannel: no-op ─────────────────────────────────────────────────────
vi.mock("@/lib/game/useGameChannel", () => ({ useGameChannel: vi.fn() }));

// ── useAuth: local player is user 1 ──────────────────────────────────────────
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1 }, isAuthenticated: true }),
}));

// ── LiveKit: skip WebRTC ─────────────────────────────────────────────────────
vi.mock("@/lib/livekit/useLiveKitRoom", () => ({
  useLiveKitRoom: () => ({
    room: null,
    participants: [],
    status: "idle",
    error: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));
vi.mock("@/components/livekit/VideoGrid", () => ({
  VideoGrid: () => <div data-testid="video-grid" />,
}));

// ── trpc ─────────────────────────────────────────────────────────────────────
const submitAnswer = vi.hoisted(() => vi.fn());
const revealRound = vi.hoisted(() => vi.fn());
const advanceRound = vi.hoisted(() => vi.fn());
const refreshToken = vi.hoisted(() => vi.fn());
const leaveLiveRoom = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn());
const matchState = vi.hoisted(() => ({
  value: null as unknown,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    match: {
      getMatchState: {
        useQuery: () => ({ data: matchState.value, refetch }),
      },
      submitAnswer: { useMutation: () => ({ mutateAsync: submitAnswer, isPending: false }) },
      revealRound: { useMutation: () => ({ mutateAsync: revealRound }) },
      advanceRound: { useMutation: () => ({ mutateAsync: advanceRound }) },
    },
    liveRoom: {
      refreshToken: { useMutation: () => ({ mutateAsync: refreshToken }) },
      leaveLiveRoom: { useMutation: () => ({ mutateAsync: leaveLiveRoom }) },
    },
  },
}));

import MultiplayerGameplay from "./MultiplayerGameplay";

function inQuestionState(overrides: Record<string, unknown> = {}) {
  return {
    room: {
      id: 7,
      roomCode: "ROOM42",
      status: "active",
      roundPhase: "in_question",
      currentRound: 1,
      roundsTotal: 3,
      roundEndsAt: new Date(Date.now() + 30_000).toISOString(),
      currentSongId: 100,
      currentQuestion: {
        songId: 100,
        promptLyric: "Is this the real life",
        difficulty: "low",
        titleOptions: ["Bohemian Rhapsody", "We Will Rock You"],
        artistOptions: ["Queen", "The Beatles"],
        yearOptions: [1975, 1980],
        lyricOptions: ["Is this just fantasy", "Caught in a landslide"],
      },
      difficulty: "low",
      timerSeconds: 30,
      hostUserId: 1,
      maxPlayers: 8,
    },
    players: [
      { id: 11, userId: 1, guestName: null, currentScore: 0, isReady: true, isActive: true, joinOrder: 1 },
      { id: 12, userId: 2, guestName: "Sam", currentScore: 50, isReady: true, isActive: true, joinOrder: 2 },
    ],
    standings: [
      { rank: 1, playerId: 12, score: 50 },
      { rank: 2, playerId: 11, score: 0 },
    ],
    ...overrides,
  };
}

describe("MultiplayerGameplay", () => {
  beforeEach(() => {
    navigate.mockClear();
    submitAnswer.mockReset().mockResolvedValue({ totalRoundPoints: 75 });
    revealRound.mockReset().mockResolvedValue({ revealed: true });
    advanceRound.mockReset().mockResolvedValue({ advanced: true });
    refreshToken.mockReset().mockResolvedValue({ token: "tok", livekitUrl: "wss://x" });
    leaveLiveRoom.mockReset().mockResolvedValue({});
    refetch.mockReset();
    matchState.value = inQuestionState();
  });

  it("renders the question prompt and title options as clickable buttons", async () => {
    render(<MultiplayerGameplay />);
    await waitFor(() => expect(screen.getByTestId("match-question")).toBeTruthy());
    expect(screen.getByTestId("match-question").textContent).toContain("Is this the real life");
    // Title options render as buttons
    expect(screen.getByRole("button", { name: /Bohemian Rhapsody/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /We Will Rock You/i })).toBeTruthy();
  });

  it("selecting answers + submitting calls submitAnswer with the chosen answers + roomCode", async () => {
    render(<MultiplayerGameplay />);
    await waitFor(() => expect(screen.getByTestId("match-question")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Bohemian Rhapsody/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Queen$/i }));
    fireEvent.click(screen.getByRole("button", { name: /1975/i }));
    fireEvent.click(screen.getByTestId("match-submit"));

    await waitFor(() => expect(submitAnswer).toHaveBeenCalled());
    const arg = submitAnswer.mock.calls[0][0];
    expect(arg.roomCode).toBe("ROOM42");
    expect(arg.titleAnswer).toBe("Bohemian Rhapsody");
    expect(arg.artistAnswer).toBe("Queen");
    expect(arg.yearAnswer).toBe(1975);
  });

  it("navigates to /results/final/ROOM42 when the match is finished", async () => {
    matchState.value = inQuestionState({
      room: { ...(inQuestionState().room as Record<string, unknown>), status: "finished" },
    });
    render(<MultiplayerGameplay />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/results/final/ROOM42"));
  });

  it("calls revealRound early when all active players have answered before the countdown expires", async () => {
    // Both active players (ids 11 and 12) have answered; timer is still running (30 s left).
    matchState.value = {
      ...inQuestionState(),
      answeredPlayerIds: [11, 12],
    };
    render(<MultiplayerGameplay />);
    await waitFor(() =>
      expect(revealRound).toHaveBeenCalledWith({ roomCode: "ROOM42" }),
    );
  });
});
