import { z } from "zod";
import { and, eq, gte, isNotNull, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { rateLimit } from "../_core/rateLimit";
import { getDb } from "../db";
import {
  songs, gameRooms, roomPlayers, teams, gameSessions, roundResults,
  guestSessions, leaderboardEntries, artistMetadata, users,
  goldenNoteBalances, goldenNoteTransactions,
  songDisplays,
} from "../../drizzle/schema";
import { nanoid } from "nanoid";
import {
  variantsForSong,
  loadVariantsForSongs,
  type Variant,
} from "../_core/variantReader";
import { computePlayerProfile } from "../_core/playerProfile";
import { deriveGuestNickname } from "./guestNickname";
import { resolveCommentary, resolveGameSummaryCommentary, type RoundContext, type GameSummaryContext } from "../_core/commentaryEngine";
import { playerProfiles } from "../../drizzle/schema";
import type { PlayerProfileData } from "../_core/playerProfile";
import {
  matchLyric,
  scoreRound,
  type Difficulty,
  type LyricMatch,
  type ArtistMatch,
} from "../_core/scoring";
import { selectSongForRoom } from "../_core/songSelection";

// Hashes a userId with USER_HASH_PEPPER for storage in song_displays.user_id_hashed.
// Exported for test coverage. Uses a fixed fallback pepper in dev when the env
// var is missing — production MUST have USER_HASH_PEPPER set or the hashes
// across sessions become predictable.
export function hashUserId(userId: number): string {
  const pepper = process.env.USER_HASH_PEPPER ?? "dev-fallback-pepper-not-for-prod";
  return createHash("sha256").update(`${userId}${pepper}`).digest("hex");
}

const STREAK_INSURANCE_PRICE_GN = 3;
const HINT_PRICE_GN = 1;

// ── Helpers ──────────────────────────────────────────────────────────────────
function generateRoomCode(): string {
  return nanoid(6).toUpperCase();
}

export function generateInviteCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Variant accessor for getNextSong's per-song lyric rotation.
//
// Phase 5c (read-path repoint behind a feature flag): the variant array
// no longer comes directly from `song.lyricVariants` — it's resolved via
// `variantsForSong(db, song)` / `loadVariantsForSongs(db, songs[])`,
// which dispatch on `LYRIC_PRO_READ_FROM_LAYER3`:
//   - OFF (default): legacy jsonb path, identical to the pre-5c helper.
//   - ON: JOIN against gameplay_items + lyric_moments, ordered by
//     gameplay_items.id ASC. The backfill (Phase 5b) inserted items in
//     legacy variant order, so id ASC preserves the original index used
//     by song_displays.variantIndex. Verified 2026-05-05 against all 2,035
//     active+approved songs / 6,030 positions: 0 drift on prompt + answer
//     + distractors. (sectionType has 80 benign drifts caused by the
//     ON CONFLICT (song_id, lyric_text) collapse during backfill, but
//     sectionType is not consumed at runtime.)
type SongVariant = Variant;

// A variant is playable iff:
//   - prompt is non-empty after trim (else the player sees a hollow "...")
//     — this rule applies at every difficulty
//   - prompt + answer combined is at least 6 words
//     — this rule applies on Medium only. Low gets the short iconic hooks
//       ("Eye of the Tiger", "Whoomp! There it is") because that's the
//       point of Easy — popular, instantly-recognizable lines. Hard is
//       length-agnostic too since it's about depth, not friendliness.
// Difficulty type is imported from ../_core/scoring

function isVariantPlayable(v: SongVariant, difficulty: Difficulty): boolean {
  const prompt = String(v?.prompt ?? "").trim();
  const answer = String(v?.answer ?? "").trim();
  if (!prompt) return false;
  if (difficulty !== "medium") return true;
  const lineWords = (prompt + " " + answer).trim().split(/\s+/).filter(Boolean).length;
  return lineWords >= 6;
}

// Returns the ORIGINAL indices (within the resolved variants array) that
// pass isVariantPlayable for the given difficulty. Original indices matter
// because song_displays stores variantIndex, and submitAnswer / useHint
// resolve scoring by that index back into the same variants array.
function playableVariantIndicesFrom(
  variants: SongVariant[],
  difficulty: Difficulty,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < variants.length; i++) {
    if (isVariantPlayable(variants[i], difficulty)) out.push(i);
  }
  return out;
}

