// Phase 5d — dual-write helper integration test.
//
// Exercises scripts/_lib/dual-write-variants.mjs end-to-end against the
// real DB:
//   1. Insert a fixture song far above any production id range.
//   2. Call syncSongVariants with 3 variants → expect:
//        - songs.lyricVariants jsonb has 3 entries
//        - 3 gameplay_items rows for the song
//        - 1-3 lyric_moments rows (depending on lyric_text dedup)
//   3. Call syncSongVariants again with 2 variants (one reused, one new)
//        → expect:
//        - songs.lyricVariants has 2 entries
//        - 2 gameplay_items rows
//        - the dropped variant's gameplay_item is gone
//        - any lyric_moment whose lyric_text isn't referenced anymore is gone
//   4. Cleanup: DELETE the fixture song. The schema's ON DELETE CASCADE on
//      gameplay_items.song_id and lyric_moments.song_id mops up the rest.
//
// Skipped without a DB connection (matches the contentReadMode test
// pattern). Vitest runs `server/**/*.test.ts` so this lands here, not in
// scripts/.

import { describe, it, expect, afterAll, beforeAll } from "vitest";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;

const HAS_DB = !!DB_URL;
const liveDescribe = HAS_DB ? describe : describe.skip;

// Use a deterministic large id well above any production range. The songs
// table has ~2k rows; 9_900_001 keeps us comfortably out of the way and is
// stable across reruns so a stuck cleanup can be wiped manually.
const FIXTURE_SONG_ID = 9_900_001;

