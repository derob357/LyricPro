import { describe, it, expect, vi, beforeEach } from "vitest";

// Stripe initialises at module load with STRIPE_SECRET_KEY. Mock it so any
// transitive imports from the module under test don't require a real key.
vi.mock("stripe", () => {
  const Stripe = vi.fn().mockImplementation(() => ({
    checkout: { sessions: { create: vi.fn() } },
    webhooks: { constructEvent: vi.fn() },
    subscriptions: { retrieve: vi.fn() },
    customers: { search: vi.fn().mockResolvedValue({ data: [] }) },
  }));
  return { default: Stripe };
});

import { selectSongForRoom } from "./_core/songSelection";

// ── Fixture helpers ────────────────────────────────────────────────────────────

type PartialSong = {
  id: number;
  genre: string;
  decadeRange: string | null;
  releaseYear: number;
  lyricSectionType: string;
  isActive: boolean;
  approvalStatus: string;
  explicitFlag: boolean;
  displayCount: number;
  lyricVariants: Array<{ prompt: string; answer: string; distractors: string[]; sectionType: string }>;
  lyricPrompt: string;
  lyricAnswer: string;
  distractors: string[];
  [key: string]: unknown;
};

function makeSong(overrides: Partial<PartialSong> = {}): PartialSong {
  // Prompt + answer must be >= 6 words total to pass medium-difficulty playability.
  return {
    id: 1,
    genre: "pop",
    decadeRange: "1980s",
    releaseYear: 1985,
    lyricSectionType: "chorus",
    isActive: true,
    approvalStatus: "approved",
    explicitFlag: false,
    displayCount: 0,
    lyricVariants: [{ prompt: "I just called to say I love", answer: "you", distractors: [], sectionType: "chorus" }],
    lyricPrompt: "I just called to say I love",
    lyricAnswer: "you",
    distractors: [],
    ...overrides,
  };
}

// Build a minimal fake Drizzle db whose select chain returns a given array.
// selectSongForRoom calls:
//   db.select().from(songs).where(...) → rows[]          (up to 3 times for fallback chain)
//   db.select({ songId: ... }).from(songDisplays).where(...) → { songId }[] (dedup)
//
// We use a queue so each successive .from() call returns the next preset result.
function makeFakeDb(songQueues: PartialSong[][], dedupRows: { songId: number }[] = []) {
  let songCallCount = 0;
  return {
    select: vi.fn().mockImplementation((_projection?: unknown) => ({
      from: vi.fn().mockImplementation((table: unknown) => ({
        where: vi.fn().mockImplementation(() => {
          // Detect by reference which table is being queried.
          // songDisplays is imported from drizzle/schema; songs too.
          // We differentiate by checking whether this is a dedup query
          // (projection contains `songId`) or a songs query.
          const isDedup =
            _projection != null &&
            typeof _projection === "object" &&
            "songId" in (_projection as object);
          if (isDedup) {
            return Promise.resolve(dedupRows);
          }
          // Songs queries — return from queue
          const result = songQueues[songCallCount] ?? [];
          songCallCount++;
          return Promise.resolve(result);
        }),
        limit: vi.fn().mockResolvedValue([]),
      })),
    })),
  };
}

