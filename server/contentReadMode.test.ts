// Phase 5c — feature-flag + dual-path symmetry tests.
//
// Two layers of testing:
//
// 1. Pure unit: verify `contentReadMode.READ_FROM_LAYER3` resolves
//    correctly from `process.env.LYRIC_PRO_READ_FROM_LAYER3` and that
//    `variantsForSong` / `loadVariantsForSongs` dispatch on it.
// 2. Live-DB integration: with the flag OFF, run a known song through
//    the legacy path; with the flag ON, run the same song through the
//    layer-3 path. Both paths MUST produce variants whose prompt + answer
//    + distractors are identical position-by-position. sectionType is
//    NOT compared because Phase 5b's ON CONFLICT collapses moment rows on
//    duplicate lyric_text within a song, so the section_type stored for a
//    collapsed moment is the FIRST variant's, not the n-th's. The runtime
//    never reads variant.sectionType, so this drift is harmless.
//
// Live-DB integration is gated on `SUPABASE_SESSION_POOLER_STRING` (or
// fallback) being set. CI without DB credentials skips those cases.

import { describe, it, expect, beforeEach, afterAll } from "vitest";

// ── Helpers ─────────────────────────────────────────────────────────────
async function loadFresh(envFlag: string | undefined) {
  // Each "fresh load" sets the env var first, drops the module cache, then
  // re-imports. This is the only reliable way to test a module-load-time
  // env capture because import() returns the cached evaluation.
  if (envFlag === undefined) {
    delete process.env.LYRIC_PRO_READ_FROM_LAYER3;
  } else {
    process.env.LYRIC_PRO_READ_FROM_LAYER3 = envFlag;
  }
  const vitestImport = await import("vitest");
  vitestImport.vi.resetModules();
  return {
    contentReadMode: await import("./_core/contentReadMode"),
    variantReader: await import("./_core/variantReader"),
  };
}