// ── Router ───────────────────────────────────────────────────────────────────
export const gameRouter = router({
  // Create a guest session (interstitial lead capture: email optional)
  createGuestSession: publicProcedure
    .input(z.object({
      nickname: z.string().min(1).max(64).optional(),
      email: z.string().email().max(254).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Public, unauthenticated DB write + email capture — rate-limit by IP to
      // blunt spam/abuse (mirrors createRoom). No-op outside production.
      rateLimit("createGuestSession", ctx.req.ip ?? "anon", { max: 10, windowMs: 60_000 });

      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const token = nanoid(32);
      const nickname = deriveGuestNickname(input.nickname, input.email);
      await db.insert(guestSessions).values({
        sessionToken: token,
        nickname,
        email: input.email ?? null,
      });
      return { token, nickname };
    }),

  // Create a game room
  createRoom: publicProcedure
    .input(z.object({
      mode: z.enum(["solo", "multiplayer", "team"]),
      rankingMode: z.enum(["total_points", "speed_bonus", "streak_bonus"]).default("total_points"),
      genres: z.array(z.string()).min(1),
      decades: z.array(z.string()).min(1),
      difficulty: z.enum(["low", "medium", "high"]).default("medium"),
      timerSeconds: z.number().int().min(15).max(90).default(30),
      rounds: z.number().int().min(3).max(20).default(10),
      explicitFilter: z.boolean().default(false),
      guestToken: z.string().optional(),
      streakInsurance: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const rlKey = ctx.user?.id ?? input.guestToken ?? ctx.req.ip ?? "anon";
      rateLimit("createRoom", rlKey, { max: 10, windowMs: 60_000 });

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // ── Streak Insurance: auth + balance check + debit ──────────────────────
      if (input.streakInsurance) {
        if (!ctx.user?.id) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to use Streak Insurance." });
        }

        const [bal] = await db
          .select()
          .from(goldenNoteBalances)
          .where(eq(goldenNoteBalances.userId, ctx.user.id))
          .limit(1);

        if (!bal || bal.balance < STREAK_INSURANCE_PRICE_GN) {
          throw new TRPCError({
            code: "PAYMENT_REQUIRED",
            message: `Need ${STREAK_INSURANCE_PRICE_GN} Golden Notes for Streak Insurance. You have ${bal?.balance ?? 0}.`,
          });
        }

        const newBalance = bal.balance - STREAK_INSURANCE_PRICE_GN;

        await db
          .update(goldenNoteBalances)
          .set({
            balance: newBalance,
            lifetimeSpent: bal.lifetimeSpent + STREAK_INSURANCE_PRICE_GN,
            updatedAt: new Date(),
          })
          .where(eq(goldenNoteBalances.userId, ctx.user.id));

        await db.insert(goldenNoteTransactions).values({
          userId: ctx.user.id,
          amount: -STREAK_INSURANCE_PRICE_GN,
          kind: "spend_advanced_mode",
          reason: "Streak Insurance",
          balanceAfter: newBalance,
        });
      }

      let roomCode = generateRoomCode();
      // Ensure unique
      let attempts = 0;
      while (attempts < 5) {
        const existing = await db.select({ id: gameRooms.id }).from(gameRooms).where(eq(gameRooms.roomCode, roomCode)).limit(1);
        if (existing.length === 0) break;
        roomCode = generateRoomCode();
        attempts++;
      }

      const hostUserId = ctx.user?.id ?? null;
      const hostGuestToken = input.guestToken ?? null;

      await db.insert(gameRooms).values({
        roomCode,
        hostUserId,
        hostGuestToken,
        mode: input.mode,
        rankingMode: input.rankingMode,
        timerSeconds: input.timerSeconds,
        roundsTotal: input.rounds,
        selectedGenres: JSON.stringify(input.genres),
        selectedDecades: JSON.stringify(input.decades),
        difficulty: input.difficulty,
        explicitFilter: input.explicitFilter,
        streakInsurance: input.streakInsurance,
        status: "waiting",
        currentRound: 0,
        currentPlayerIndex: 0,
        usedSongIds: "[]",
      });

      // Add host as first player
      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, roomCode)).limit(1);

      await db.insert(roomPlayers).values({
        roomId: room.id,
        userId: hostUserId,
        guestToken: hostGuestToken,
        guestName: hostGuestToken ? (await db.select({ nickname: guestSessions.nickname }).from(guestSessions).where(eq(guestSessions.sessionToken, hostGuestToken)).limit(1))[0]?.nickname : null,
        joinOrder: 0,
        currentScore: 0,
        currentStreak: 0,
        isReady: input.mode === "solo",
        isActive: true,
      });

      return { roomCode, roomId: room.id };
    }),

  // Get room state
  getRoom: publicProcedure
    .input(z.object({ roomCode: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new Error("Room not found");

      const players = await db.select().from(roomPlayers).where(and(eq(roomPlayers.roomId, room.id), eq(roomPlayers.isActive, true)));
      const roomTeams = await db.select().from(teams).where(eq(teams.roomId, room.id));

      return {
        ...room,
        selectedGenres: JSON.parse(room.selectedGenres) as string[],
        selectedDecades: JSON.parse(room.selectedDecades) as string[],
        usedSongIds: JSON.parse(room.usedSongIds ?? "[]") as number[],
        players,
        teams: roomTeams,
      };
    }),

  // Join a room
  joinRoom: publicProcedure
    .input(z.object({
      roomCode: z.string(),
      guestToken: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new Error("Room not found");
      if (room.status !== "waiting") throw new Error("Game already started");

      const existingPlayers = await db.select().from(roomPlayers).where(eq(roomPlayers.roomId, room.id));

      // Check if already joined
      const userId = ctx.user?.id ?? null;
      const guestToken = input.guestToken ?? null;
      const alreadyJoined = existingPlayers.some(p =>
        (userId && p.userId === userId) || (guestToken && p.guestToken === guestToken)
      );
      if (alreadyJoined) return { success: true, joinOrder: existingPlayers.find(p => (userId && p.userId === userId) || (guestToken && p.guestToken === guestToken))?.joinOrder ?? 0 };

      let guestName: string | null = null;
      if (guestToken) {
        const [gs] = await db.select({ nickname: guestSessions.nickname }).from(guestSessions).where(eq(guestSessions.sessionToken, guestToken)).limit(1);
        guestName = gs?.nickname ?? null;
      }

      const joinOrder = existingPlayers.length;
      await db.insert(roomPlayers).values({
        roomId: room.id,
        userId,
        guestToken,
        guestName,
        joinOrder,
        currentScore: 0,
        currentStreak: 0,
        isReady: false,
        isActive: true,
      });

      return { success: true, joinOrder };
    }),

  // Set player ready
  setReady: publicProcedure
    .input(z.object({ roomCode: z.string(), guestToken: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new Error("Room not found");
      const userId = ctx.user?.id;
      if (userId) {
        await db.update(roomPlayers).set({ isReady: true }).where(and(eq(roomPlayers.roomId, room.id), eq(roomPlayers.userId, userId)));
      } else if (input.guestToken) {
        await db.update(roomPlayers).set({ isReady: true }).where(and(eq(roomPlayers.roomId, room.id), eq(roomPlayers.guestToken, input.guestToken)));
      }
      return { success: true };
    }),

  // Start game (host only)
  startGame: publicProcedure
    .input(z.object({ roomCode: z.string(), guestToken: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });

      // Verify the caller is the host (authed user OR guest with matching host token).
      const callerId = ctx.user?.id ?? null;
      const callerToken = input.guestToken ?? null;
      const isHost =
        (callerId !== null && room.hostUserId === callerId) ||
        (callerToken !== null && room.hostGuestToken === callerToken);
      if (!isHost) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the host can start the game." });
      }

      await db.update(gameRooms).set({ status: "active", currentRound: 1 }).where(eq(gameRooms.id, room.id));
      return { success: true };
    }),

  // Get next song for a round
  getNextSong: publicProcedure
    .input(z.object({
      roomCode: z.string(),
      guestToken: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new Error("Room not found");

      const genres = JSON.parse(room.selectedGenres) as string[];
      const decades = JSON.parse(room.selectedDecades) as string[];
      const usedIds = JSON.parse(room.usedSongIds ?? "[]") as number[];

      // Identity for per-user dedup + display logging. Auth wins over the
      // optional guestToken (signed-in users may carry a stale guest cookie
      // from before they logged in). We tolerate both being null — that
      // path skips dedup and logs the display with both columns null,
      // which is harmless for the usage report's totals.
      const dedupUserId: number | null = ctx.user?.id ?? null;
      const dedupGuestToken: string | null =
        dedupUserId === null ? (input.guestToken ?? null) : null;

      let song: typeof songs.$inferSelect;
      let candidateSongs: (typeof songs.$inferSelect)[];
      // Pre-resolved variants for the standard-branch candidate pool. Built
      // once via `loadVariantsForSongs` so the playability filter, the
      // dedup pick, and the per-song variant pick all use the same array.
      // Empty by default — the standard branch populates it; the
      // custom-pack branch resolves variants ad hoc per picked song.
      let stdCandidateVariantMap: Map<number, Variant[]> = new Map();

      const customPackSongIds = Array.isArray(room.customPackSongIds) && room.customPackSongIds.length > 0
        ? room.customPackSongIds as number[]
        : null;

      if (customPackSongIds) {
        // ── Custom-pack branch: serve songs in order, advancing by usedIds length ──
        if (usedIds.length >= customPackSongIds.length) {
          throw new Error("Practice pack exhausted.");
        }

        const nextSongId = customPackSongIds[usedIds.length];
        if (nextSongId === undefined) {
          throw new Error("Practice pack exhausted.");
        }

        const [pickedSong] = await db
          .select()
          .from(songs)
          .where(eq(songs.id, nextSongId))
          .limit(1);

        if (!pickedSong) throw new Error("Custom pack song not found.");

        song = pickedSong;

        // Update room: push to usedSongIds and set currentSongId
        const newUsedIds = [...usedIds, song.id];
        await db
          .update(gameRooms)
          .set({ currentSongId: song.id, usedSongIds: JSON.stringify(newUsedIds) })
          .where(eq(gameRooms.id, room.id));

        // Distractor pool: same-genre songs excluding picked song
        candidateSongs = await db
          .select()
          .from(songs)
          .where(
            and(
              eq(songs.isActive, true),
              eq(songs.approvalStatus, "approved"),
              eq(songs.genre, song.genre),
              ne(songs.id, song.id),
            )
          );
      } else {
        // ── Standard branch: delegate to selectSongForRoom ───────────────────
        // All genre/decade/difficulty filtering, playability check, per-identity
        // dedup window, and weighted pick live in server/_core/songSelection.ts
        // so the multiplayer engine can reuse the same logic.
        const selResult = await selectSongForRoom(db, {
          genres,
          decades,
          difficulty: room.difficulty as "low" | "medium" | "high",
          explicitFilter: room.explicitFilter ?? false,
          usedSongIds: usedIds,
          dedupUserId,
          dedupGuestToken,
        });

        // selResult is null only if the pool is exhausted with no recycling
        // fallback available — selectSongForRoom throws with a user-facing message
        // before that happens, so null here means an unexpected empty return.
        if (!selResult) {
          throw new Error("No songs available for the selected genre/decade.");
        }

        // Retrieve the full song row for the picked id.
        const [pickedSong] = await db
          .select()
          .from(songs)
          .where(eq(songs.id, selResult.songId))
          .limit(1);
        if (!pickedSong) throw new Error("Selected song not found.");

        song = pickedSong;
        candidateSongs = selResult.candidateSongs;
        stdCandidateVariantMap = selResult.variantMap as Map<number, Variant[]>;

        // Update used songs
        const newUsedIds = [...usedIds, song.id];
        await db.update(gameRooms).set({ currentSongId: song.id, usedSongIds: JSON.stringify(newUsedIds) }).where(eq(gameRooms.id, room.id));
      }

      // ── Variant pick (per-song lyric rotation) ─────────────────────────────
      // Runs in BOTH branches (standard + customPack) so practice-pack users
      // also get variant rotation. song-level dedup decided whether the song
      // appears at all; THIS step decides which lyric line to show.
      //
      // Query song_displays for variant indices already shown to this
      // user/guest for THIS specific song within the 10-day window. Pick a
      // variant they haven't seen. If all variants seen, fall back to
      // variantIndex 0 (preserves the song-level dedup behavior — the song
      // selection step decided this song is fair game; we just don't have
      // a fresh variant to offer).
      // Phase 5c: prefer the pre-resolved variant map from the standard
      // branch (avoids a second DB round-trip when the flag is ON). The
      // custom-pack branch never populates the map, so resolve ad hoc.
      const allVariants =
        stdCandidateVariantMap.get(song.id) ?? (await variantsForSong(db, song));
      // Only consider variants that pass the playability rules at this
      // room's difficulty. Indices are the ORIGINAL indices in allVariants
      // so song_displays stays scoring-compatible. For customPack songs
      // that slipped past the standard candidate filter, fall back to [0]
      // as a last resort.
      const playableIndices = playableVariantIndicesFrom(allVariants, room.difficulty as Difficulty);
      const candidateIndices = playableIndices.length > 0 ? playableIndices : [0];
      const dedupCutoff = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      let seenVariantIndices = new Set<number>();
      if (dedupUserId !== null) {
        const rows = await db
          .select({ variantIndex: songDisplays.variantIndex })
          .from(songDisplays)
          .where(
            and(
              eq(songDisplays.userId, dedupUserId),
              eq(songDisplays.songId, song.id),
              gte(songDisplays.shownAt, dedupCutoff),
            ),
          );
        seenVariantIndices = new Set(rows.map(r => r.variantIndex));
      } else if (dedupGuestToken !== null) {
        const rows = await db
          .select({ variantIndex: songDisplays.variantIndex })
          .from(songDisplays)
          .where(
            and(
              eq(songDisplays.guestToken, dedupGuestToken),
              eq(songDisplays.songId, song.id),
              gte(songDisplays.shownAt, dedupCutoff),
            ),
          );
        seenVariantIndices = new Set(rows.map(r => r.variantIndex));
      }
      const unseenIndices = candidateIndices.filter(i => !seenVariantIndices.has(i));
      const pickedVariantIndex = unseenIndices.length > 0
        ? unseenIndices[Math.floor(Math.random() * unseenIndices.length)]
        : candidateIndices[0];
      const pickedVariant = allVariants[pickedVariantIndex] ?? allVariants[0];

      // ── Display log + global counter bump ──────────────────────────────────
      // Runs in BOTH branches so practice-pack rounds also feed the dedup
      // window and the usage report. Back-to-back rather than wrapped in a
      // transaction to match the surrounding style — the worst case if the
      // counter UPDATE fails is one missing display row, not a corrupt game.
      // pickedVariant.prompt is the lyric text actually displayed.
      const promptShown = pickedVariant.prompt;
      await db.insert(songDisplays).values({
        // Original fields
        songId: song.id,
        userId: dedupUserId,
        guestToken: dedupGuestToken
          ? dedupGuestToken.slice(0, 64)
          : null,
        roomCode: room.roomCode ?? null,
        variantIndex: pickedVariantIndex,
        // DDEX-ready fields (Phase 1 Track B)
        territoryCode: ctx.countryCode ?? null,
        // durationOfUseSeconds: NULL at insert; updated on round end (Task 1B.2)
        lyricFragmentLengthChars: promptShown.length,
        lyricFragmentLengthLines: promptShown.split("\n").length,
        commercialModelType: "free", // Upgrade when subscriptionEnforcement integrates
        serviceDescription: "lyricpro-web",
        grossRevenuePerEventMicros: 0,
        currencyCode: "USD",
        attributionServed: null, // Populated when LyricFind/Musixmatch is wired
        userIdHashed: dedupUserId !== null ? hashUserId(dedupUserId) : null,
        sessionId: room.roomCode ?? (dedupGuestToken?.slice(0, 64) ?? null),
        // reportingPeriodYyyymm is a GENERATED column — Postgres computes it
      });
      await db
        .update(songs)
        .set({
          displayCount: sql`${songs.displayCount} + 1`,
          lastShownAt: new Date(),
        })
        .where(eq(songs.id, song.id));

      // Get artist metadata
      let artistMeta = null;
      if (song.artistMetadataId) {
        const [meta] = await db.select().from(artistMetadata).where(eq(artistMetadata.id, song.artistMetadataId)).limit(1);
        artistMeta = meta;
      }

      // Generate 4-option multiple choice for every field at every difficulty.
      // Distractors are randomly drawn from the candidate-song pool (same
      // genre + decade), falling back to the broader pool when needed.
      const distractorPool = candidateSongs.filter(s => s.id !== song.id);

      // If we couldn't find enough in-pool distractors, pull any approved
      // songs so we can still present 4 options.
      let fallbackPool: typeof distractorPool = [];
      if (distractorPool.length < 3) {
        fallbackPool = await db.select().from(songs).where(
          and(eq(songs.isActive, true), eq(songs.approvalStatus, "approved"))
        );
        fallbackPool = fallbackPool.filter(s => s.id !== song.id);
      }

      function pickDistractors(n: number, keyOf: (s: typeof song) => string, correct: string) {
        const shuffled = [...distractorPool, ...fallbackPool].sort(() => Math.random() - 0.5);
        const out: string[] = [];
        const seen = new Set<string>([correct.toLowerCase()]);
        for (const s of shuffled) {
          const v = keyOf(s);
          if (!v) continue;
          if (seen.has(v.toLowerCase())) continue;
          seen.add(v.toLowerCase());
          out.push(v);
          if (out.length >= n) break;
        }
        return out;
      }

      const shuffle = <T>(a: T[]) => [...a].sort(() => Math.random() - 0.5);

      const titleOptions = shuffle([song.title, ...pickDistractors(3, s => s.title, song.title)]);
      const artistOptions = shuffle([song.artistName, ...pickDistractors(3, s => s.artistName, song.artistName)]);

      // Year options: correct + 3 offsets (±2, ±4, ±6) with random sign.
      const yearOffsets = [2, 4, 6].map(d => song.releaseYear + (Math.random() > 0.5 ? d : -d));
      const yearSet = new Set<number>([song.releaseYear, ...yearOffsets]);
      // Bounded top-up: try a small fixed number of offsets; deterministic fallbacks if still short.
      for (let tries = 0; tries < 12 && yearSet.size < 4; tries++) {
        yearSet.add(song.releaseYear + (Math.floor(Math.random() * 20) - 10));
      }
      let fallbackOffset = 7;
      while (yearSet.size < 4 && fallbackOffset < 40) {
        yearSet.add(song.releaseYear + fallbackOffset);
        fallbackOffset++;
      }
      const yearOptions = shuffle(Array.from(yearSet));

      // Lyric options (only used for High difficulty — a 4-option "fill the gap"
      // for the final line of the lyric). Distractors are lyricAnswer strings
      // pulled from other same-genre/decade songs.
      // Prefer the picked variant's authored distractors; fall back to the old
      // other-song-snippet method when the variant has fewer than 3 stored.
      const variantAnswer = pickedVariant.answer;
      const answerNormalized = variantAnswer.toLowerCase().trim();
      const seenDistractors = new Set<string>([answerNormalized]);
      const stored = Array.isArray(pickedVariant.distractors)
        ? pickedVariant.distractors.filter((d): d is string => {
            if (typeof d !== "string") return false;
            const norm = d.toLowerCase().trim();
            if (norm.length === 0) return false;
            if (seenDistractors.has(norm)) return false;
            seenDistractors.add(norm);
            return true;
          })
        : [];
      const lyricDistractors = stored.length >= 3
        ? stored.slice(0, 3)
        : [...stored, ...pickDistractors(3 - stored.length, s => s.lyricAnswer, variantAnswer)];
      const lyricOptions = shuffle([variantAnswer, ...lyricDistractors]);

      return {
        id: song.id,
        title: song.title,
        artistName: song.artistName,
        lyricPrompt: pickedVariant.prompt,
        lyricAnswer: pickedVariant.answer,
        releaseYear: song.releaseYear,
        genre: song.genre,
        decade: song.decadeRange,
        difficulty: song.difficulty,
        lyricOptions,
        titleOptions,
        artistOptions,
        yearOptions,
        artistMetadata: artistMeta ? {
          officialWebsite: artistMeta.officialWebsite,
          instagramUrl: artistMeta.instagramUrl,
          facebookUrl: artistMeta.facebookUrl,
          xUrl: artistMeta.xUrl,
          tiktokUrl: artistMeta.tiktokUrl,
          youtubeUrl: artistMeta.youtubeUrl,
          spotifyUrl: artistMeta.spotifyUrl,
          appleMusicUrl: artistMeta.appleMusicUrl,
          newsSearchUrl: artistMeta.newsSearchUrl,
        } : null,
      };
    }),

  // Submit an answer
  submitAnswer: publicProcedure
    .input(z.object({
      roomCode: z.string(),
      songId: z.number().int(),
      lyricAnswer: z.string().default(""),
      titleAnswer: z.string().default(""),
      artistAnswer: z.string().default(""),
      yearAnswer: z.string().default(""),
      passUsed: z.boolean().default(false),
      responseTimeSeconds: z.number().default(30),
      answerMethod: z.enum(["typed", "voice"]).default("typed"),
      guestToken: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const rlKey = ctx.user?.id ?? input.guestToken ?? ctx.req.ip ?? "anon";
      rateLimit("submitAnswer", rlKey, { max: 30, windowMs: 60_000 });

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new Error("Room not found");

      const [song] = await db.select().from(songs).where(eq(songs.id, input.songId)).limit(1);
      if (!song) throw new Error("Song not found");

      // ── Variant alignment for scoring ───────────────────────────────────────
      // getNextSong picks a variant per (user|guest, song) display and writes
      // the variantIndex into song_displays. We re-read the most recent display
      // row for THIS room+song+identity so scoring matches the lyric the player
      // actually saw. Falls back to variant 0 (legacy lyricAnswer) for clients
      // that pre-date Phase 2a.
      const scoringUserId: number | null = ctx.user?.id ?? null;
      const scoringGuestToken: string | null =
        scoringUserId === null ? (input.guestToken ?? null) : null;
      const displayConditions = [
        eq(songDisplays.songId, song.id),
        eq(songDisplays.roomCode, room.roomCode),
      ];
      if (scoringUserId !== null) {
        displayConditions.push(eq(songDisplays.userId, scoringUserId));
      } else if (scoringGuestToken !== null) {
        displayConditions.push(eq(songDisplays.guestToken, scoringGuestToken.slice(0, 64)));
      }
      const [latestDisplay] = await db
        .select({ id: songDisplays.id, variantIndex: songDisplays.variantIndex })
        .from(songDisplays)
        .where(and(...displayConditions))
        .orderBy(sql`${songDisplays.shownAt} DESC`)
        .limit(1);
      // Phase 1 Track B: stamp duration_of_use_seconds on the matched display row
      // so the usage report and DDEX export know how long the lyric was on screen.
      // `responseTimeSeconds` is provided by the client; cap and floor for sanity.
      if (latestDisplay?.id !== undefined) {
        const duration = Math.max(0, Math.min(3600, Math.floor(input.responseTimeSeconds)));
        await db
          .update(songDisplays)
          .set({ durationOfUseSeconds: duration })
          .where(eq(songDisplays.id, latestDisplay.id));
      }
      // Phase 5c: same dual-path resolver as getNextSong. The variantIndex
      // stored in song_displays must map to the same variant the player
      // saw — verified symmetric across all live data on 2026-05-05.
      const allVariants = await variantsForSong(db, song);
      const playedVariant =
        allVariants[latestDisplay?.variantIndex ?? 0] ?? allVariants[0];

      // Get artist aliases
      let aliases: string[] = [];
      if (song.artistMetadataId) {
        const [meta] = await db.select({ aliases: artistMetadata.aliases }).from(artistMetadata).where(eq(artistMetadata.id, song.artistMetadataId)).limit(1);
        if (meta?.aliases) {
          try { aliases = JSON.parse(meta.aliases); } catch {}
        }
      }

      const diff = room.difficulty as Difficulty;

      const userId = ctx.user?.id ?? null;
      const guestToken = input.guestToken ?? null;

      // Get player for streak — must happen before scoreRound so we can pass
      // the post-insurance newStreak value into the pure scorer.
      const [player] = await db.select().from(roomPlayers).where(
        and(
          eq(roomPlayers.roomId, room.id),
          userId ? eq(roomPlayers.userId, userId) : eq(roomPlayers.guestToken, guestToken ?? "")
        )
      ).limit(1);

      // ── Streak Insurance: resolve before calling scoreRound so we can pass
      // the correct post-insurance streak value into the pure scorer.
      // Needs lyricCorrect, which we derive via a direct matchLyric call.
      const preCheckLyricCorrect = !input.passUsed && matchLyric(input.lyricAnswer, playedVariant.answer) === "full";
      let streakInsuranceUsed = false;
      let newStreak = 0;

      if (player) {
        const rawNewStreak = preCheckLyricCorrect ? player.currentStreak + 1 : 0;
        newStreak = rawNewStreak;

        if (!preCheckLyricCorrect && player.currentStreak >= 1 && room.streakInsurance) {
          // Insurance fires — preserve the streak, consume the flag.
          newStreak = player.currentStreak;
          streakInsuranceUsed = true;
          await db
            .update(gameRooms)
            .set({ streakInsurance: false })
            .where(eq(gameRooms.id, room.id));
        }
      }

      // ── Pure scoring — all point computation lives in _core/scoring.ts ──
      const scored = scoreRound({
        difficulty: diff,
        passUsed: input.passUsed,
        lyricAnswer: input.lyricAnswer,
        titleAnswer: input.titleAnswer,
        artistAnswer: input.artistAnswer,
        yearAnswer: input.yearAnswer,
        correctLyricAnswer: playedVariant.answer,
        correctTitle: song.title,
        correctArtistName: song.artistName,
        correctReleaseYear: song.releaseYear,
        artistAliases: aliases,
        responseTimeSeconds: input.responseTimeSeconds,
        timerSeconds: room.timerSeconds,
        rankingMode: room.rankingMode,
        newStreak,
      });

      const {
        lyricMatch,
        artistMatch,
        titleCorrect,
        titlePartial,
        lyricPoints,
        titlePoints,
        artistPoints,
        yearPoints,
        speedBonusPoints: speedBonus,
        streakBonusPoints: streakBonus,
        totalRoundPoints,
      } = scored;

      const lyricCorrect = lyricMatch === "full";
      const lyricPartialFlag = lyricMatch === "partial";
      const artistCorrect = artistMatch === "full";
      const artistPartial = artistMatch === "primary_only";
      const correctCount =
        (lyricCorrect || lyricPartialFlag ? 1 : 0) +
        (titleCorrect || titlePartial ? 1 : 0) +
        (artistCorrect || artistPartial ? 1 : 0) +
        (yearPoints > 0 ? 1 : 0);

      // celebrationCount: only full matches trigger celebration (no partial credit)
      const celebrationCount =
        (lyricCorrect ? 1 : 0) +
        (titleCorrect ? 1 : 0) +
        (artistCorrect ? 1 : 0) +
        (yearPoints > 0 ? 1 : 0);

      if (player) {
        const newScore = player.currentScore + totalRoundPoints;

        // Update player score and streak
        await db.update(roomPlayers).set({
          currentScore: newScore,
          currentStreak: newStreak,
        }).where(eq(roomPlayers.id, player.id));

        // Save round result
        // NOTE: hintUsed defaults to false — client-side hint tracking is a
        // follow-up task (Option A per plan). Wire hintUsed via submitAnswer
        // input when client-side hint state is available.
        await db.insert(roundResults).values({
          roomId: room.id,
          roundNumber: room.currentRound,
          activePlayerId: player.id,
          activeGuestToken: guestToken,
          songId: input.songId,
          userLyricAnswer: input.lyricAnswer,
          userArtistAnswer: input.artistAnswer,
          userYearAnswer: parseInt(input.yearAnswer) || null,
          answerMethod: input.answerMethod,
          responseTimeSeconds: input.responseTimeSeconds,
          lyricPoints,
          artistPoints,
          yearPoints,
          speedBonusPoints: speedBonus,
          streakBonusPoints: streakBonus,
          totalRoundPoints: totalRoundPoints,
          passUsed: input.passUsed,
          streakInsuranceUsed,
        });

        // ── Commentary (fire-and-forget fetch, best-effort) ──────────────
        let commentary: string | null = null;
        try {
          let profileData: PlayerProfileData | null = null;
          if (userId) {
            const [profileRow] = await db
              .select({ profile: playerProfiles.profile })
              .from(playerProfiles)
              .where(eq(playerProfiles.userId, userId))
              .limit(1);
            if (profileRow) profileData = profileRow.profile as unknown as PlayerProfileData;
          }
          const roundCtx: RoundContext = {
            correctCount,
            lyricCorrect,
            titleCorrect,
            artistCorrect: artistCorrect || artistPartial,
            yearCorrect: yearPoints > 0,
            passUsed: input.passUsed,
            responseTimeSeconds: input.responseTimeSeconds ?? null,
            genre: song.genre,
            streakCount: newStreak,
            isMultiplayer: room.mode !== "solo",
            profile: profileData,
          };
          commentary = await resolveCommentary(roundCtx);
        } catch (err) {
          console.warn("[commentary] resolve failed:", err);
        }

        return {
          lyricCorrect,
          lyricPartial: lyricPartialFlag,
          titleCorrect,
          titlePartial,
          artistCorrect,
          artistPartial,
          correctCount,
          celebrationCount,
          lyricPoints,
          titlePoints,
          artistPoints,
          yearPoints,
          speedBonus,
          streakBonus,
          total: totalRoundPoints,
          newScore,
          newStreak,
          streakInsuranceUsed,
          correctLyric: playedVariant.answer,
          correctTitle: song.title,
          correctArtist: song.artistName,
          correctYear: song.releaseYear,
          difficulty: diff,
          passUsed: input.passUsed,
          commentary,
        };
      }

      return {
        lyricCorrect, lyricPartial: lyricPartialFlag, titleCorrect, titlePartial,
        artistCorrect, artistPartial, correctCount, celebrationCount,
        lyricPoints, titlePoints, artistPoints, yearPoints,
        speedBonus, streakBonus, total: 0, newScore: 0, newStreak: 0,
        streakInsuranceUsed: false, commentary: null as string | null,
        correctLyric: playedVariant.answer, correctTitle: song.title,
        correctArtist: song.artistName, correctYear: song.releaseYear, difficulty: diff,
        passUsed: input.passUsed,
      };
    }),

  // Use a hint for the current stage (costs 1 GN, auth required)
  useHint: protectedProcedure
    .input(z.object({
      roomCode: z.string(),
      songId: z.number().int(),
      stage: z.enum(["lyric", "title", "artist", "year"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });

      const userId = ctx.user.id;

      // Check GN balance.
      const [bal] = await db
        .select()
        .from(goldenNoteBalances)
        .where(eq(goldenNoteBalances.userId, userId))
        .limit(1);

      if (!bal || bal.balance < HINT_PRICE_GN) {
        throw new TRPCError({
          code: "PAYMENT_REQUIRED",
          message: `Need ${HINT_PRICE_GN} Golden Note to use a hint. You have ${bal?.balance ?? 0}.`,
        });
      }

      const newBalance = bal.balance - HINT_PRICE_GN;

      // Debit GN and record transaction.
      await db
        .update(goldenNoteBalances)
        .set({
          balance: newBalance,
          lifetimeSpent: bal.lifetimeSpent + HINT_PRICE_GN,
          updatedAt: new Date(),
        })
        .where(eq(goldenNoteBalances.userId, userId));

      await db.insert(goldenNoteTransactions).values({
        userId,
        amount: -HINT_PRICE_GN,
        kind: "spend_advanced_mode",
        reason: `Hint: ${input.stage}`,
        balanceAfter: newBalance,
      });

      // Look up song to build the hint payload.
      const [song] = await db.select().from(songs).where(eq(songs.id, input.songId)).limit(1);
      if (!song) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Song not found." });
      }

      if (input.stage === "year") {
        return {
          stage: input.stage as "year",
          narrowedRange: [song.releaseYear - 5, song.releaseYear + 5] as [number, number],
        };
      }

      // For the lyric stage, the hint must align with the variant the player
      // actually saw — look up the latest song_displays row for this user/song
      // and use that variant's answer (falls back to legacy column if absent).
      let lyricAnswerForHint = song.lyricAnswer;
      if (input.stage === "lyric") {
        const [latestDisplay] = await db
          .select({ variantIndex: songDisplays.variantIndex })
          .from(songDisplays)
          .where(
            and(
              eq(songDisplays.userId, userId),
              eq(songDisplays.songId, song.id),
            ),
          )
          .orderBy(sql`${songDisplays.shownAt} DESC`)
          .limit(1);
        // Phase 5c: dual-path lookup so the hint shows the answer for the
        // EXACT variant the player saw at getNextSong time.
        const variants = await variantsForSong(db, song);
        lyricAnswerForHint =
          variants[latestDisplay?.variantIndex ?? 0]?.answer ?? song.lyricAnswer;
      }

      // stage is "lyric" | "title" | "artist" — return first letter of correct answer.
      const correctAnswer =
        input.stage === "title" ? song.title
        : input.stage === "artist" ? song.artistName
        : lyricAnswerForHint; // "lyric"

      const firstLetter = correctAnswer.trimStart()[0]?.toUpperCase() ?? "";

      return {
        stage: input.stage as "lyric" | "title" | "artist",
        firstLetter,
      };
    }),

  // Advance to next round
  nextRound: publicProcedure
    .input(z.object({ roomCode: z.string(), guestToken: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });

      // Verify the caller is an active player in this room.
      const callerId = ctx.user?.id ?? null;
      const callerToken = input.guestToken ?? null;
      const playerCondition = callerId !== null
        ? and(eq(roomPlayers.roomId, room.id), eq(roomPlayers.userId, callerId), eq(roomPlayers.isActive, true))
        : callerToken !== null
          ? and(eq(roomPlayers.roomId, room.id), eq(roomPlayers.guestToken, callerToken), eq(roomPlayers.isActive, true))
          : null;
      if (!playerCondition) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in or provide a guest token to advance the round." });
      }
      const [callerPlayer] = await db.select({ id: roomPlayers.id }).from(roomPlayers).where(playerCondition).limit(1);
      if (!callerPlayer) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You are not an active player in this room." });
      }

      const players = await db.select().from(roomPlayers).where(and(eq(roomPlayers.roomId, room.id), eq(roomPlayers.isActive, true)));
      const nextPlayerIndex = (room.currentPlayerIndex + 1) % players.length;
      const nextRound = room.currentRound + 1;
      const isGameOver = nextRound > room.roundsTotal;

      await db.update(gameRooms).set({
        currentRound: nextRound,
        currentPlayerIndex: nextPlayerIndex,
        status: isGameOver ? "finished" : "active",
      }).where(eq(gameRooms.id, room.id));

      if (isGameOver) {
        // Save leaderboard entries — authed users get their firstName
        // snapshotted (vs. the legacy "Player" placeholder); guests use
        // whatever name they typed at room-join time.
        for (const player of players) {
          let displayName: string | null = player.guestName;
          if (!displayName && player.userId) {
            const [u] = await db
              .select({ firstName: users.firstName })
              .from(users)
              .where(eq(users.id, player.userId))
              .limit(1);
            displayName = u?.firstName ?? null;
          }
          await db.insert(leaderboardEntries).values({
            userId: player.userId,
            guestName: player.guestName,
            displayName: displayName || "Player",
            score: player.currentScore,
            mode: room.mode,
            genre: (JSON.parse(room.selectedGenres) as string[])[0] || null,
            decade: (JSON.parse(room.selectedDecades) as string[])[0] || null,
            rankingMode: room.rankingMode,
          });
        }

        // Update user stats
        const sortedPlayers = [...players].sort((a, b) => b.currentScore - a.currentScore);
        for (let i = 0; i < sortedPlayers.length; i++) {
          const p = sortedPlayers[i];
          if (p.userId) {
            await db.update(users).set({
              lifetimeScore: sql`${users.lifetimeScore} + ${p.currentScore}`,
              gamesPlayed: sql`${users.gamesPlayed} + 1`,
              totalWins: i === 0 ? sql`${users.totalWins} + 1` : sql`${users.totalWins}`,
            }).where(eq(users.id, p.userId));
          }
        }

        // AI Player Intelligence: recompute profiles for all authed players.
        // Fire-and-forget — never blocks the game-over response.
        for (const p of players) {
          if (p.userId) {
            computePlayerProfile(db, p.userId).catch(err =>
              console.warn("[playerProfile] compute failed for user", p.userId, err),
            );
          }
        }
      }

      return { nextRound, isGameOver, nextPlayerIndex };
    }),

  // Get final results
  getFinalResults: publicProcedure
    .input(z.object({ roomCode: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new Error("Room not found");
      const players = await db.select().from(roomPlayers).where(and(eq(roomPlayers.roomId, room.id), eq(roomPlayers.isActive, true)));
      const roomTeams = await db.select().from(teams).where(eq(teams.roomId, room.id));
      const sorted = [...players].sort((a, b) => b.currentScore - a.currentScore);

      // Game summary commentary (best-effort)
      let gameSummaryCommentary: string | null = null;
      try {
        const callerId = ctx.user?.id ?? null;
        const callerPlayer = callerId
          ? sorted.find(p => p.userId === callerId)
          : null;
        const myScore = callerPlayer?.currentScore ?? sorted[0]?.currentScore ?? 0;
        const topScore = sorted[0]?.currentScore ?? 0;
        const secondScore = sorted[1]?.currentScore ?? 0;
        const isWinner = callerPlayer
          ? callerPlayer.currentScore >= topScore
          : true;
        const margin = isWinner
          ? topScore - secondScore
          : topScore - myScore;
        const parsedGenres = JSON.parse(room.selectedGenres) as string[];

        // Count perfect rounds for this player
        let perfectRounds = 0;
        if (callerPlayer) {
          const roundRows = await db
            .select({ totalRoundPoints: roundResults.totalRoundPoints })
            .from(roundResults)
            .where(and(
              eq(roundResults.roomId, room.id),
              eq(roundResults.activePlayerId, callerPlayer.id),
            ));
          // A "perfect" round = got all 4 stages right. Approximation:
          // total > 0 and no points lost (hard to know exactly without
          // storing correctCount, so use a high-score threshold per difficulty).
          const maxPerRound = room.difficulty === "high" ? 400 : room.difficulty === "medium" ? 250 : 125;
          perfectRounds = roundRows.filter(r => r.totalRoundPoints >= maxPerRound * 0.95).length;
        }

        let profileData: PlayerProfileData | null = null;
        if (callerId) {
          const [profileRow] = await db
            .select({ profile: playerProfiles.profile })
            .from(playerProfiles)
            .where(eq(playerProfiles.userId, callerId))
            .limit(1);
          if (profileRow) profileData = profileRow.profile as unknown as PlayerProfileData;
        }

        const summaryCtx: GameSummaryContext = {
          totalScore: myScore,
          rounds: room.roundsTotal,
          isMultiplayer: room.mode !== "solo",
          isWinner,
          margin,
          genre: parsedGenres[0] ?? "Mixed",
          perfectRounds,
          profile: profileData,
        };
        gameSummaryCommentary = await resolveGameSummaryCommentary(summaryCtx);
      } catch (err) {
        console.warn("[commentary] game summary failed:", err);
      }

      return {
        room: { ...room, selectedGenres: JSON.parse(room.selectedGenres), selectedDecades: JSON.parse(room.selectedDecades) },
        players: sorted,
        teams: roomTeams,
        gameSummaryCommentary,
      };
    }),

  // Get leaderboard
  getLeaderboard: publicProcedure
    .input(z.object({
      mode: z.enum(["solo", "multiplayer", "team"]).optional(),
      genre: z.string().optional(),
      decade: z.string().optional(),
      timeframe: z.enum(["weekly", "monthly", "all_time"]).default("all_time"),
      // Max raised from 100 → 500 so the leaderboard page can fetch deep
      // enough to show users beyond the top-100 (needed for the FinalResults
      // "View Leaderboard" CTA's center-on-self UX).
      limit: z.number().int().min(1).max(500).default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      // Build filter fragments for the CTE. Composed via sql.join so the
      // tagged-template parameter binding stays intact (no string concat).
      const filters: ReturnType<typeof sql>[] = [];
      if (input.mode) filters.push(sql`mode = ${input.mode}`);
      if (input.genre) filters.push(sql`genre = ${input.genre}`);
      if (input.decade) filters.push(sql`decade = ${input.decade}`);
      if (input.timeframe === "weekly") {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        filters.push(sql`"createdAt" >= ${weekAgo}`);
      } else if (input.timeframe === "monthly") {
        const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        filters.push(sql`"createdAt" >= ${monthAgo}`);
      }
      const whereClause = filters.length
        ? sql`WHERE ${sql.join(filters, sql` AND `)}`
        : sql``;

      // DISTINCT ON keeps only the highest-scoring row per identity within
      // the active filters. Authed users dedupe on userId; guests dedupe on
      // guestName. The 'u:' / 'g:' prefix prevents a numeric-looking guest
      // name from colliding with a numeric userId.
      const result = await db.execute(sql`
        WITH best_per_player AS (
          SELECT DISTINCT ON (
            CASE
              WHEN "userId" IS NOT NULL THEN 'u:' || "userId"::text
              WHEN "guestName" IS NOT NULL THEN 'g:' || "guestName"
              ELSE 'e:' || id::text
            END
          ) *
          FROM leaderboard_entries
          ${whereClause}
          ORDER BY
            CASE
              WHEN "userId" IS NOT NULL THEN 'u:' || "userId"::text
              WHEN "guestName" IS NOT NULL THEN 'g:' || "guestName"
              ELSE 'e:' || id::text
            END,
            score DESC,
            "createdAt" ASC
        )
        SELECT
          bpp.id                  AS "id",
          bpp."userId"            AS "userId",
          bpp."guestName"         AS "guestName",
          bpp."displayName"       AS "displayName",
          bpp.score               AS "score",
          bpp.mode                AS "mode",
          bpp.genre               AS "genre",
          bpp.decade              AS "decade",
          bpp."rankingMode"       AS "rankingMode",
          bpp."createdAt"         AS "createdAt",
          av.slug                 AS "equippedAvatarSlug"
        FROM best_per_player bpp
        LEFT JOIN users u   ON bpp."userId" = u.id
        LEFT JOIN avatars av ON u."equippedAvatarId" = av.id
        ORDER BY bpp.score DESC
        LIMIT ${input.limit}
      `);

      const rows = (result as { rows?: unknown[] }).rows
        ?? (Array.isArray(result) ? (result as unknown[]) : []);
      return (rows as Array<{
        id: number;
        userId: number | null;
        guestName: string | null;
        displayName: string;
        score: number;
        mode: "solo" | "multiplayer" | "team";
        genre: string | null;
        decade: string | null;
        rankingMode: string;
        createdAt: Date;
        equippedAvatarSlug: string | null;
      }>).map((row) => ({
        ...row,
        equippedAvatarSlug: row.equippedAvatarSlug ?? null,
      }));
    }),

  // Assign player to team
  assignTeam: publicProcedure
    .input(z.object({
      roomCode: z.string(),
      teamId: z.number().int().nullable(),
      guestToken: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new Error("Room not found");
      const userId = ctx.user?.id ?? null;
      const guestToken = input.guestToken ?? null;
      if (userId) {
        await db.update(roomPlayers).set({ teamId: input.teamId }).where(and(eq(roomPlayers.roomId, room.id), eq(roomPlayers.userId, userId)));
      } else if (guestToken) {
        await db.update(roomPlayers).set({ teamId: input.teamId }).where(and(eq(roomPlayers.roomId, room.id), eq(roomPlayers.guestToken, guestToken)));
      }
      return { success: true };
    }),

  // Create teams for a room
  createTeams: publicProcedure
    .input(z.object({
      roomCode: z.string(),
      teamCount: z.number().int().min(2).max(6).default(2),
      guestToken: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });

      // Verify the caller is the host (destructive: deletes existing teams).
      const callerId = ctx.user?.id ?? null;
      const callerToken = input.guestToken ?? null;
      const isHost =
        (callerId !== null && room.hostUserId === callerId) ||
        (callerToken !== null && room.hostGuestToken === callerToken);
      if (!isHost) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the host can configure teams." });
      }

      const TEAM_COLORS = ["#8B5CF6", "#06B6D4", "#F59E0B", "#10B981", "#EF4444", "#EC4899"];
      const TEAM_NAMES = ["Team Purple", "Team Cyan", "Team Gold", "Team Green", "Team Red", "Team Pink"];

      // Delete existing teams
      await db.delete(teams).where(eq(teams.roomId, room.id));

      const created = [];
      for (let i = 0; i < input.teamCount; i++) {
        await db.insert(teams).values({
          roomId: room.id,
          teamName: TEAM_NAMES[i] ?? `Team ${i + 1}`,
          teamColor: TEAM_COLORS[i] ?? "#8B5CF6",
          currentScore: 0,
        });
        created.push({ name: TEAM_NAMES[i], color: TEAM_COLORS[i] });
      }
      return { success: true, teams: created };
    }),

  // Get saved game preferences for the current user
  getMyGamePrefs: publicProcedure
    .query(async ({ ctx }) => {
      if (!ctx.user?.id) return null;
      const db = await getDb();
      if (!db) return null;
      const [u] = await db.select({ gamePrefs: users.gamePrefs }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
      return u?.gamePrefs ?? null;
    }),

  // Save game preferences for the current user
  saveGamePrefs: protectedProcedure
    .input(z.object({
      mode: z.enum(["solo", "multiplayer", "team"]),
      genres: z.array(z.string()).min(1),
      decades: z.array(z.string()).min(1),
      difficulty: z.enum(["low", "medium", "high"]),
      timerSeconds: z.number().int().positive(),
      rounds: z.number().int().min(3).max(20),
      explicitFilter: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { saved: false };
      await db.update(users).set({ gamePrefs: input }).where(eq(users.id, ctx.user.id));
      return { saved: true };
    }),

    // Get user profile stats
  getProfile: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [user] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
      if (!user) throw new Error("User not found");
      // Recent game history
      const recentGames = await db.select().from(leaderboardEntries)
        .where(eq(leaderboardEntries.userId, ctx.user.id))
        .orderBy(sql`${leaderboardEntries.createdAt} DESC`)
        .limit(10);
      return { user, recentGames };
    }),
});
