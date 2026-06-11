import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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
// Celebration: props-capturing stub (replaces null mock so we can assert level + message)
const celebrationProps = vi.hoisted(() => ({ last: null as { level: number; onComplete?: () => void; message?: string | null } | null }));
vi.mock("@/components/Celebration", () => ({
  __esModule: true,
  default: (props: { level: number; onComplete?: () => void; message?: string | null }) => { celebrationProps.last = props; return null; },
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
  beforeEach(() => {
    sessionStorage.clear();
    navigate.mockClear();
    nextRound.mutate.mockClear();
    celebrationProps.last = null;
  });

  it("shows the Lyric row on LOW difficulty (all four axes visible)", () => {
    seedResult({ difficulty: "low" });
    render(<RoundResults />);
    // NOTE: getAllByText assertions below only prove the text exists somewhere in the DOM;
    // Answer Reveal also renders these labels, so counts may be >= 2.
    expect(screen.getByText("Lyric")).toBeTruthy();
    expect(screen.getAllByText("Song Title").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Artist").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Release Year").length).toBeGreaterThanOrEqual(1);
    // Assert the lyric denominator is wired: ScoreRow renders "/ {maxPoints}".
    // On low difficulty lyric/title/artist all cap at 25, so "/ 25" appears 3 times.
    expect(screen.getAllByText("/ 25").length).toBeGreaterThanOrEqual(1);
  });

  it("shows correct max denominators on HIGH difficulty", () => {
    seedResult({
      difficulty: "high",
      lyricPoints: 50, titlePoints: 50, artistPoints: 100, yearPoints: 200,
      total: 400, newScore: 400,
    });
    render(<RoundResults />);
    // NOTE: getAllByText assertions below only prove the text exists somewhere in the DOM;
    // Answer Reveal also contains these labels, so counts may be >= 2.
    expect(screen.getAllByText("Lyric").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Artist").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Release Year").length).toBeGreaterThanOrEqual(1);
    // ScoreRow renders "/ {maxPoints}" — assert each axis denominator for high difficulty.
    // Lyric and title both cap at 50 on high, so "/ 50" appears twice; use getAllByText.
    expect(screen.getAllByText("/ 50").length).toBeGreaterThanOrEqual(1);  // lyric+title max on high
    expect(screen.getByText("/ 100")).toBeTruthy();                        // artist max on high
    expect(screen.getByText("/ 200")).toBeTruthy();                        // year max on high
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

  it("celebration level is set on mount for a 4-correct round (no click needed)", () => {
    seedResult({ celebrationCount: 4 });
    render(<RoundResults />);
    expect(celebrationProps.last?.level).toBe(3);
  });

  it("Next Round advances immediately (mutation fires on click)", () => {
    seedResult({
      celebrationCount: 0, total: 0, correctCount: 0,
      lyricPoints: 0, titlePoints: 0, artistPoints: 0, yearPoints: 0,
      lyricCorrect: false, titleCorrect: false, artistCorrect: false, newScore: 0,
    });
    render(<RoundResults />);
    fireEvent.click(screen.getByRole("button", { name: /Next Round/i }));
    expect(nextRound.mutate).toHaveBeenCalled();
  });

  it("passes a stable onComplete to Celebration across re-renders", () => {
    seedResult({ celebrationCount: 4 });
    const { rerender } = render(<RoundResults />);
    const first = celebrationProps.last?.onComplete;
    rerender(<RoundResults />);
    expect(celebrationProps.last?.onComplete).toBe(first);
  });

  it("renders stake win line when stake.win > 0", () => {
    seedResult({
      stake: { staked: 50, burned: 0, win: 25, burn: 0, remaining: 50 },
    });
    render(<RoundResults />);
    expect(screen.getByTestId("stake-line")).toBeTruthy();
    expect(screen.getByTestId("stake-line").textContent).toContain("+25 GN won");
    expect(screen.getByTestId("stake-line").textContent).toContain("50 staked remaining");
  });

  it("renders no stake line when stake is absent", () => {
    seedResult(); // no stake field
    render(<RoundResults />);
    expect(screen.queryByTestId("stake-line")).toBeNull();
  });

  it("passes commentary as message prop to Celebration when celebrationCount >= 2", () => {
    const commentary = "Three out of four — that's a strong round";
    seedResult({ celebrationCount: 3, commentary });
    render(<RoundResults />);
    expect(celebrationProps.last?.level).toBe(2);
    expect(celebrationProps.last?.message).toBe(commentary);
  });
});
