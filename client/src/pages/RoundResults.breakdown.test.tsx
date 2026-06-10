import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return {
    ...actual,
    useLocation: () => ["/results/round/ROOM42", navigate],
    useParams: () => ({ roomCode: "ROOM42" }),
  };
});
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAuthenticated: false }),
}));
const nextRound = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    game: {
      getRoom: { useQuery: () => ({ data: { currentRound: 1, roundsTotal: 3, difficulty: "low" } }) },
      nextRound: { useMutation: () => nextRound },
    },
  },
}));
// Celebration renders canvas/WebAudio — stub it out in jsdom
vi.mock("@/components/Celebration", () => ({
  __esModule: true,
  default: () => null,
}));

import RoundResults from "./RoundResults";

function seedResult(overrides: Record<string, unknown> = {}) {
  sessionStorage.setItem("lyricpro_round_result_ROOM42", JSON.stringify({
    lyricCorrect: true, artistCorrect: true, titleCorrect: true,
    lyricPoints: 25, artistPoints: 25, titlePoints: 25, yearPoints: 50,
    speedBonus: 0, streakBonus: 0, total: 125, newScore: 125, newStreak: 1,
    correctLyric: "the answer line", correctArtist: "Artist", correctYear: 1999,
    correctCount: 4, celebrationCount: 4, difficulty: "low", commentary: null,
    song: { id: 1, title: "Song", artistName: "Artist", lyricPrompt: "prompt", genre: "Pop", decade: "1990–2000" },
    ...overrides,
  }));
}

describe("RoundResults score breakdown", () => {
  beforeEach(() => { sessionStorage.clear(); navigate.mockClear(); nextRound.mutate.mockClear(); });

  it("shows the Lyric row on LOW difficulty (all four axes visible)", () => {
    seedResult({ difficulty: "low" });
    render(<RoundResults />);
    // Score breakdown labels — several also appear in the Answer Reveal section below
    expect(screen.getByText("Lyric")).toBeTruthy();
    expect(screen.getAllByText("Song Title").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Artist").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Release Year").length).toBeGreaterThanOrEqual(1);
  });

  it("zero-score round shows encouraging copy, not 'Round Passed'", () => {
    seedResult({
      difficulty: "low",
      lyricCorrect: false, artistCorrect: false, titleCorrect: false,
      lyricPoints: 0, artistPoints: 0, titlePoints: 0, yearPoints: 0,
      total: 0, newScore: 0, correctCount: 0, celebrationCount: 0,
    });
    render(<RoundResults />);
    expect(screen.queryByText("Round Passed")).toBeNull();
    expect(screen.getByText(/Tough Round/i)).toBeTruthy();
    expect(screen.getAllByText("Song Title").length).toBeGreaterThanOrEqual(1);
  });
});