liveDescribe("syncSongVariants (live DB)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sql: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let syncSongVariants: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let clearSongLayer3: any = null;

  beforeAll(async () => {
    const postgres = (await import("postgres")).default;
    sql = postgres(DB_URL!, { max: 2, prepare: false });
    const helper = await import("../scripts/_lib/dual-write-variants.mjs");
    syncSongVariants = helper.syncSongVariants;
    clearSongLayer3 = helper.clearSongLayer3;

    // Pre-cleanup in case a prior failed run left junk behind.
    await sql`DELETE FROM gameplay_items WHERE song_id = ${FIXTURE_SONG_ID}`;
    await sql`DELETE FROM lyric_moments  WHERE song_id = ${FIXTURE_SONG_ID}`;
    await sql`DELETE FROM songs           WHERE id      = ${FIXTURE_SONG_ID}`;

    // Insert the fixture song. Direct INSERT bypassing Drizzle so we don't
    // have to wire the ORM into a script-targeted test.
    await sql`
      INSERT INTO songs (
        id, title, "artistName", genre, "releaseYear", "decadeRange",
        "lyricPrompt", "lyricAnswer", distractors, "lyricSectionType",
        difficulty, "explicitFlag", "approvalStatus", "isActive",
        licensing_status, approved_for_game, in_curated_bank
      ) VALUES (
        ${FIXTURE_SONG_ID}, ${"DualWrite Fixture"}, ${"Test Artist"}, ${"Pop"}, ${2000}, ${"2000s"},
        ${"placeholder"}, ${"placeholder"}, ${sql.json([])}, ${"verse"},
        ${"medium"}, ${false}, ${"approved"}, ${true},
        ${"internal_only"}, ${true}, ${false}
      )
    `;
  });

  afterAll(async () => {
    if (!sql) return;
    // Belt + braces cleanup. The FKs (lyric_moments.song_id ON DELETE
    // CASCADE; gameplay_items.song_id ON DELETE CASCADE) should sweep the
    // rest, but explicit DELETEs keep the test independent of FK config
    // drift.
    await sql`DELETE FROM gameplay_items WHERE song_id = ${FIXTURE_SONG_ID}`;
    await sql`DELETE FROM lyric_moments  WHERE song_id = ${FIXTURE_SONG_ID}`;
    await sql`DELETE FROM songs           WHERE id      = ${FIXTURE_SONG_ID}`;
    await sql.end({ timeout: 5 });
  });

  it("writes 3 variants to BOTH legacy + layer-3 atomically", async () => {
    const variants = [
      {
        prompt: "first prompt line",
        answer: "answer one",
        distractors: ["d1a", "d1b", "d1c"],
        sectionType: "verse",
      },
      {
        prompt: "second prompt line",
        answer: "answer two",
        distractors: ["d2a", "d2b", "d2c"],
        sectionType: "chorus",
      },
      {
        prompt: "third prompt line",
        answer: "answer three",
        distractors: ["d3a", "d3b", "d3c"],
        sectionType: "verse",
      },
    ];

    await syncSongVariants(sql, FIXTURE_SONG_ID, variants);

    // Legacy: songs.lyricVariants jsonb
    const [songRow] = await sql`
      SELECT "lyricVariants" FROM songs WHERE id = ${FIXTURE_SONG_ID}
    `;
    expect(Array.isArray(songRow.lyricVariants)).toBe(true);
    expect(songRow.lyricVariants).toHaveLength(3);
    expect(songRow.lyricVariants[0].prompt).toBe("first prompt line");
    expect(songRow.lyricVariants[2].answer).toBe("answer three");

    // Layer-3: gameplay_items has 3 rows (one per variant).
    const items = await sql`
      SELECT id, prompt_text, correct_answer, lyric_moment_id
      FROM gameplay_items
      WHERE song_id = ${FIXTURE_SONG_ID}
      ORDER BY id ASC
    `;
    expect(items).toHaveLength(3);
    expect(items[0].prompt_text).toBe("first prompt line");
    expect(items[2].correct_answer).toBe("answer three");

    // Layer-3: lyric_moments has 1-3 rows. With three distinct lyric_text
    // values (prompt + ' ' + answer all unique here) we expect exactly 3.
    const moments = await sql`
      SELECT id, lyric_text FROM lyric_moments
      WHERE song_id = ${FIXTURE_SONG_ID}
      ORDER BY id ASC
    `;
    expect(moments.length).toBeGreaterThanOrEqual(1);
    expect(moments.length).toBeLessThanOrEqual(3);
    expect(moments).toHaveLength(3);
  });

  it("replaces variants on a second call (drops old, keeps overlap)", async () => {
    // Round 1 already left 3 variants. Now write 2: one is identical to a
    // round-1 variant, one is brand new. Net effect: songs.lyricVariants =
    // 2 entries, gameplay_items = 2 rows, the third old variant's gameplay
    // and any orphaned moment are gone.
    const replacement = [
      {
        prompt: "second prompt line",
        answer: "answer two",
        distractors: ["d2a", "d2b", "d2c"],
        sectionType: "chorus",
      },
      {
        prompt: "fresh prompt line",
        answer: "fresh answer",
        distractors: ["d4a", "d4b", "d4c"],
        sectionType: "bridge",
      },
    ];

    await syncSongVariants(sql, FIXTURE_SONG_ID, replacement);

    const [songRow] = await sql`
      SELECT "lyricVariants" FROM songs WHERE id = ${FIXTURE_SONG_ID}
    `;
    expect(songRow.lyricVariants).toHaveLength(2);
    expect(songRow.lyricVariants[0].prompt).toBe("second prompt line");
    expect(songRow.lyricVariants[1].answer).toBe("fresh answer");

    const items = await sql`
      SELECT prompt_text, correct_answer
      FROM gameplay_items
      WHERE song_id = ${FIXTURE_SONG_ID}
      ORDER BY id ASC
    `;
    expect(items).toHaveLength(2);
    const promptTexts = items.map((i: { prompt_text: string }) => i.prompt_text);
    expect(promptTexts).toContain("second prompt line");
    expect(promptTexts).toContain("fresh prompt line");
    // The dropped variant's prompt_text should be gone.
    expect(promptTexts).not.toContain("first prompt line");
    expect(promptTexts).not.toContain("third prompt line");

    const moments = await sql`
      SELECT lyric_text FROM lyric_moments
      WHERE song_id = ${FIXTURE_SONG_ID}
    `;
    // After replacement, only the lyric_text values from the 2 new variants
    // should remain. (lyric_text = prompt + ' ' + answer.)
    const lyricTexts = moments.map((m: { lyric_text: string }) => m.lyric_text);
    expect(lyricTexts).toContain("second prompt line answer two");
    expect(lyricTexts).toContain("fresh prompt line fresh answer");
    expect(lyricTexts).not.toContain("first prompt line answer one");
    expect(lyricTexts).not.toContain("third prompt line answer three");
  });

  it("is idempotent — same input twice produces the same final state", async () => {
    const variants = [
      {
        prompt: "idempotent prompt",
        answer: "idempotent answer",
        distractors: ["x", "y", "z"],
        sectionType: "verse",
      },
    ];

    await syncSongVariants(sql, FIXTURE_SONG_ID, variants);
    const snap1 = await sql`
      SELECT "lyricVariants" FROM songs WHERE id = ${FIXTURE_SONG_ID}
    `;
    const items1 = await sql`
      SELECT prompt_text, correct_answer FROM gameplay_items
      WHERE song_id = ${FIXTURE_SONG_ID}
      ORDER BY id ASC
    `;
    const moments1 = await sql`
      SELECT lyric_text FROM lyric_moments
      WHERE song_id = ${FIXTURE_SONG_ID}
      ORDER BY id ASC
    `;

    await syncSongVariants(sql, FIXTURE_SONG_ID, variants);
    const snap2 = await sql`
      SELECT "lyricVariants" FROM songs WHERE id = ${FIXTURE_SONG_ID}
    `;
    const items2 = await sql`
      SELECT prompt_text, correct_answer FROM gameplay_items
      WHERE song_id = ${FIXTURE_SONG_ID}
      ORDER BY id ASC
    `;
    const moments2 = await sql`
      SELECT lyric_text FROM lyric_moments
      WHERE song_id = ${FIXTURE_SONG_ID}
      ORDER BY id ASC
    `;

    // Same shape both runs. (Row IDs differ because we DELETE+INSERT, but
    // the test doesn't care — the contract is "same logical content".)
    expect(snap1[0].lyricVariants).toEqual(snap2[0].lyricVariants);
    expect(items1.map((r: { prompt_text: string }) => r.prompt_text)).toEqual(
      items2.map((r: { prompt_text: string }) => r.prompt_text),
    );
    expect(moments1.map((r: { lyric_text: string }) => r.lyric_text)).toEqual(
      moments2.map((r: { lyric_text: string }) => r.lyric_text),
    );
  });

  it("clearSongLayer3 removes layer-3 rows but leaves the legacy jsonb", async () => {
    // Set up some content first.
    await syncSongVariants(sql, FIXTURE_SONG_ID, [
      {
        prompt: "to be cleared",
        answer: "cleared answer",
        distractors: ["c1", "c2", "c3"],
        sectionType: "verse",
      },
    ]);

    await clearSongLayer3(sql, FIXTURE_SONG_ID);

    const items = await sql`
      SELECT id FROM gameplay_items WHERE song_id = ${FIXTURE_SONG_ID}
    `;
    expect(items).toHaveLength(0);
    const moments = await sql`
      SELECT id FROM lyric_moments WHERE song_id = ${FIXTURE_SONG_ID}
    `;
    expect(moments).toHaveLength(0);

    // Legacy jsonb is intentionally preserved.
    const [songRow] = await sql`
      SELECT "lyricVariants" FROM songs WHERE id = ${FIXTURE_SONG_ID}
    `;
    expect(Array.isArray(songRow.lyricVariants)).toBe(true);
    expect(songRow.lyricVariants).toHaveLength(1);
    expect(songRow.lyricVariants[0].prompt).toBe("to be cleared");
  });
});
