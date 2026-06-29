// server/routers/matchEngine.ts
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { gameRooms, roomPlayers, roundResults, songs, artistMetadata } from "../../drizzle/schema";
import { selectSongForRoom } from "../_core/songSelection";
import { selectCustomPackSong } from "../_core/customPack";
import { scoreRound, matchLyric, type Difficulty } from "../_core/scoring";
import { variantsForSong } from "../_core/variantReader";
import { buildMatchQuestion, type MatchQuestion } from "../_core/buildMatchQuestion";

export function assertCanStart(opts: {
  isHost: boolean;
  status: string;
  readyCount: number;
  playerCount: number;
}): void {
  if (!opts.isHost) throw new TRPCError({ code: "FORBIDDEN", message: "Only the host can start." });
  if (opts.status !== "waiting") throw new TRPCError({ code: "BAD_REQUEST", message: "Match already started." });
  if (opts.playerCount < 2) throw new TRPCError({ code: "BAD_REQUEST", message: "Need at least 2 players." });
  if (opts.readyCount < opts.playerCount) throw new TRPCError({ code: "BAD_REQUEST", message: "All players must be ready." });
}

/**
 * Pure guard: returns true when the round is ready to be revealed — either all
 * active players have answered, or the round deadline has passed.
 * Extracted as a named export so it can be unit-tested without a DB.
 */
export function canReveal(opts: {
  phase: string | null;
  answeredCount: number;
  activeCount: number;
  nowMs: number;
  deadlineMs: number;
}): boolean {
  if (opts.phase !== "in_question") return false;
  return opts.answeredCount >= opts.activeCount || opts.nowMs >= opts.deadlineMs;
}

/**
 * Pure decision function: given the current room state, returns whether the
 * engine should wait, advance to the next round, or complete the match.
 * Exported for unit testing without a DB.
 */
export function nextRoundDecision(opts: {
  phase: string | null;
  nowMs: number;
  deadlineMs: number;
  currentRound: number;
  roundsTotal: number;
}): "wait" | "next" | "complete" {
  if (opts.phase !== "intermission" || opts.nowMs < opts.deadlineMs) return "wait";
  return opts.currentRound < opts.roundsTotal ? "next" : "complete";
}

/**
 * Pure guard: returns true only when the round is in the right phase AND
 * the current wall-clock time is within the answer window (deadline + grace).
 * Extracted as a named export so it can be unit-tested without a DB.
 */
export function isSubmitAccepted(opts: {
  phase: string | null;
  nowMs: number;
  deadlineMs: number;
  graceMs: number;
}): boolean {
  return opts.phase === "in_question" && opts.nowMs <= opts.deadlineMs + opts.graceMs;
}

