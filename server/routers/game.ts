import { z } from "zod";
import { and, eq, gte, inArray, isNotNull, ne, notInArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { rateLimit } from "../_core/rateLimit";
import { getDb } from "../db";
import {
  songs, gameRooms, roomPlayers, teams, gameSessions, roundResults,
  guestSessions, leaderboardEntries, artistMetadata, users, avatars,
  goldenNoteBalances, goldenNoteTransactions,
  songDisplays,
  lyricSectionTypeEnum,
} from "../../drizzle/schema";
import { nanoid } from "nanoid";

const STREAK_INSURANCE_PRICE_GN = 3;
const HINT_PRICE_GN = 1;

// ── Helpers ──────────────────────────────────────────────────────────────────
function generateRoomCode(): string {
  return nanoid(6).toUpperCase();
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

type LyricMatch = "full" | "partial" | "none";
type ArtistMatch = "full" | "primary_only" | "none";

function matchLyric(userAnswer: string, correctAnswer: string): LyricMatch {
  const user = normalizeText(userAnswer);
  const correct = normalizeText(correctAnswer);
  if (!user || !correct) return "none";
  if (user === correct) return "full";
  // Allow up to 25% edit distance for full match (handles minor typos/punctuation)
  if (levenshtein(user, correct) <= Math.floor(correct.length * 0.25)) return "full";
  const correctWords = correct.split(" ").filter(w => w.length > 2);
  const userWords = user.split(" ");
  if (correctWords.length === 0) return "none";
  // Allow levenshtein distance of 2 per word for typos
  const matched = correctWords.filter(cw => userWords.some(uw => uw === cw || levenshtein(uw, cw) <= 2));
  const ratio = matched.length / correctWords.length;
  const missing = correctWords.length - matched.length;
  // 60% word match = full (generous for voice input and minor typos)
  if (ratio >= 0.60) return "full";
  if (ratio >= 0.40 || (missing <= 2 && correctWords.length >= 3)) return "partial";
  return "none";
}

function matchArtist(userAnswer: string, correctArtist: string, aliases?: string[]): ArtistMatch {
  const user = normalizeText(userAnswer);
  const correct = normalizeText(correctArtist);
  if (!user || !correct) return "none";

  const norm = (s: string) => s.replace(/\band\b/g, "&").replace(/\s+/g, " ");

  // Helper: check if a single normalized user token matches the correct artist
  const tokenMatches = (token: string): boolean => {
    if (!token || token.length < 2) return false;
    if (token === correct) return true;
    if (norm(token) === norm(correct)) return true;
    // Alias match
    if (aliases?.some(a => token === normalizeText(a))) return true;
    // First-name-only match
    const firstName = correct.split(" ")[0];
    if (firstName && firstName.length >= 3 && (token === firstName || levenshtein(token, firstName) <= 1)) return true;
    // Fuzzy full match — 30% edit distance
    if (levenshtein(token, correct) <= Math.max(2, Math.floor(correct.length * 0.30))) return true;
    return false;
  };

  // Direct full match
  if (tokenMatches(user)) return "full";

  // Multi-artist answer: split by "and", "&", ",", "ft", "feat"
  // e.g. "Ol dirty bastard and Mariah Carey" → check each part
  const splitRe = /\s+(?:and|&|ft\.?|feat\.?|featuring|x|,)\s+/i;
  const parts = user.split(splitRe).map(p => p.trim()).filter(p => p.length > 1);
  if (parts.length > 1) {
    for (const part of parts) {
      if (tokenMatches(part)) return "full";
    }
  }

  // Featured artist: primary-only (user named only the primary, not the featured)
  const featRe = /\s+(?:ft\.?|feat\.?|featuring|x)\s+/i;
  if (featRe.test(correctArtist) || correctArtist.includes(" & ") || /\band\b/i.test(correctArtist)) {
    const primaryRaw = correctArtist.split(featRe)[0].split(" & ")[0].replace(/\band\b.*/i, "").trim();
    const primary = normalizeText(primaryRaw);
    if (primary && (
      user === primary ||
      norm(user) === norm(primary) ||
      levenshtein(user, primary) <= Math.floor(primary.length * 0.2) ||
      user === primary.split(" ")[0]
    )) return "primary_only";
  }
  return "none";
}

function scoreYear(userYear: number | null, correctYear: number): number {
  if (!userYear) return 0;
  const diff = Math.abs(userYear - correctYear);
  if (diff === 0) return 20;
  if (diff <= 2) return 10;
  if (diff <= 3) return 5;
  return 0;
}

// Variant accessor for getNextSong's per-song lyric rotation.
// Returns the song's stored lyricVariants array if non-empty, otherwise
// synthesizes a single variant from the legacy columns so songs that
// haven't been seeded yet still play. Once seed-lyric-variants.mjs has
// run against production, the fallback path is no longer hit for live data.
type SongVariant = {
  prompt: string;
  answer: string;
  distractors: string[];
  sectionType: string;
};
function variantsOf(song: typeof songs.$inferSelect): SongVariant[] {
  if (Array.isArray(song.lyricVariants) && song.lyricVariants.length > 0) {
    return song.lyricVariants as SongVariant[];
  }
  return [{
    prompt: song.lyricPrompt,
    answer: song.lyricAnswer,
    distractors: Array.isArray(song.distractors) ? song.distractors : [],
    sectionType: song.lyricSectionType,
  }];
}

// ── Router ───────────────────────────────────────────────────────────────────
export const gameRouter = router({
  // Create a guest session
  createGuestSession: publicProcedure
    .input(z.object({ nickname: z.string().min(1).max(32) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const token = nanoid(32);
      await db.insert(guestSessions).values({ sessionToken: token, nickname: input.nickname });
      return { token, nickname: input.nickname };
    }),

  // Create a game room
  createRoom: publicProcedure
    .input(z.object({
      mode: z.enum(["solo", "multiplayer", "team"]),
      rankingMode: z.enum(["total_points", "speed_bonus", "streak_bonus"]).default("total_points"),
      genres: z.array(z.string()).min(1),
      decades: z.array(z.string()).min(1),
      difficulty: z.enum(["low", "medium", "high"]).default("medium"),
      timerSeconds: z.number().int().min(15).max(45).default(30),
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
      if (!room) throw new Error("Room not found");
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
        // ── Standard branch: genre / decade / difficulty filter + weighted pick ──

        // Section-type filter PLUS weighted bias for the candidate pick. Low: hooks/
        // choruses only. Medium/High: chorus + hook + verse dominant; bridge and
        // call-response remain occasional picks (low weight) rather than dropped.
        type SectionType = (typeof lyricSectionTypeEnum.enumValues)[number];
        let difficultyFilter: SectionType[];
        let sectionWeights: Record<SectionType, number>;
        if (room.difficulty === "low") {
          difficultyFilter = ["chorus", "hook"];
          sectionWeights = { chorus: 1, hook: 1, verse: 0, "call-response": 0, bridge: 0 };
        } else {
          // Medium and High share section sampling — they differ in what's shown
          // to the player (lyric fill-in difficulty), not in song selection.
          difficultyFilter = ["chorus", "hook", "verse", "bridge", "call-response"];
          sectionWeights = { chorus: 1, hook: 1, verse: 3, bridge: 0.3, "call-response": 0.3 };
        }

        // Map decades to year ranges AND short-form labels (e.g. "1980s")
        // Note: "1980–1990" means the 1980s decade (1980-1989), end year is exclusive
        const decadeYearRanges = decades.map(d => {
          const match = d.match(/(\d{4})[–-](\d{4}|Present)/);
          if (!match) return null;
          const start = parseInt(match[1]);
          // End is exclusive: "1980–1990" covers 1980-1989
          const endRaw = match[2] === "Present" ? new Date().getFullYear() + 1 : parseInt(match[2]);
          const end = endRaw - 1; // inclusive end
          // Derive short-form label: "1980–1990" → "1980s", "2020–Present" → "2020s"
          const shortLabel = `${match[1].slice(0, 3)}0s`;
          return { start, end, longLabel: d, shortLabel };
        }).filter(Boolean) as { start: number; end: number; longLabel: string; shortLabel: string }[];

        // Collect all decadeRange label variants stored in DB for these decades
        const decadeLabels: string[] = [];
        for (const r of decadeYearRanges) {
          decadeLabels.push(r.longLabel);
          decadeLabels.push(r.shortLabel);
        }

        // Helper to filter songs by decade (strict)
        const matchesDecade = (s: typeof songs.$inferSelect) =>
          decadeLabels.includes(s.decadeRange ?? "") ||
          decadeYearRanges.some(r => s.releaseYear >= r.start && s.releaseYear <= r.end);

        // Get candidate songs matching genre + difficulty + decade
        let stdCandidateSongs = await db.select().from(songs).where(
          and(
            eq(songs.isActive, true),
            eq(songs.approvalStatus, "approved"),
            inArray(songs.genre, genres),
            inArray(songs.lyricSectionType, difficultyFilter),
            room.explicitFilter ? eq(songs.explicitFlag, false) : undefined,
            usedIds.length > 0 ? notInArray(songs.id, usedIds) : undefined,
          )
        );

        // Filter by decade (strict — always enforce selected decades)
        stdCandidateSongs = stdCandidateSongs.filter(matchesDecade);

        if (stdCandidateSongs.length === 0) {
          // Fallback 1: relax difficulty filter but KEEP genre + decade strict.
          // Genre/decade are user intent — never silently swap them.
          let relaxed = await db.select().from(songs).where(
            and(
              eq(songs.isActive, true),
              eq(songs.approvalStatus, "approved"),
              inArray(songs.genre, genres),
              usedIds.length > 0 ? notInArray(songs.id, usedIds) : undefined,
            )
          );
          relaxed = relaxed.filter(matchesDecade);

          if (relaxed.length === 0) {
            // Fallback 2: allow re-playing previously-used songs within the
            // same genre + decade rather than switching categories.
            let recycled = await db.select().from(songs).where(
              and(
                eq(songs.isActive, true),
                eq(songs.approvalStatus, "approved"),
                inArray(songs.genre, genres),
              )
            );
            recycled = recycled.filter(matchesDecade);
            stdCandidateSongs = recycled;
          } else {
            stdCandidateSongs = relaxed;
          }
        }

        if (stdCandidateSongs.length === 0) {
          const genreLabel = genres.join(" / ");
          const decadeLabel = decades.join(" / ");
          throw new Error(
            `No ${genreLabel} songs available for ${decadeLabel}. Pick a broader selection on the setup screen.`
          );
        }

        // ── Per-identity dedup window ────────────────────────────────────────
        // Exclude songs already shown to THIS user/guest in the last 10 days.
        // If that empties the pool, relax to 7 days. If still empty, drop
        // dedup entirely so we never block the player — preserves the
        // existing "never empty" guarantee of the fallback chain.
        const dedupDb = db;
        const songIdsShownSince = async (days: number): Promise<Set<number>> => {
          const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
          let rows: { songId: number }[] = [];
          if (dedupUserId !== null) {
            rows = await dedupDb
              .select({ songId: songDisplays.songId })
              .from(songDisplays)
              .where(
                and(
                  eq(songDisplays.userId, dedupUserId),
                  gte(songDisplays.shownAt, cutoff),
                ),
              );
          } else if (dedupGuestToken !== null) {
            rows = await dedupDb
              .select({ songId: songDisplays.songId })
              .from(songDisplays)
              .where(
                and(
                  eq(songDisplays.guestToken, dedupGuestToken),
                  gte(songDisplays.shownAt, cutoff),
                ),
              );
          }
          return new Set(rows.map(r => r.songId));
        };

        if (dedupUserId !== null || dedupGuestToken !== null) {
          const recent10 = await songIdsShownSince(10);
          let dedupedPool = stdCandidateSongs.filter(s => !recent10.has(s.id));
          if (dedupedPool.length === 0) {
            const recent7 = await songIdsShownSince(7);
            dedupedPool = stdCandidateSongs.filter(s => !recent7.has(s.id));
          }
          // If still empty, fall through with the unfiltered pool — the
          // global penalty below still discourages over-shown picks.
          if (dedupedPool.length > 0) {
            stdCandidateSongs = dedupedPool;
          }
        }

        // Weighted random pick: each candidate's section weight is divided
        // by log10(1 + displayCount) so globally over-shown songs slide
        // down without being banned. Songs whose section has weight 0
        // (low difficulty filtering out verses, etc.) are still excluded.
        const weighted = stdCandidateSongs
          .map(s => ({
            s,
            w:
              ((sectionWeights[(s.lyricSectionType as SectionType)] ?? 0) /
                (1 + Math.log10(1 + (s.displayCount ?? 0)))),
          }))
          .filter(x => x.w > 0);
        const pickPool = weighted.length > 0
          ? weighted
          : stdCandidateSongs.map(s => ({ s, w: 1 }));
        const totalWeight = pickPool.reduce((acc, x) => acc + x.w, 0);
        let rnd = Math.random() * totalWeight;
        song = pickPool[0].s;
        for (const x of pickPool) {
          rnd -= x.w;
          if (rnd <= 0) { song = x.s; break; }
        }

        candidateSongs = stdCandidateSongs;

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
      const allVariants = variantsOf(song);
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
      const unseenIndices = allVariants
        .map((_, i) => i)
        .filter(i => !seenVariantIndices.has(i));
      const pickedVariantIndex = unseenIndices.length > 0
        ? unseenIndices[Math.floor(Math.random() * unseenIndices.length)]
        : 0;
      const pickedVariant = allVariants[pickedVariantIndex] ?? allVariants[0];

      // ── Display log + global counter bump ──────────────────────────────────
      // Runs in BOTH branches so practice-pack rounds also feed the dedup
      // window and the usage report. Back-to-back rather than wrapped in a
      // transaction to match the surrounding style — the worst case if the
      // counter UPDATE fails is one missing display row, not a corrupt game.
      await db.insert(songDisplays).values({
        songId: song.id,
        userId: dedupUserId,
        guestToken: dedupGuestToken
          ? dedupGuestToken.slice(0, 64)
          : null,
        roomCode: room.roomCode ?? null,
        variantIndex: pickedVariantIndex,
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
        .select({ variantIndex: songDisplays.variantIndex })
        .from(songDisplays)
        .where(and(...displayConditions))
        .orderBy(sql`${songDisplays.shownAt} DESC`)
        .limit(1);
      const allVariants = variantsOf(song);
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

      // Difficulty-based point values
      // All difficulties score the same 4 stages (Lyric, Title, Artist, Year);
      // difficulty is a points multiplier only. Lyric and Title share the same
      // per-difficulty value.
      // Low:    Lyric=25,  Title=25,  Artist=25,  Year=50
      // Medium: Lyric=50,  Title=50,  Artist=50,  Year=100
      // High:   Lyric=50,  Title=50,  Artist=100, Year=200
      const diff = room.difficulty as "low" | "medium" | "high";
      const pts = {
        // artistPartial = full artist points (primary-only match = full credit per spec)
        low:    { lyric: 25, lyricPartial: 15, artist: 25,  artistPartial: 25,  title: 25, titlePartial: 15, year: 50,  yearClose2: 0,  yearClose3: 0 },
        medium: { lyric: 50, lyricPartial: 30, artist: 50,  artistPartial: 50,  title: 50, titlePartial: 30, year: 100, yearClose2: 0,  yearClose3: 0 },
        high:   { lyric: 50, lyricPartial: 25, artist: 100, artistPartial: 100, title: 50, titlePartial: 30, year: 200, yearClose2: 0,  yearClose3: 0 },
      }[diff];

      // Score the answer
      let lyricPoints = 0, titlePoints = 0, artistPoints = 0, yearPoints = 0, speedBonus = 0, streakBonus = 0;
      let lyricMatch: LyricMatch = "none";
      let artistMatch: ArtistMatch = "none";
      let titleCorrect = false;
      let titlePartial = false;

      if (!input.passUsed) {
        // Lyric scoring (all difficulties) — use the variant the player saw,
        // not the legacy column, so variant rotation scores correctly.
        lyricMatch = matchLyric(input.lyricAnswer, playedVariant.answer);
        lyricPoints = lyricMatch === "full" ? pts.lyric : lyricMatch === "partial" ? pts.lyricPartial : 0;

        // Title scoring (Low/Medium/High all score title)
        const titleNorm = normalizeText(input.titleAnswer);
        const correctTitleNorm = normalizeText(song.title);
        if (titleNorm && correctTitleNorm) {
          // Full match: exact, or up to 30% edit distance (generous for typos/voice input)
          const titleEditDist = levenshtein(titleNorm, correctTitleNorm);
          const titleThreshold = Math.max(2, Math.floor(correctTitleNorm.length * 0.30));
          if (titleNorm === correctTitleNorm || titleEditDist <= titleThreshold) {
            titleCorrect = true;
            titlePoints = pts.title;
          } else {
            // Partial: significant word overlap (allow levenshtein 2 per word)
            const titleWords = correctTitleNorm.split(" ").filter(w => w.length > 1);
            const userTitleWords = titleNorm.split(" ");
            if (titleWords.length > 0) {
              const matched = titleWords.filter(tw => userTitleWords.some(uw => uw === tw || levenshtein(uw, tw) <= 2));
              if (matched.length / titleWords.length >= 0.5) {
                titlePartial = true;
                titlePoints = pts.titlePartial;
              }
            }
          }
        }

        artistMatch = matchArtist(input.artistAnswer, song.artistName, aliases);
        artistPoints = artistMatch === "full" ? pts.artist : artistMatch === "primary_only" ? pts.artistPartial : 0;

        // Year scoring with new point values
        const userYear = parseInt(input.yearAnswer) || null;
        if (userYear) {
          const diff2 = Math.abs(userYear - song.releaseYear);
          if (diff2 === 0) yearPoints = pts.year;
          else if (diff2 <= 2) yearPoints = pts.yearClose2;
          else if (diff2 <= 3) yearPoints = pts.yearClose3;
        }

        // Speed bonus
        const anyCorrect = lyricMatch !== "none" || titleCorrect || titlePartial || artistMatch !== "none" || yearPoints > 0;
        if (room.rankingMode === "speed_bonus" && anyCorrect) {
          const timeRatio = 1 - (input.responseTimeSeconds / room.timerSeconds);
          speedBonus = Math.max(0, Math.round(timeRatio * (diff === "high" ? 20 : diff === "medium" ? 10 : 5)));
        }
      }

      const lyricCorrect = lyricMatch === "full";
      const lyricPartialFlag = lyricMatch === "partial";
      const artistCorrect = artistMatch === "full";
      const artistPartial = artistMatch === "primary_only";
      const correctCount =
        (lyricCorrect || lyricPartialFlag ? 1 : 0) +
        (titleCorrect || titlePartial ? 1 : 0) +
        (artistCorrect || artistPartial ? 1 : 0) +
        (yearPoints > 0 ? 1 : 0);

      const userId = ctx.user?.id ?? null;
      const guestToken = input.guestToken ?? null;

      // Get player for streak
      const [player] = await db.select().from(roomPlayers).where(
        and(
          eq(roomPlayers.roomId, room.id),
          userId ? eq(roomPlayers.userId, userId) : eq(roomPlayers.guestToken, guestToken ?? "")
        )
      ).limit(1);

      if (player) {
        // ── Streak Insurance: if the player missed the lyric stage and has an
        // active streak, check whether streak insurance is enabled on this room.
        // If so, preserve the streak (one-shot: flip room.streakInsurance to false).
        let streakInsuranceUsed = false;
        const rawNewStreak = lyricCorrect ? player.currentStreak + 1 : 0;
        let newStreak = rawNewStreak;

        if (!lyricCorrect && player.currentStreak >= 1 && room.streakInsurance) {
          // Insurance fires — preserve the streak, consume the flag.
          newStreak = player.currentStreak;
          streakInsuranceUsed = true;
          await db
            .update(gameRooms)
            .set({ streakInsurance: false })
            .where(eq(gameRooms.id, room.id));
        }

        // Streak bonus
        if (room.rankingMode === "streak_bonus" && lyricCorrect && newStreak >= 2) {
          streakBonus = Math.min(newStreak * 2, 10);
        }

        const totalRoundPoints = lyricPoints + titlePoints + artistPoints + yearPoints + speedBonus + streakBonus;
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

        return {
          lyricCorrect,
          lyricPartial: lyricPartialFlag,
          titleCorrect,
          titlePartial,
          artistCorrect,
          artistPartial,
          correctCount,
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
        };
      }

      return {
        lyricCorrect, lyricPartial: lyricPartialFlag, titleCorrect, titlePartial,
        artistCorrect, artistPartial, correctCount,
        lyricPoints, titlePoints, artistPoints, yearPoints,
        speedBonus, streakBonus, total: 0, newScore: 0, newStreak: 0,
        streakInsuranceUsed: false,
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
        const variants = variantsOf(song);
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
    .input(z.object({ roomCode: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new Error("Room not found");

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
        // Save leaderboard entries
        for (const player of players) {
          const displayName = player.guestName || "Player";
          await db.insert(leaderboardEntries).values({
            userId: player.userId,
            guestName: player.guestName,
            displayName,
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
      }

      return { nextRound, isGameOver, nextPlayerIndex };
    }),

  // Get final results
  getFinalResults: publicProcedure
    .input(z.object({ roomCode: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new Error("Room not found");
      const players = await db.select().from(roomPlayers).where(and(eq(roomPlayers.roomId, room.id), eq(roomPlayers.isActive, true)));
      const roomTeams = await db.select().from(teams).where(eq(teams.roomId, room.id));
      const sorted = [...players].sort((a, b) => b.currentScore - a.currentScore);
      return {
        room: { ...room, selectedGenres: JSON.parse(room.selectedGenres), selectedDecades: JSON.parse(room.selectedDecades) },
        players: sorted,
        teams: roomTeams,
      };
    }),

  // Get leaderboard
  getLeaderboard: publicProcedure
    .input(z.object({
      mode: z.enum(["solo", "multiplayer", "team"]).optional(),
      genre: z.string().optional(),
      decade: z.string().optional(),
      timeframe: z.enum(["weekly", "monthly", "all_time"]).default("all_time"),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const conditions = [];
      if (input.mode) conditions.push(eq(leaderboardEntries.mode, input.mode));
      if (input.genre) conditions.push(eq(leaderboardEntries.genre, input.genre));
      if (input.decade) conditions.push(eq(leaderboardEntries.decade, input.decade));
      if (input.timeframe === "weekly") {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        conditions.push(sql`${leaderboardEntries.createdAt} >= ${weekAgo}`);
      } else if (input.timeframe === "monthly") {
        const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        conditions.push(sql`${leaderboardEntries.createdAt} >= ${monthAgo}`);
      }

      const rows = await db
        .select({
          entry: leaderboardEntries,
          equippedAvatarSlug: avatars.slug,
        })
        .from(leaderboardEntries)
        .leftJoin(users, eq(leaderboardEntries.userId, users.id))
        .leftJoin(avatars, eq(users.equippedAvatarId, avatars.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(sql`${leaderboardEntries.score} DESC`)
        .limit(input.limit);

      return rows.map((row) => ({
        ...row.entry,
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
      if (!room) throw new Error("Room not found");

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
  saveGamePrefs: publicProcedure
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
      if (!ctx.user?.id) return { saved: false };
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
