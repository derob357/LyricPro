import { describe, it, expect } from "vitest";
import { selectCustomPackSong } from "./_core/customPack";

// Minimal fake db: each terminal query (.limit() or awaited .where()) pulls the
// next queued result array, in call order.
function makeFakeDb(results: any[][]) {
  let i = 0;
  const nextResult = () => results[i++] ?? [];
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => {
      // Lazy: only the terminal that is actually awaited pulls a result, so a
      // `.where(...).limit(1)` chain consumes ONE queued result (via .limit),
      // not two. A bare awaited `.where(...)` consumes one (via then).
      const p: any = {
        then: (resolve: any, reject: any) => Promise.resolve(nextResult()).then(resolve, reject),
        limit: () => Promise.resolve(nextResult()),
      };
      return p;
    },
  };
  return chain;
}

const SONG = { id: 7, genre: "R&B", isActive: true, approvalStatus: "approved" };
const POOL = [{ id: 8 }, { id: 9 }, { id: 10 }];

describe("selectCustomPackSong", () => {
  it("serves the song at index = usedSongIds.length", async () => {
    const db = makeFakeDb([[SONG], POOL]);
    const pick = await selectCustomPackSong(db as never, {
      customPackSongIds: [5, 7, 9], customPackVariants: null, usedSongIds: [5],
    });
    expect(pick).not.toBeNull();
    expect(pick!.song.id).toBe(7);
    expect(pick!.candidateSongs.some((s: any) => s.id === 7)).toBe(true);
    expect(pick!.variantIndex).toBeNull();
  });

  it("returns null when the pack is exhausted", async () => {
    const db = makeFakeDb([]);
    const pick = await selectCustomPackSong(db as never, {
      customPackSongIds: [5, 7], customPackVariants: null, usedSongIds: [5, 7],
    });
    expect(pick).toBeNull();
  });

  it("passes through a valid variant override", async () => {
    const db = makeFakeDb([[SONG], POOL]);
    const pick = await selectCustomPackSong(db as never, {
      customPackSongIds: [7], customPackVariants: [2], usedSongIds: [],
    });
    expect(pick!.variantIndex).toBe(2);
  });
});