// Authoritative snapshot for join / reconnect / post-broadcast refetch.
export const matchEngineRouter = router({
  startMatch: protectedProcedure
    .input(z.object({ roomCode: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      const players = await db.select().from(roomPlayers).where(eq(roomPlayers.roomId, room.id));
      const isHost = (!!ctx.user?.id && room.hostUserId === ctx.user.id);
      assertCanStart({ isHost, status: room.status, readyCount: players.filter(p => p.isReady).length, playerCount: players.length });

      const used: number[] = room.usedSongIds ? JSON.parse(room.usedSongIds) : [];
      const pack =
        Array.isArray(room.customPackSongIds) && room.customPackSongIds.length > 0
          ? (room.customPackSongIds as number[])
          : null;

      let songId: number;
      let pickedSong: typeof songs.$inferSelect;
      let candidateSongs: (typeof songs.$inferSelect)[];
      let pickedVariant: { prompt: string; answer: string; distractors: string[]; sectionType: string };

      if (pack) {
        // ── Curated-pack branch: serve the admin's list in order (decisions a + b) ──
        const pick = await selectCustomPackSong(db, {
          customPackSongIds: pack,
          customPackVariants: (room.customPackVariants as Array<number | null> | null) ?? null,
          usedSongIds: used,
        });
        if (!pick) throw new TRPCError({ code: "BAD_REQUEST", message: "Contest song list is empty." });
        pickedSong = pick.song;
        songId = pick.song.id;
        candidateSongs = pick.candidateSongs;
        const allVariants = await variantsForSong(db, pickedSong);
        const vIdx =
          pick.variantIndex != null && pick.variantIndex >= 0 && pick.variantIndex < allVariants.length
            ? pick.variantIndex
            : 0;
        pickedVariant = allVariants[vIdx] ?? { prompt: "", answer: "", distractors: [], sectionType: "" };
      } else {
        // ── Standard branch (unchanged behavior) ──
        const pick = await selectSongForRoom(db, {
          genres: JSON.parse(room.selectedGenres),
          decades: JSON.parse(room.selectedDecades),
          difficulty: room.difficulty,
          explicitFilter: room.explicitFilter,
          usedSongIds: used,
        });
        if (!pick) throw new TRPCError({ code: "BAD_REQUEST", message: "No songs available for these filters." });
        songId = pick.songId;
        const found = pick.candidateSongs.find((s) => s.id === pick.songId);
        if (!found) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Picked song missing from candidate pool." });
        pickedSong = found;
        candidateSongs = pick.candidateSongs;
        const allVariants = await variantsForSong(db, pickedSong);
        pickedVariant = allVariants[0] ?? { prompt: "", answer: "", distractors: [], sectionType: "" };
      }

      // Build the per-round answer-free question payload ONCE so getMatchState
      // returns a stable payload (no reshuffle on every poll).
      const question: MatchQuestion = buildMatchQuestion({
        song: pickedSong,
        variant: pickedVariant,
        candidateSongs,
        difficulty: room.difficulty as "low" | "medium" | "high",
      });

      const now = new Date();
      const endsAt = new Date(now.getTime() + room.timerSeconds * 1000);
      const res = await db.update(gameRooms).set({
        status: "active", currentRound: 1, roundPhase: "in_question",
        currentSongId: songId, usedSongIds: JSON.stringify([...used, songId]),
        roundEndsAt: endsAt, updatedAt: now,
        currentQuestion: question,
      }).where(and(eq(gameRooms.id, room.id), eq(gameRooms.status, "waiting"))).returning({ id: gameRooms.id });
      if (res.length === 0) throw new TRPCError({ code: "CONFLICT", message: "Match already started." });
      return { ok: true, currentRound: 1, roundEndsAt: endsAt };
    }),

  getMatchState: publicProcedure
    .input(z.object({ roomCode: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [room] = await db
        .select()
        .from(gameRooms)
        .where(eq(gameRooms.roomCode, input.roomCode))
        .limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      const STALE_MS = 2 * 60 * 1000; // 2 min past the round deadline → abandoned
      if (room.status === "active" && room.roundEndsAt && Date.now() > new Date(room.roundEndsAt).getTime() + STALE_MS) {
        await db.update(gameRooms).set({ status: "finished", roundPhase: "complete", roundEndsAt: null, updatedAt: new Date() })
          .where(and(eq(gameRooms.id, room.id), eq(gameRooms.status, "active"))).returning({ id: gameRooms.id });
        room.status = "finished"; room.roundPhase = "complete"; room.roundEndsAt = null;
      }
      const players = await db
        .select()
        .from(roomPlayers)
        .where(eq(roomPlayers.roomId, room.id))
        .orderBy(roomPlayers.joinOrder);
      const standings = [...players].sort((a, b) => b.currentScore - a.currentScore);
      // Who has submitted an answer for the current round?
      // Only meaningful during in_question; return empty for all other phases.
      const answered =
        room.roundPhase === "in_question" && room.currentRound > 0
          ? await db
              .select({ pid: roundResults.activePlayerId })
              .from(roundResults)
              .where(
                and(
                  eq(roundResults.roomId, room.id),
                  eq(roundResults.roundNumber, room.currentRound),
                ),
              )
          : [];
      const answeredPlayerIds = answered
        .map((a) => a.pid)
        .filter((x): x is number => x != null);
      return {
        room: {
          id: room.id,
          roomCode: room.roomCode,
          status: room.status,
          roundPhase: room.roundPhase,
          currentRound: room.currentRound,
          roundsTotal: room.roundsTotal,
          roundEndsAt: room.roundEndsAt,
          currentSongId: room.currentSongId,
          difficulty: room.difficulty,
          timerSeconds: room.timerSeconds,
          hostUserId: room.hostUserId,
          maxPlayers: room.maxPlayers,
          // Answer-free question payload — built once at round start, stable
          // across all getMatchState polls. Null until the first round starts.
          currentQuestion: (room.currentQuestion as MatchQuestion | null) ?? null,
        },
        players: players.map(p => ({
          id: p.id,
          userId: p.userId,
          guestName: p.guestName,
          currentScore: p.currentScore,
          isReady: p.isReady,
          isActive: p.isActive,
          joinOrder: p.joinOrder,
        })),
        standings: standings.map((p, i) => ({
          rank: i + 1,
          playerId: p.id,
          score: p.currentScore,
        })),
        // IDs of players who have submitted an answer for the current round.
        // Empty array when not in in_question phase (intermission, complete, etc.).
        answeredPlayerIds,
      };
    }),

  submitAnswer: protectedProcedure
    .input(z.object({
      roomCode: z.string(),
      lyricAnswer: z.string().optional(),
      titleAnswer: z.string().optional(),
      artistAnswer: z.string().optional(),
      yearAnswer: z.number().optional(),
      responseTimeSeconds: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });

      const [player] = await db.select().from(roomPlayers)
        .where(and(eq(roomPlayers.roomId, room.id), eq(roomPlayers.userId, ctx.user.id))).limit(1);
      if (!player) throw new TRPCError({ code: "FORBIDDEN", message: "Not a player in this room." });

      // Late-submit guard: 1.5 s grace period past the round deadline.
      const GRACE_MS = 1500;
      const deadlineMs = room.roundEndsAt ? new Date(room.roundEndsAt).getTime() : 0;
      if (!isSubmitAccepted({ phase: room.roundPhase, nowMs: Date.now(), deadlineMs, graceMs: GRACE_MS }))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Round is not accepting answers." });

      if (!room.currentSongId) throw new TRPCError({ code: "BAD_REQUEST", message: "No active question." });

      // ── Load song + played variant (mirrors solo submitAnswer) ───────────────
      // In synchronized multiplayer every player sees the same question
      // (room.currentSongId, variant index 0 — startMatch writes no song_displays
      // row, so there is no per-player variantIndex to look up; we always use
      // allVariants[0] which is variant index 0, identical across all players).
      const [song] = await db.select().from(songs).where(eq(songs.id, room.currentSongId)).limit(1);
      if (!song) throw new TRPCError({ code: "BAD_REQUEST", message: "Active song not found." });

      const allVariants = await variantsForSong(db, song);
      // All match players see the same variant (index 0); no per-player rotation.
      const playedVariant = allVariants[0] ?? { answer: song.lyricAnswer ?? "", prompt: "" };

      // ── Artist aliases (mirrors solo submitAnswer) ───────────────────────────
      let aliases: string[] = [];
      if (song.artistMetadataId) {
        const [meta] = await db.select({ aliases: artistMetadata.aliases })
          .from(artistMetadata).where(eq(artistMetadata.id, song.artistMetadataId)).limit(1);
        if (meta?.aliases) {
          try { aliases = JSON.parse(meta.aliases); } catch {}
        }
      }

      // ── Streak resolution (mirrors solo submitAnswer exactly) ────────────────
      // Solo pre-checks lyric correctness before calling scoreRound so that
      // streak insurance can fire first.  In match rooms streakInsurance is
      // always false (the flag is irrelevant for synchronized play), but we
      // still compute newStreak the same way for scoring parity.
      const lyricAnswerStr = input.lyricAnswer ?? "";
      const preCheckLyricCorrect = matchLyric(lyricAnswerStr, playedVariant.answer) === "full";
      const newStreak = preCheckLyricCorrect ? player.currentStreak + 1 : 0;
      // (No streakInsurance branch needed — match rooms don't carry the flag.)

      // ── Pure scoring — identical inputs to solo submitAnswer ─────────────────
      // yearAnswer: ScoreRoundInput expects a string (it calls parseInt internally);
      // the match input accepts a number for convenience, so convert it here.
      const points = scoreRound({
        difficulty: room.difficulty as Difficulty,
        passUsed: false,                        // match play has no pass option
        lyricAnswer: lyricAnswerStr,
        titleAnswer: input.titleAnswer ?? "",
        artistAnswer: input.artistAnswer ?? "",
        yearAnswer: String(input.yearAnswer ?? ""),
        correctLyricAnswer: playedVariant.answer,
        correctTitle: song.title,
        correctArtistName: song.artistName,
        correctReleaseYear: song.releaseYear,
        artistAliases: aliases,
        responseTimeSeconds: input.responseTimeSeconds ?? 0,
        timerSeconds: room.timerSeconds,
        rankingMode: room.rankingMode,
        newStreak,
      });

      // ── Persist round result (double-submit caught by unique index) ──────────
      try {
        await db.insert(roundResults).values({
          roomId: room.id,
          roundNumber: room.currentRound,
          activePlayerId: player.id,
          songId: room.currentSongId,
          userLyricAnswer: input.lyricAnswer ?? null,
          userArtistAnswer: input.artistAnswer ?? null,
          userYearAnswer: input.yearAnswer ?? null,
          responseTimeSeconds: input.responseTimeSeconds ?? null,
          lyricPoints: points.lyricPoints,
          artistPoints: points.artistPoints,
          yearPoints: points.yearPoints,
          speedBonusPoints: points.speedBonusPoints,
          streakBonusPoints: points.streakBonusPoints,
          totalRoundPoints: points.totalRoundPoints,
          passUsed: false,
        });
      } catch (e: any) {
        // The unique index `round_results_room_round_player_uq` on
        // (roomId, roundNumber, activePlayerId) prevents double-submits.
        if (e?.code === "23505" && (e?.constraint_name === "round_results_room_round_player_uq" || String(e?.message ?? "").includes("round_results_room_round_player_uq")))
          throw new TRPCError({ code: "CONFLICT", message: "Already answered this round." });
        throw e;
      }

      // ── Update score + streak (mirrors solo: newStreak = post-score streak) ──
      // Solo sets currentStreak: newStreak unconditionally (the pre-insurance
      // newStreak value is already the final value after insurance resolution).
      // Match has no insurance, so newStreak is always the simple rule.
      await db.update(roomPlayers).set({
        currentScore: player.currentScore + points.totalRoundPoints,
        currentStreak: newStreak,
      }).where(eq(roomPlayers.id, player.id));

      return { totalRoundPoints: points.totalRoundPoints };
    }),

  revealRound: protectedProcedure
    .input(z.object({ roomCode: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      const players = await db.select().from(roomPlayers).where(eq(roomPlayers.roomId, room.id));
      if (!players.some(p => p.userId === ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN", message: "Not a player in this room." });
      const activeCount = players.filter(p => p.isActive).length;
      const answered = await db.select().from(roundResults)
        .where(and(eq(roundResults.roomId, room.id), eq(roundResults.roundNumber, room.currentRound)));
      const INTERMISSION_S = 5;
      if (!canReveal({
        phase: room.roundPhase,
        answeredCount: answered.length,
        activeCount,
        nowMs: Date.now(),
        deadlineMs: room.roundEndsAt ? new Date(room.roundEndsAt).getTime() : 0,
      }))
        return { revealed: false };
      const endsAt = new Date(Date.now() + INTERMISSION_S * 1000);
      // Idempotent: WHERE guards on currentRound + roundPhase so only the first
      // concurrent call flips the phase; subsequent calls get res.length === 0.
      const res = await db.update(gameRooms)
        .set({ roundPhase: "intermission", roundEndsAt: endsAt, updatedAt: new Date() })
        .where(and(
          eq(gameRooms.id, room.id),
          eq(gameRooms.currentRound, room.currentRound),
          eq(gameRooms.roundPhase, "in_question"),
        ))
        .returning({ id: gameRooms.id });
      return { revealed: res.length > 0 };
    }),

  advanceRound: protectedProcedure
    .input(z.object({ roomCode: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      const players = await db.select().from(roomPlayers).where(eq(roomPlayers.roomId, room.id));
      if (!players.some(p => p.userId === ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN", message: "Not a player in this room." });
      const decision = nextRoundDecision({
        phase: room.roundPhase,
        nowMs: Date.now(),
        deadlineMs: room.roundEndsAt ? new Date(room.roundEndsAt).getTime() : 0,
        currentRound: room.currentRound,
        roundsTotal: room.roundsTotal,
      });
      if (decision === "wait") return { advanced: false };
      if (decision === "complete") {
        // Idempotent: WHERE guards on currentRound + roundPhase so only the first
        // concurrent call flips the status; subsequent calls get res.length === 0.
        const res = await db.update(gameRooms)
          .set({ status: "finished", roundPhase: "complete", roundEndsAt: null, updatedAt: new Date() })
          .where(and(
            eq(gameRooms.id, room.id),
            eq(gameRooms.currentRound, room.currentRound),
            eq(gameRooms.roundPhase, "intermission"),
          ))
          .returning({ id: gameRooms.id });
        return { advanced: res.length > 0, complete: true };
      }
      // decision === "next"
      const used: number[] = room.usedSongIds ? JSON.parse(room.usedSongIds) : [];
      const pack =
        Array.isArray(room.customPackSongIds) && room.customPackSongIds.length > 0
          ? (room.customPackSongIds as number[])
          : null;

      let songId: number = 0;
      let pickedSong: typeof songs.$inferSelect | null = null;
      let candidateSongs: (typeof songs.$inferSelect)[] = [];
      let pickedVariant = { prompt: "", answer: "", distractors: [] as string[], sectionType: "" };

      if (pack) {
        const pick = await selectCustomPackSong(db, {
          customPackSongIds: pack,
          customPackVariants: (room.customPackVariants as Array<number | null> | null) ?? null,
          usedSongIds: used,
        });
        if (pick) {
          pickedSong = pick.song;
          songId = pick.song.id;
          candidateSongs = pick.candidateSongs;
          const allVariants = await variantsForSong(db, pick.song);
          const vIdx = pick.variantIndex != null && pick.variantIndex >= 0 && pick.variantIndex < allVariants.length ? pick.variantIndex : 0;
          pickedVariant = allVariants[vIdx] ?? pickedVariant;
        }
      } else {
        let std: Awaited<ReturnType<typeof selectSongForRoom>> = null;
        try {
          std = await selectSongForRoom(db, { genres: JSON.parse(room.selectedGenres), decades: JSON.parse(room.selectedDecades), difficulty: room.difficulty, explicitFilter: room.explicitFilter, usedSongIds: used });
        } catch { std = null; }
        if (std) {
          const found = std.candidateSongs.find((s) => s.id === std!.songId);
          if (found) {
            pickedSong = found;
            songId = std.songId;
            candidateSongs = std.candidateSongs;
            const allVariants = await variantsForSong(db, found);
            pickedVariant = allVariants[0] ?? pickedVariant;
          }
        }
      }

      if (!pickedSong) {
        // Pool/pack exhausted — finish gracefully (mirrors existing behavior).
        const done = await db.update(gameRooms)
          .set({ status: "finished", roundPhase: "complete", roundEndsAt: null, updatedAt: new Date() })
          .where(and(eq(gameRooms.id, room.id), eq(gameRooms.currentRound, room.currentRound), eq(gameRooms.roundPhase, "intermission")))
          .returning({ id: gameRooms.id });
        return { advanced: done.length > 0, complete: true };
      }

      // Build the per-round answer-free question payload ONCE so getMatchState
      // returns a stable payload (no reshuffle on every poll).
      const questionAdv: MatchQuestion = buildMatchQuestion({
        song: pickedSong,
        variant: pickedVariant,
        candidateSongs,
        difficulty: room.difficulty as "low" | "medium" | "high",
      });

      const endsAt = new Date(Date.now() + room.timerSeconds * 1000);
      // Idempotent: WHERE guards on currentRound + roundPhase so only the first
      // concurrent call advances; subsequent calls get res.length === 0.
      const res = await db.update(gameRooms)
        .set({
          currentRound: room.currentRound + 1,
          roundPhase: "in_question",
          currentSongId: songId,
          usedSongIds: JSON.stringify([...used, songId]),
          roundEndsAt: endsAt,
          updatedAt: new Date(),
          currentQuestion: questionAdv,
        })
        .where(and(
          eq(gameRooms.id, room.id),
          eq(gameRooms.currentRound, room.currentRound),
          eq(gameRooms.roundPhase, "intermission"),
        ))
        .returning({ id: gameRooms.id });
      return { advanced: res.length > 0, currentRound: room.currentRound + 1 };
    }),
});