// Minimal Song fixture — keeps the legacy reader self-contained without
// needing a DB. The schema-typed fields the legacy reader reads are filled
// with deterministic values; the rest are zeroed.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fixtureSong(overrides: Record<string, any> = {}): any {
  return {
    id: 99999,
    title: "Test Song",
    artistName: "Test Artist",
    artistMetadataId: null,
    genre: "Hip Hop",
    subgenre: null,
    releaseYear: 2000,
    decadeRange: "2000s",
    lyricPrompt: "Legacy prompt",
    lyricAnswer: "legacy answer",
    distractors: ["d-a", "d-b", "d-c"],
    lyricVariants: [
      {
        prompt: "First prompt",
        answer: "first answer",
        distractors: ["da", "db", "dc"],
        sectionType: "verse",
      },
      {
        prompt: "Second prompt",
        answer: "second answer",
        distractors: ["ea", "eb", "ec"],
        sectionType: "chorus",
      },
    ],
    lyricSectionType: "verse",
    difficulty: "medium",
    language: "en",
    explicitFlag: false,
    approvalStatus: "approved",
    isActive: true,
    featuredArtist: null,
    licensingStatus: "internal_only",
    approvedForGame: true,
    inCuratedBank: false,
    curatorNotes: null,
    displayCount: 0,
    lastShownAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Flag resolution ─────────────────────────────────────────────────────

describe("contentReadMode.READ_FROM_LAYER3 flag resolution", () => {
  beforeEach(() => {
    delete process.env.LYRIC_PRO_READ_FROM_LAYER3;
  });

  it("OFF when env var is unset", async () => {
    const { contentReadMode } = await loadFresh(undefined);
    expect(contentReadMode.READ_FROM_LAYER3).toBe(false);
  });

  it("OFF for empty string", async () => {
    const { contentReadMode } = await loadFresh("");
    expect(contentReadMode.READ_FROM_LAYER3).toBe(false);
  });

  it("OFF for '0'", async () => {
    const { contentReadMode } = await loadFresh("0");
    expect(contentReadMode.READ_FROM_LAYER3).toBe(false);
  });

  it("OFF for arbitrary truthy-looking strings ('yes', 'on')", async () => {
    const a = await loadFresh("yes");
    expect(a.contentReadMode.READ_FROM_LAYER3).toBe(false);
    const b = await loadFresh("on");
    expect(b.contentReadMode.READ_FROM_LAYER3).toBe(false);
  });

  it("ON for '1'", async () => {
    const { contentReadMode } = await loadFresh("1");
    expect(contentReadMode.READ_FROM_LAYER3).toBe(true);
  });

  it("ON for 'true' (case-insensitive)", async () => {
    const a = await loadFresh("true");
    expect(a.contentReadMode.READ_FROM_LAYER3).toBe(true);
    const b = await loadFresh("TRUE");
    expect(b.contentReadMode.READ_FROM_LAYER3).toBe(true);
    const c = await loadFresh("True");
    expect(c.contentReadMode.READ_FROM_LAYER3).toBe(true);
  });

  it("trims whitespace before evaluating", async () => {
    const { contentReadMode } = await loadFresh("  1  ");
    expect(contentReadMode.READ_FROM_LAYER3).toBe(true);
  });
});

// ── Legacy reader (always available, no DB needed) ──────────────────────

describe("variantsForSong: legacy path (flag OFF)", () => {
  it("returns the song's lyricVariants array as-is", async () => {
    const { variantReader } = await loadFresh(undefined);
    const song = fixtureSong();
    const out = await variantReader.variantsForSong(null, song);
    expect(out).toEqual(song.lyricVariants);
  });

  it("falls back to legacy columns when lyricVariants is empty", async () => {
    const { variantReader } = await loadFresh(undefined);
    const song = fixtureSong({ lyricVariants: [] });
    const out = await variantReader.variantsForSong(null, song);
    expect(out).toEqual([
      {
        prompt: song.lyricPrompt,
        answer: song.lyricAnswer,
        distractors: song.distractors,
        sectionType: song.lyricSectionType,
      },
    ]);
  });

  it("flag OFF preserves the SongVariant shape per index", async () => {
    const { variantReader } = await loadFresh("0");
    const song = fixtureSong();
    const out = await variantReader.variantsForSong(null, song);
    expect(out.length).toBe(2);
    expect(out[0].prompt).toBe("First prompt");
    expect(out[0].answer).toBe("first answer");
    expect(out[0].distractors).toEqual(["da", "db", "dc"]);
    expect(out[1].prompt).toBe("Second prompt");
    expect(out[1].answer).toBe("second answer");
  });
});

describe("loadVariantsForSongs: legacy path (flag OFF)", () => {
  it("builds a Map<id, Variant[]> without touching the DB", async () => {
    const { variantReader } = await loadFresh(undefined);
    const a = fixtureSong({ id: 1 });
    const b = fixtureSong({ id: 2, lyricVariants: [] });
    // Pass a sentinel db that would throw if accessed, to prove we don't
    // touch it on the OFF path.
    const dbThatThrows = new Proxy(
      {},
      {
        get() {
          throw new Error("DB must NOT be accessed when flag is OFF");
        },
      },
    );
    const map = await variantReader.loadVariantsForSongs(dbThatThrows, [a, b]);
    expect(map.size).toBe(2);
    expect(map.get(1)).toEqual(a.lyricVariants);
    // Empty lyricVariants → legacy-column synth.
    expect(map.get(2)?.length).toBe(1);
    expect(map.get(2)?.[0].answer).toBe("legacy answer");
  });
});

// ── Live-DB integration (skipped if no DB connection) ───────────────────

const HAS_DB =
  !!process.env.SUPABASE_SESSION_POOLER_STRING ||
  !!process.env.SUPABASE_DIRECT_CONNECTION_STRING ||
  !!process.env.DATABASE_URL;

const liveDescribe = HAS_DB ? describe : describe.skip;

liveDescribe("variantsForSong: layer-3 path (flag ON, live DB)", () => {
  // Pick a known active song id with multiple variants. id=1 is "The
  // Message" — Grandmaster Flash, verified to have 3 legacy variants AND 3
  // matching gameplay_items rows by Phase 5b's verification.
  const KNOWN_SONG_IDS = [1, 2, 3, 218, 326];

  let dbHandle: unknown = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let postgresClient: any = null;

  beforeEach(async () => {
    // Connect once per test to avoid leaking handles across the suite.
    if (!dbHandle) {
      const url =
        process.env.SUPABASE_SESSION_POOLER_STRING ??
        process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
        process.env.DATABASE_URL;
      if (!url) return;
      const postgres = (await import("postgres")).default;
      const { drizzle } = await import("drizzle-orm/postgres-js");
      postgresClient = postgres(url, { max: 2, prepare: false });
      dbHandle = drizzle(postgresClient);
    }
  });

  afterAll(async () => {
    if (postgresClient) await postgresClient.end();
  });

  async function loadSong(songId: number) {
    if (!postgresClient) return null;
    const rows = await postgresClient`
      SELECT * FROM songs WHERE id = ${songId} LIMIT 1
    `;
    return rows[0] ?? null;
  }

  it("flag ON returns the same prompt+answer+distractors per index as flag OFF", async () => {
    if (!dbHandle) return;
    for (const songId of KNOWN_SONG_IDS) {
      // Resolve the song row directly from postgres-js — bypassing
      // Drizzle's column-name munging keeps this test independent of
      // schema drift.
      const songRow = await loadSong(songId);
      if (!songRow) continue;

      // Adapt the raw DB row into the shape `variantsFromLegacy` expects.
      // Drizzle column aliases differ (`lyricVariants` vs the underlying
      // `"lyricVariants"`). postgres-js returns whatever the SELECT *
      // resolved, so the keys are already the camelCase quoted names.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const songLikeShape: any = {
        id: songRow.id,
        title: songRow.title,
        artistName: songRow.artistName,
        lyricPrompt: songRow.lyricPrompt,
        lyricAnswer: songRow.lyricAnswer,
        distractors: songRow.distractors,
        lyricVariants: songRow.lyricVariants,
        lyricSectionType: songRow.lyricSectionType,
      };

      // OFF — legacy
      const off = await loadFresh(undefined);
      const legacy = await off.variantReader.variantsForSong(
        dbHandle,
        songLikeShape,
      );

      // ON — layer 3 (live DB)
      const on = await loadFresh("1");
      const layer3 = await on.variantReader.variantsForSong(
        dbHandle,
        songLikeShape,
      );

      expect(layer3.length).toBe(legacy.length);
      for (let i = 0; i < legacy.length; i++) {
        expect(layer3[i].prompt.trim()).toBe(legacy[i].prompt.trim());
        expect(layer3[i].answer.trim()).toBe(legacy[i].answer.trim());
        // distractors compared as ordered arrays.
        const lDs = (legacy[i].distractors ?? []).slice(0, 3);
        const tDs = (layer3[i].distractors ?? []).slice(0, 3);
        expect(tDs).toEqual(lDs);
      }
    }
  });
});
