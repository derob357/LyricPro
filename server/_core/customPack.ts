import { and, eq, ne } from "drizzle-orm";
import { songs } from "../../drizzle/schema";
import type { getDb } from "../db";
import type { SongRow } from "./songSelection";

export interface CustomPackPick {
  song: SongRow;
  /** Broader same-genre distractor pool (active+approved), INCLUDING the picked
   *  song — buildMatchQuestion expects the picked song present and excludes it
   *  internally. Decision (a): pool is the catalog, not the set. */
  candidateSongs: SongRow[];
  /** Forced variant index, or null to let the engine use variant 0. */
  variantIndex: number | null;
}

export async function selectCustomPackSong(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  args: {
    customPackSongIds: number[];
    customPackVariants: Array<number | null> | null;
    usedSongIds: number[];
  },
): Promise<CustomPackPick | null> {
  const { customPackSongIds, customPackVariants, usedSongIds } = args;
  const index = usedSongIds.length;
  if (index >= customPackSongIds.length) return null;

  const nextSongId = customPackSongIds[index];
  if (nextSongId === undefined) return null;

  const [song] = await db.select().from(songs).where(eq(songs.id, nextSongId)).limit(1);
  if (!song) return null;

  const pool = (await db
    .select()
    .from(songs)
    .where(
      and(
        eq(songs.isActive, true),
        eq(songs.approvalStatus, "approved"),
        eq(songs.genre, song.genre),
        ne(songs.id, song.id),
      ),
    )) as SongRow[];

  const candidateSongs = [...pool, song];
  const raw = customPackVariants?.[index];
  const variantIndex = typeof raw === "number" ? raw : null;

  return { song: song as SongRow, candidateSongs, variantIndex };
}

/** Clamp a raw forced-variant value to a valid variant index. Returns the
 *  forced index when it's an in-range integer, else 0 (the default variant).
 *  Single source of truth shared by the serve sites (startMatch/advanceRound)
 *  and the scoring site (submitAnswer) so the displayed and scored variant
 *  can never diverge. */
export function resolveVariantIndex(raw: number | null | undefined, variantCount: number): number {
  return typeof raw === "number" && raw >= 0 && raw < variantCount ? raw : 0;
}