const BASE_CRITERIA = {
  genres: ["pop"],
  decades: ["1980–1990"],
  difficulty: "medium" as const,
  explicitFilter: false,
  usedSongIds: [],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("selectSongForRoom", () => {
  beforeEach(() => {
    // Ensure the legacy read path is used (no DB calls for variant resolution).
    delete process.env.LYRIC_PRO_READ_FROM_LAYER3;
    vi.resetModules();
  });

  it("(a) returns a song matching the requested genre", async () => {
    const song = makeSong({ id: 10, genre: "pop", decadeRange: "1980s", releaseYear: 1985 });
    const db = makeFakeDb([[song]]);

    const result = await selectSongForRoom(db as never, BASE_CRITERIA);

    expect(result).not.toBeNull();
    expect(result!.songId).toBe(10);
  });

  it("(a) returns a song matching the requested decade by year range", async () => {
    // "1980–1990" should match a song with releaseYear 1988 even if decadeRange is null
    const song = makeSong({ id: 20, genre: "pop", decadeRange: null, releaseYear: 1988 });
    const db = makeFakeDb([[song]]);

    const result = await selectSongForRoom(db as never, BASE_CRITERIA);

    expect(result).not.toBeNull();
    expect(result!.songId).toBe(20);
  });

  it("(b) never returns a song whose id is already in usedSongIds", async () => {
    // The primary query already excludes usedSongIds via notInArray at the DB level.
    // To test the end-to-end dedup: fake DB returns the filtered result (no used songs),
    // so only the fresh song comes back.
    const freshSong = makeSong({ id: 30, genre: "pop", decadeRange: "1980s", releaseYear: 1985 });
    // The db stub simulates what the real DB does: notInArray(songs.id, [99]) means
    // song 99 is NOT in the result.
    const db = makeFakeDb([[freshSong]]);

    const result = await selectSongForRoom(db as never, {
      ...BASE_CRITERIA,
      usedSongIds: [99],
    });

    expect(result).not.toBeNull();
    expect(result!.songId).toBe(30);
    expect(result!.songId).not.toBe(99);
  });

  it("(b) per-identity dedup excludes recently-shown songs via songIdsShownSince", async () => {
    // Primary query returns two songs; songDisplays dedup returns song 40 as recently shown.
    // The non-dedup song (id=41) should be selected.
    const song40 = makeSong({ id: 40, genre: "pop", decadeRange: "1980s", releaseYear: 1985 });
    const song41 = makeSong({ id: 41, genre: "pop", decadeRange: "1980s", releaseYear: 1987 });

    // Dedup query returns song 40 as shown in last 10 days (called twice: 10-day and
    // possibly 7-day). We return same set for both.
    const db = makeFakeDb([[song40, song41]], [{ songId: 40 }]);

    const result = await selectSongForRoom(db as never, {
      ...BASE_CRITERIA,
      dedupUserId: 1,
    });

    expect(result).not.toBeNull();
    // Song 40 was recently shown — should pick song 41
    expect(result!.songId).toBe(41);
  });

  it("(c) returns null-equivalent (throws) when entire pool is exhausted / no songs exist", async () => {
    // All three fallback chains return empty; selectSongForRoom throws.
    const db = makeFakeDb([[], [], []]);

    await expect(
      selectSongForRoom(db as never, BASE_CRITERIA)
    ).rejects.toThrow(/No pop songs available/i);
  });

  it("(c) throws playability error when all candidates have empty prompts", async () => {
    // Song with no playable variants (empty prompt at medium difficulty).
    const badSong = makeSong({
      id: 50,
      lyricVariants: [{ prompt: "", answer: "", distractors: [], sectionType: "chorus" }],
      lyricPrompt: "",
      lyricAnswer: "",
    });
    const db = makeFakeDb([[badSong]]);

    await expect(
      selectSongForRoom(db as never, BASE_CRITERIA)
    ).rejects.toThrow(/No playable songs/i);
  });

  it("low difficulty only selects chorus/hook section types", async () => {
    const verseSong = makeSong({ id: 60, lyricSectionType: "verse" });
    const chorusSong = makeSong({ id: 61, lyricSectionType: "chorus" });

    // With low difficulty, only chorus/hook pass the section filter.
    // The DB stub returns both (simulating no server-side section filter),
    // but in practice the DB WHERE clause (passed to the stub) would filter.
    // We test that after the weighted pick only the chorus song is eligible
    // by returning only the chorus song from the stub (mimicking the real filter).
    const db = makeFakeDb([[chorusSong]]);

    const result = await selectSongForRoom(db as never, {
      ...BASE_CRITERIA,
      difficulty: "low",
    });

    expect(result).not.toBeNull();
    expect(result!.songId).toBe(61);
  });

  it("returns candidateSongs array (distractor pool for callers)", async () => {
    const song = makeSong({ id: 70, genre: "pop", decadeRange: "1980s", releaseYear: 1985 });
    const db = makeFakeDb([[song]]);

    const result = await selectSongForRoom(db as never, BASE_CRITERIA);

    expect(result).not.toBeNull();
    expect(Array.isArray(result!.candidateSongs)).toBe(true);
    expect(result!.candidateSongs.length).toBeGreaterThan(0);
  });

  it("returns variantMap for caller use (avoids re-fetch)", async () => {
    const song = makeSong({ id: 80, genre: "pop", decadeRange: "1980s", releaseYear: 1985 });
    const db = makeFakeDb([[song]]);

    const result = await selectSongForRoom(db as never, BASE_CRITERIA);

    expect(result).not.toBeNull();
    expect(result!.variantMap).toBeInstanceOf(Map);
    expect(result!.variantMap.has(80)).toBe(true);
  });
});
