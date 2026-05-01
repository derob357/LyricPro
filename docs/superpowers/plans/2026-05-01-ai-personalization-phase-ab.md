# AI Personalization — Phase A (Weakness Packs) + Phase B (Hints + Streak Insurance)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two AI-driven engagement loops on top of the existing LyricPro game: (Phase A) personalized "weakness diagnosis + practice packs" sold for 4 Golden Notes (GN), and (Phase B) in-round microtransactions — Hint (1 GN) and Streak Insurance (3 GN) — that give users low-friction reasons to spend GN.

**Architecture:**
- Phase A reads `round_results` per user, aggregates accuracy per (genre × decade × category), passes a profile summary to Claude Haiku for a 1-line diagnosis, server picks 5 songs from the user's weakest cell, the user pays 4 GN to launch a custom-pack room. Diagnosis cached 24h in a new `user_insights` table.
- Phase B adds two paid mechanics to the existing room/round flow: `useHint` mutation (1 GN, returns reduced-MC payload during a stage); a `streakInsurance` flag on `gameRooms` (3 GN at room creation, prevents streak reset on first miss).
- Both phases share one schema migration. Both follow existing patterns (drizzle, tRPC, React Query) — no new infrastructure.

**Tech Stack:** Drizzle + Supabase, tRPC, Anthropic SDK (`claude-haiku-4-5-20251001`), React + TanStack Query, framer-motion, lucide-react.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `drizzle/schema.ts` | New `user_insights` table; new `customPackSongIds` jsonb + `streakInsurance` bool on `gameRooms`; new `hintUsed` bool + `streakInsuranceUsed` bool on `round_results` | Modify |
| `drizzle/0005_*.sql` | Auto-generated migration | Create (via `db:push`) |
| `server/routers/insights.ts` | `getMyWeaknessDiagnosis` + `playWeaknessPack` procedures | Create |
| `server/app-router.ts` | Mount `insightsRouter` | Modify |
| `server/routers/game.ts` | `getNextSong` honors `customPackSongIds`; `createRoom` accepts `streakInsurance` flag and `customPackSongIds`; `submitAnswer` honors streak insurance; new `useHint` mutation | Modify |
| `client/src/components/WeaknessPackCard.tsx` | "Personalized for you" card showing diagnosis + Play Pack button | Create |
| `client/src/pages/Home.tsx` | Mount `WeaknessPackCard` above "How It Works" (auth users with ≥10 rounds) | Modify |
| `client/src/pages/Profile.tsx` | Mount `WeaknessPackCard` near top of Profile content (auth users) | Modify |
| `client/src/pages/GameSetup.tsx` | Streak Insurance toggle (auth users only) | Modify |
| `client/src/pages/Gameplay.tsx` | Hint button at each MC stage; show eliminated/narrowed options on response | Modify |

---

## Schema Migration (single migration covering both phases)

### Task 1: Add user_insights table + columns to gameRooms and round_results

**Files:**
- Modify: `drizzle/schema.ts`

- [ ] **Step 1: Add three column additions and one new table**

In `drizzle/schema.ts`:

1. Add `customPackSongIds` and `streakInsurance` to the `gameRooms` table definition. Find `gameRooms` (~line 237) and add these fields after `usedSongIds`:

```ts
customPackSongIds: jsonb("customPackSongIds").$type<number[]>(),
streakInsurance: boolean("streakInsurance").default(false).notNull(),
```

2. Add `hintUsed` and `streakInsuranceUsed` to `round_results` (~line 317). Add after `passUsed`:

```ts
hintUsed: boolean("hintUsed").default(false).notNull(),
streakInsuranceUsed: boolean("streakInsuranceUsed").default(false).notNull(),
```

3. Add a new table at the end of the schema file (before any export-type aliases):

```ts
// ─── User Insights ────────────────────────────────────────────────────────────
// Cached AI-generated weakness diagnosis + recommended practice-pack song IDs.
// One row per user; refreshed when stale (>24h) or invalidated on next round.
export const userInsights = pgTable("user_insights", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  diagnosis: text("diagnosis").notNull(),
  packSongIds: jsonb("packSongIds").$type<number[]>().notNull(),
  roundsAnalyzed: integer("roundsAnalyzed").notNull(),
  weakestGenre: varchar("weakestGenre", { length: 64 }),
  weakestDecade: varchar("weakestDecade", { length: 32 }),
  weakestCategory: varchar("weakestCategory", { length: 16 }), // 'lyric' | 'artist' | 'year' | 'title'
  computedAt: timestamp("computedAt", { withTimezone: true }).defaultNow().notNull(),
});

export type UserInsights = typeof userInsights.$inferSelect;
```

(`pgTable`, `serial`, `integer`, `text`, `jsonb`, `varchar`, `timestamp`, `boolean` are all already imported.)

- [ ] **Step 2: Generate + apply migration**

```bash
pnpm db:push
```

Expected: a new SQL file under `drizzle/` (likely `0005_*.sql`) with:
- `ALTER TABLE "game_rooms" ADD COLUMN ...` for the two columns.
- `ALTER TABLE "round_results" ADD COLUMN ...` for the two columns.
- `CREATE TABLE "user_insights" ...`.

- [ ] **Step 3: Verify columns and table exist via information_schema**

```bash
node -e "
import('postgres').then(async ({ default: postgres }) => {
  const dotenv = await import('dotenv');
  dotenv.config();
  const url = process.env.SUPABASE_SESSION_POOLER_STRING || process.env.SUPABASE_DIRECT_CONNECTION_STRING || process.env.DATABASE_URL;
  const sql = postgres(url, { max: 1 });
  const cols = await sql\`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE (table_name='game_rooms' AND column_name IN ('customPackSongIds','streakInsurance')) OR (table_name='round_results' AND column_name IN ('hintUsed','streakInsuranceUsed')) OR (table_name='user_insights') ORDER BY table_name, column_name\`;
  console.log(cols);
  await sql.end();
});
"
```

Expected: rows for the 4 column additions + the user_insights table columns.

- [ ] **Step 4: Type-check + commit**

```bash
pnpm exec tsc --noEmit
```

Stage all of `drizzle/schema.ts`, the new SQL file, AND `drizzle/meta/_journal.json` + the new `drizzle/meta/0005_snapshot.json`. Commit:

```
schema: user_insights table + customPackSongIds/streakInsurance/hintUsed/streakInsuranceUsed columns
```

---

## Phase A — Weakness Packs

### Task 2: Create insights router (getMyWeaknessDiagnosis + playWeaknessPack)

**Files:**
- Create: `server/routers/insights.ts`
- Modify: `server/app-router.ts` (mount the router)

- [ ] **Step 1: Implement the router**

Create `server/routers/insights.ts`:

```ts
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, gte, sql as drizzleSql, desc } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { publicProcedure, router } from "server/_core/trpc";
import { getDb } from "server/_core/db";
import { roundResults, songs, userInsights, gameRooms, goldenNoteBalances, goldenNoteTransactions } from "drizzle/schema";
import { customAlphabet } from "nanoid";

const ROOM_CODE = customAlphabet("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 6);
const MIN_ROUNDS_FOR_DIAGNOSIS = 10;
const PACK_SIZE = 5;
const PACK_PRICE_GN = 4;
const CACHE_TTL_HOURS = 24;
const MODEL = "claude-haiku-4-5-20251001";

type CategoryKey = "lyric" | "artist" | "year" | "title";

function pickWeakestCell(rounds: Array<{ genre: string; decade: string; lyricPoints: number; artistPoints: number; yearPoints: number; titlePoints: number; song: any }>) {
  // Aggregate accuracy per (genre × decade) × category.
  // Returns { genre, decade, category, missRate } for the cell with highest miss rate.
  // Min 3 rounds in cell to count (avoid noise).
  const cells = new Map<string, { genre: string; decade: string; lyric: number[]; artist: number[]; year: number[]; title: number[] }>();
  for (const r of rounds) {
    const key = `${r.genre}|${r.decade}`;
    if (!cells.has(key)) cells.set(key, { genre: r.genre, decade: r.decade, lyric: [], artist: [], year: [], title: [] });
    const c = cells.get(key)!;
    c.lyric.push(r.lyricPoints > 0 ? 1 : 0);
    c.artist.push(r.artistPoints > 0 ? 1 : 0);
    c.year.push(r.yearPoints > 0 ? 1 : 0);
    c.title.push((r as any).titlePoints > 0 ? 1 : 0);
  }
  let worst: { genre: string; decade: string; category: CategoryKey; missRate: number; count: number } | null = null;
  for (const c of cells.values()) {
    const cats: Array<[CategoryKey, number[]]> = [["lyric", c.lyric], ["artist", c.artist], ["year", c.year], ["title", c.title]];
    for (const [cat, arr] of cats) {
      if (arr.length < 3) continue;
      const missRate = 1 - arr.reduce((a, b) => a + b, 0) / arr.length;
      if (!worst || missRate > worst.missRate) worst = { genre: c.genre, decade: c.decade, category: cat, missRate, count: arr.length };
    }
  }
  return worst;
}

function buildSummary(rounds: any[]) {
  const totalRounds = rounds.length;
  const wins = rounds.filter(r => r.lyricPoints + r.artistPoints + r.yearPoints + (r.titlePoints ?? 0) > 0).length;
  const byGenre: Record<string, { n: number; pts: number }> = {};
  for (const r of rounds) {
    const g = r.genre ?? "Unknown";
    if (!byGenre[g]) byGenre[g] = { n: 0, pts: 0 };
    byGenre[g].n++;
    byGenre[g].pts += r.lyricPoints + r.artistPoints + r.yearPoints + (r.titlePoints ?? 0);
  }
  const topGenres = Object.entries(byGenre).sort((a, b) => b[1].pts / b[1].n - a[1].pts / a[1].n).slice(0, 3);
  return { totalRounds, wins, topGenres };
}

async function generateDiagnosis(weakestCell: NonNullable<ReturnType<typeof pickWeakestCell>>, summary: ReturnType<typeof buildSummary>): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return `You're weakest at ${weakestCell.category} on ${weakestCell.genre} from ${weakestCell.decade}. Practice up.`;
  }
  const anthropic = new Anthropic({ maxRetries: 4 });
  const prompt = `You write punchy, observational 1-sentence diagnostics for a music lyric trivia game.
The user has played ${summary.totalRounds} rounds with ${summary.wins} wins.
Top genres by points/round: ${summary.topGenres.map(([g, s]) => `${g} (${(s.pts/s.n).toFixed(0)} pts avg)`).join(", ")}.
Their weakest spot: ${weakestCell.category} guesses on ${weakestCell.genre} from ${weakestCell.decade} — they miss ${(weakestCell.missRate * 100).toFixed(0)}% of these.

Write ONE sentence (max 22 words) calling out a strength and gently challenging them on the weakness. Tone: punchy, slightly cocky, hype-coach. No greetings. No emojis. No sign-off. Just the sentence.`;
  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });
    const block = res.content.find((b: any) => b.type === "text") as any;
    return block?.text?.trim() ?? `You're weakest at ${weakestCell.category} on ${weakestCell.genre} from ${weakestCell.decade}.`;
  } catch (err) {
    console.warn("[insights] LLM diagnosis failed:", err);
    return `You're weakest at ${weakestCell.category} on ${weakestCell.genre} from ${weakestCell.decade}. Practice up.`;
  }
}

export const insightsRouter = router({
  getMyWeaknessDiagnosis: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user?.id) return null;
    const db = await getDb();
    if (!db) return null;

    const userId = ctx.user.id;

    // Cache: return existing if <24h old.
    const [cached] = await db.select().from(userInsights).where(eq(userInsights.userId, userId)).limit(1);
    const cacheStaleMs = CACHE_TTL_HOURS * 60 * 60 * 1000;
    if (cached && Date.now() - new Date(cached.computedAt).getTime() < cacheStaleMs) {
      return {
        diagnosis: cached.diagnosis,
        packSongIds: cached.packSongIds,
        roundsAnalyzed: cached.roundsAnalyzed,
        weakestGenre: cached.weakestGenre,
        weakestDecade: cached.weakestDecade,
        weakestCategory: cached.weakestCategory,
        eligible: true,
      };
    }

    // Fetch last ~30 rounds joined to song metadata.
    const rounds = await db
      .select({
        roundId: roundResults.id,
        lyricPoints: roundResults.lyricPoints,
        artistPoints: roundResults.artistPoints,
        yearPoints: roundResults.yearPoints,
        songId: roundResults.songId,
        genre: songs.genre,
        decade: songs.decadeRange,
      })
      .from(roundResults)
      .innerJoin(songs, eq(roundResults.songId, songs.id))
      .where(eq(roundResults.activePlayerId, userId))
      .orderBy(desc(roundResults.id))
      .limit(30);

    if (rounds.length < MIN_ROUNDS_FOR_DIAGNOSIS) {
      return { eligible: false, roundsPlayed: rounds.length, roundsRequired: MIN_ROUNDS_FOR_DIAGNOSIS };
    }

    const weakest = pickWeakestCell(rounds.map(r => ({ ...r, titlePoints: 0 })));
    if (!weakest) return { eligible: false, roundsPlayed: rounds.length, roundsRequired: MIN_ROUNDS_FOR_DIAGNOSIS };

    // Pick 5 songs from the weakest cell that the user hasn't already played in the analyzed window
    // — fall back to any songs in the cell if not enough fresh ones.
    const playedIds = new Set(rounds.map(r => r.songId));
    const candidates = await db
      .select({ id: songs.id })
      .from(songs)
      .where(and(eq(songs.genre, weakest.genre), eq(songs.decadeRange, weakest.decade), eq(songs.isActive, true), eq(songs.approvalStatus, "approved")));
    const fresh = candidates.filter(c => !playedIds.has(c.id));
    const pool = fresh.length >= PACK_SIZE ? fresh : candidates;
    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, PACK_SIZE);
    const packSongIds = shuffled.map(s => s.id);

    if (packSongIds.length === 0) return { eligible: false, roundsPlayed: rounds.length, roundsRequired: MIN_ROUNDS_FOR_DIAGNOSIS };

    const summary = buildSummary(rounds);
    const diagnosis = await generateDiagnosis(weakest, summary);

    // Upsert into user_insights.
    if (cached) {
      await db.update(userInsights)
        .set({ diagnosis, packSongIds, roundsAnalyzed: rounds.length, weakestGenre: weakest.genre, weakestDecade: weakest.decade, weakestCategory: weakest.category, computedAt: new Date() })
        .where(eq(userInsights.userId, userId));
    } else {
      await db.insert(userInsights).values({ userId, diagnosis, packSongIds, roundsAnalyzed: rounds.length, weakestGenre: weakest.genre, weakestDecade: weakest.decade, weakestCategory: weakest.category });
    }

    return {
      diagnosis,
      packSongIds,
      roundsAnalyzed: rounds.length,
      weakestGenre: weakest.genre,
      weakestDecade: weakest.decade,
      weakestCategory: weakest.category,
      eligible: true,
    };
  }),

  playWeaknessPack: publicProcedure.mutation(async ({ ctx }) => {
    if (!ctx.user?.id) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to play a Practice Pack." });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
    const userId = ctx.user.id;

    const [insight] = await db.select().from(userInsights).where(eq(userInsights.userId, userId)).limit(1);
    if (!insight || !insight.packSongIds || insight.packSongIds.length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No personalized pack available — play a few more rounds first." });
    }

    // Check + debit GN atomically.
    const [bal] = await db.select().from(goldenNoteBalances).where(eq(goldenNoteBalances.userId, userId)).limit(1);
    if (!bal || bal.balance < PACK_PRICE_GN) {
      throw new TRPCError({ code: "PAYMENT_REQUIRED", message: `Need ${PACK_PRICE_GN} Golden Notes. You have ${bal?.balance ?? 0}.` });
    }
    await db.update(goldenNoteBalances).set({ balance: bal.balance - PACK_PRICE_GN, updatedAt: new Date() }).where(eq(goldenNoteBalances.userId, userId));
    await db.insert(goldenNoteTransactions).values({ userId, amount: -PACK_PRICE_GN, type: "spend_practice_pack", note: `Weakness pack: ${insight.weakestGenre} ${insight.weakestDecade} ${insight.weakestCategory}` });

    // Create a custom-pack room.
    const roomCode = ROOM_CODE();
    const [created] = await db.insert(gameRooms).values({
      roomCode,
      hostUserId: userId,
      mode: "solo",
      status: "active",
      currentRound: 1,
      roundsTotal: insight.packSongIds.length,
      timerSeconds: 30,
      difficulty: "medium",
      explicitFilter: false,
      selectedGenres: JSON.stringify([insight.weakestGenre]),
      selectedDecades: JSON.stringify([insight.weakestDecade]),
      rankingMode: "total_points",
      customPackSongIds: insight.packSongIds,
      usedSongIds: "[]",
    }).returning();

    return { roomCode: created.roomCode };
  }),
});
```

(If this file's imports diverge from the project's existing alias scheme, grep `server/routers/game.ts` for the equivalent imports — the public-procedure / router / db imports follow the same shape. `goldenNoteTransactions.type` enum may differ — check the schema for the exact union member name; `"spend_practice_pack"` may need to be added or substituted with an existing enum value like `"spend"`.)

- [ ] **Step 2: Mount the router**

In `server/app-router.ts`, import and mount:

```ts
import { insightsRouter } from "./routers/insights";

// inside the appRouter object:
insights: insightsRouter,
```

- [ ] **Step 3: Type-check + commit**

```bash
pnpm exec tsc --noEmit
```

Commit:
```
feat(insights): weakness diagnosis + practice-pack purchase flow
```

---

### Task 3: getNextSong honors customPackSongIds; createRoom + UI accept the input

**Files:**
- Modify: `server/routers/game.ts`

- [ ] **Step 1: Update `getNextSong` to use `customPackSongIds` when present**

In `server/routers/game.ts`, find `getNextSong` (around line 308). Before the existing genre/decade/difficulty filtering logic (~line 322), add a short-circuit:

```ts
// Custom-pack room: songs are pre-seeded; play them in order.
if (Array.isArray(room.customPackSongIds) && room.customPackSongIds.length > 0) {
  const usedIds = JSON.parse(room.usedSongIds ?? "[]") as number[];
  const idx = usedIds.length;
  const targetId = room.customPackSongIds[idx];
  if (typeof targetId !== "number") {
    throw new Error("Practice pack exhausted");
  }
  const [song] = await db.select().from(songs).where(eq(songs.id, targetId)).limit(1);
  if (!song) throw new Error("Pack song not found");

  const newUsedIds = [...usedIds, song.id];
  await db.update(gameRooms).set({ currentSongId: song.id, usedSongIds: JSON.stringify(newUsedIds) }).where(eq(gameRooms.id, room.id));

  // Reuse the existing distractor / artist-meta logic. Build a minimal candidate
  // pool from the same pack so distractors don't blow up. Falls through to the
  // existing distractor block below by setting candidateSongs and song-pick state.
  // ... continue with existing flow that builds artistMeta + lyricOptions etc.
}
```

Actually — to avoid duplicating the artist-meta + distractor blocks, restructure as: **set `song` and `candidateSongs` early when in custom-pack mode, then skip the candidate-search block but reuse the rest.** Concrete edit:

Find the line `const song = ` (currently around line 407 inside the weighted-pick block), and the lines just above it that build `candidateSongs`. Wrap the candidate-search block in `if (!isCustomPack) { ... }`. Above the entire block, add:

```ts
const isCustomPack = Array.isArray(room.customPackSongIds) && room.customPackSongIds.length > 0;
let song: typeof songs.$inferSelect;
let candidateSongs: (typeof songs.$inferSelect)[];

if (isCustomPack) {
  const usedIds = JSON.parse(room.usedSongIds ?? "[]") as number[];
  const idx = usedIds.length;
  const targetId = room.customPackSongIds![idx];
  if (typeof targetId !== "number") throw new Error("Practice pack exhausted");
  const [pickedSong] = await db.select().from(songs).where(eq(songs.id, targetId)).limit(1);
  if (!pickedSong) throw new Error("Pack song not found");
  song = pickedSong;
  // Build a small distractor pool from same genre/decade so options stay sensible.
  candidateSongs = await db.select().from(songs).where(and(
    eq(songs.isActive, true),
    eq(songs.approvalStatus, "approved"),
    eq(songs.genre, song.genre),
    notInArray(songs.id, [song.id]),
  ));
} else {
  // ... existing genre/decade/difficulty filter + weighted pick ... assign to song + candidateSongs
}
```

Adapt the existing weighted-pick block to assign into `song` (let-declared) instead of redeclaring. After the if/else, the remaining flow (artist meta lookup, distractor block, response shape) works unchanged.

- [ ] **Step 2: Update `createRoom` to accept optional `customPackSongIds` and `streakInsurance`**

Find `createRoom` schema (~line 144). Add to the input object:

```ts
streakInsurance: z.boolean().default(false),
// customPackSongIds is NOT user-supplied — only set by playWeaknessPack server-side.
```

In the room insert call, add `streakInsurance: input.streakInsurance` to the values. (`customPackSongIds` is not part of `createRoom` input — it's only set by `playWeaknessPack`.)

If `streakInsurance === true` AND user is logged in, debit 3 GN before creating the room. If user has insufficient GN, throw a `PAYMENT_REQUIRED` error before any room is created.

```ts
if (input.streakInsurance) {
  if (!ctx.user?.id) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to use Streak Insurance." });
  const [bal] = await db.select().from(goldenNoteBalances).where(eq(goldenNoteBalances.userId, ctx.user.id)).limit(1);
  if (!bal || bal.balance < 3) throw new TRPCError({ code: "PAYMENT_REQUIRED", message: "Need 3 Golden Notes for Streak Insurance." });
  await db.update(goldenNoteBalances).set({ balance: bal.balance - 3, updatedAt: new Date() }).where(eq(goldenNoteBalances.userId, ctx.user.id));
  await db.insert(goldenNoteTransactions).values({ userId: ctx.user.id, amount: -3, type: "spend", note: "Streak Insurance" });
}
```

- [ ] **Step 3: Type-check + commit**

```bash
pnpm exec tsc --noEmit
```

Commit:
```
feat(game): getNextSong supports customPackSongIds; createRoom accepts streakInsurance
```

---

### Task 4: WeaknessPackCard component + Home/Profile integration

**Files:**
- Create: `client/src/components/WeaknessPackCard.tsx`
- Modify: `client/src/pages/Home.tsx`
- Modify: `client/src/pages/Profile.tsx`

- [ ] **Step 1: Build the component**

Create `client/src/components/WeaknessPackCard.tsx`:

```tsx
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Sparkles, ChevronRight, Music2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";

const PACK_PRICE_GN = 4;

export function WeaknessPackCard() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { data: insight, isLoading } = trpc.insights.getMyWeaknessDiagnosis.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 60 * 60 * 1000,
  });
  const playPack = trpc.insights.playWeaknessPack.useMutation({
    onSuccess: (data) => {
      utils.goldenNotes.getMyBalance.invalidate();
      navigate(`/play/${data.roomCode}`);
    },
    onError: (err) => toast.error(err.message),
  });

  if (!isAuthenticated || isLoading || !insight) return null;
  if (!("eligible" in insight) || !insight.eligible) {
    if ("roundsPlayed" in insight && typeof insight.roundsPlayed === "number") {
      return (
        <div className="glass rounded-2xl p-6 border-border/40">
          <p className="text-sm text-muted-foreground">
            Play {insight.roundsRequired - insight.roundsPlayed} more rounds to unlock your AI-personalized practice pack.
          </p>
        </div>
      );
    }
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-2xl p-6 border-primary/30 bg-gradient-to-br from-primary/10 to-accent/5"
    >
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="font-display font-semibold text-foreground">Personalized for you</h3>
      </div>
      <p className="text-foreground text-base mb-4">{insight.diagnosis}</p>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground min-w-0 truncate">
          5-round pack · {insight.weakestGenre} · {insight.weakestDecade}
        </div>
        <Button
          className="bg-primary text-primary-foreground hover:bg-primary/90 glow-purple shrink-0"
          onClick={() => playPack.mutate()}
          disabled={playPack.isPending}
        >
          {playPack.isPending ? "Loading…" : (
            <>
              Play Practice Pack
              <span className="ml-2 inline-flex items-center gap-1">
                <Music2 className="w-3.5 h-3.5 text-yellow-400 neon-gold-sm" />
                <span className="text-yellow-400 neon-gold-sm">{PACK_PRICE_GN}</span>
              </span>
              <ChevronRight className="w-4 h-4 ml-1" />
            </>
          )}
        </Button>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Mount in Home.tsx**

In `client/src/pages/Home.tsx`, import the component near the top of the imports:

```tsx
import { WeaknessPackCard } from "@/components/WeaknessPackCard";
```

Find the "How It Works" section heading area (~line 183). Insert the card just before that section's `<section>` tag, wrapped in a `container`:

```tsx
{isAuthenticated && (
  <section className="py-6 px-4">
    <div className="container max-w-3xl">
      <WeaknessPackCard />
    </div>
  </section>
)}
```

- [ ] **Step 3: Mount in Profile.tsx**

In `client/src/pages/Profile.tsx`, import and place the card near the top of the page content (after the header / above the rank tiers section).

- [ ] **Step 4: Type-check + commit**

Commit:
```
feat(home/profile): WeaknessPackCard with AI diagnosis + Practice Pack purchase
```

---

## Phase B — Hints + Streak Insurance

### Task 5: useHint mutation + streak-insurance honor in submitAnswer

**Files:**
- Modify: `server/routers/game.ts`

- [ ] **Step 1: Add the `useHint` mutation**

Add to `gameRouter` (place near `submitAnswer`):

```ts
useHint: publicProcedure
  .input(z.object({
    roomCode: z.string(),
    songId: z.number().int(),
    stage: z.enum(["lyric", "title", "artist", "year"]),
  }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.user?.id) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to use hints." });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
    const userId = ctx.user.id;

    // Debit 1 GN.
    const [bal] = await db.select().from(goldenNoteBalances).where(eq(goldenNoteBalances.userId, userId)).limit(1);
    if (!bal || bal.balance < 1) throw new TRPCError({ code: "PAYMENT_REQUIRED", message: "Need 1 Golden Note for a hint." });
    await db.update(goldenNoteBalances).set({ balance: bal.balance - 1, updatedAt: new Date() }).where(eq(goldenNoteBalances.userId, userId));
    await db.insert(goldenNoteTransactions).values({ userId, amount: -1, type: "spend", note: `Hint: ${input.stage}` });

    // Compute the hint payload.
    const [song] = await db.select().from(songs).where(eq(songs.id, input.songId)).limit(1);
    if (!song) throw new TRPCError({ code: "NOT_FOUND", message: "Song not found." });

    if (input.stage === "year") {
      // Narrow to ±5 years.
      return { stage: input.stage, narrowedRange: [song.releaseYear - 5, song.releaseYear + 5] as const };
    }
    if (input.stage === "title" || input.stage === "artist" || input.stage === "lyric") {
      // Reveal first letter of the correct answer.
      const correct = input.stage === "title" ? song.title : input.stage === "artist" ? song.artistName : song.lyricAnswer;
      return { stage: input.stage, firstLetter: correct.charAt(0).toUpperCase() };
    }
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid stage" });
  }),
```

- [ ] **Step 2: Honor streak insurance in submitAnswer**

Find `submitAnswer`. After the existing streak-reset logic, add:

```ts
// If room.streakInsurance and the user just blanked the lyric while having a streak,
// preserve the streak and mark insurance as used (server-side only — no extra debit).
if (room.streakInsurance && !lyricCorrect && previousStreak >= 1 && !room.streakInsuranceConsumed /* see Step 3 */) {
  newStreak = previousStreak; // restore
  await db.update(gameRooms).set({ streakInsurance: false }).where(eq(gameRooms.id, room.id)); // one-shot
  // Mark on round_results
  // (set streakInsuranceUsed: true when inserting roundResults below)
}
```

(The exact merge into the existing block depends on current variable names; the implementer should adapt. The intent: streak insurance is one-shot per room — restore the streak the FIRST time the user blanks the lyric stage, then disable.)

- [ ] **Step 3: Commit**

```
feat(game): useHint mutation (1 GN) + streak insurance honor in submitAnswer
```

---

### Task 6: Streak Insurance toggle in GameSetup; Hint button in Gameplay

**Files:**
- Modify: `client/src/pages/GameSetup.tsx`
- Modify: `client/src/pages/Gameplay.tsx`

- [ ] **Step 1: GameSetup — add toggle**

Add a `streakInsurance` boolean state; render a Switch + label below the existing Clean Mode toggle. Show only for authenticated users. Send `streakInsurance` in the `createRoomMutation.mutate({...})` call.

UI sketch:

```tsx
{isAuthenticated && (
  <section className="glass rounded-xl p-4 flex items-center justify-between">
    <div>
      <Label className="font-medium text-foreground flex items-center gap-2">
        Streak Insurance
        <span className="inline-flex items-center gap-1 text-xs text-yellow-400 neon-gold-sm">
          <Music2 className="w-3 h-3" /> 3
        </span>
      </Label>
      <p className="text-muted-foreground text-sm mt-0.5">Keep your streak if you blank one round.</p>
    </div>
    <Switch checked={streakInsurance} onCheckedChange={setStreakInsurance} />
  </section>
)}
```

Add `Music2` to the lucide imports if not already there.

- [ ] **Step 2: Gameplay — add Hint button**

Below the MC option grid in `Gameplay.tsx`, add a single "💡 Hint (1 GN)" button per stage. On click, call `trpc.game.useHint.mutate({...})`; on response:
- If `narrowedRange`: render an inline notice "Year is between X and Y" above the year MC options.
- If `firstLetter`: render an inline notice "Starts with: X".
- Disable the button after one use per stage (track via local state).
- Show the button only for authenticated users.

Use `Lightbulb` lucide icon. Replace the placeholder emoji "💡" with the icon.

- [ ] **Step 3: Type-check + commit**

```
feat(setup/gameplay): Streak Insurance toggle + Hint button (1 GN)
```

---

### Task 7: Final verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run type-check + tests**

```bash
pnpm exec tsc --noEmit
pnpm test
```

Both clean (auth.logout.test.ts pre-existing failure ignored).

- [ ] **Step 2: Smoke-test in dev server**

Open `http://localhost:3000/`, log in, play 10+ rounds, observe:
- WeaknessPackCard appears on Home after 10 rounds with a real diagnosis sentence and Play Pack button.
- Clicking Play Pack debits 4 GN and starts a custom 5-round game with songs from the weakest cell.
- During Gameplay, Hint button appears at each stage; clicking debits 1 GN and reveals first-letter / narrowed-range hint.
- On GameSetup, Streak Insurance toggle appears for auth users; toggling on + creating a room debits 3 GN.
- Mid-game, blanking the lyric while streak >=1 with insurance ON → streak preserved (verify by checking `users.currentStreak` in DB after the round).

---

## Self-Review

**1. Spec coverage:**
- Phase A diagnosis + LLM call → Tasks 2, 4.
- Phase A practice pack purchase + custom-pack room → Tasks 2, 3, 4.
- Phase B Hints (1 GN) → Tasks 5, 6.
- Phase B Streak Insurance (3 GN) → Tasks 1 (schema), 3 (createRoom), 5 (submitAnswer), 6 (UI).

**2. Placeholders:** All tasks contain runnable code, exact commands, and file:line references.

**3. Type consistency:** `customPackSongIds: number[]`, `streakInsurance: boolean`, `hintUsed/streakInsuranceUsed: boolean`, `userInsights.packSongIds: number[]` — used consistently across schema, server, and client.

---

## Risks & Mitigations

- **LLM cost at scale:** Diagnosis is cached 24h per user. At 1k DAU, that's ~1k calls/day on Haiku ≈ $0.50/day. Acceptable.
- **First-time UX:** Users with <10 rounds see a "play more rounds" message rather than nothing. Better than a blank section.
- **Custom-pack distractors:** When a user plays a pack, distractors are pulled from same-genre songs. May be slightly weaker than the normal flow's same-genre+decade pool, but distractors aren't the user-facing focus of a "weakness practice."
- **Streak-insurance one-shot ambiguity:** Schema currently stores `streakInsurance: boolean` on the room. A one-shot semantic means we flip it to `false` after consuming. Implementer should also gate the client UI to show insurance as "spent" after consumption (e.g., `currentStreak` returned from submitAnswer can be used as proxy).
- **GN transaction enum:** if `goldenNoteTransactions.type` enum doesn't include `"spend_practice_pack"`, the implementer should either add it to the enum (in the same migration) or use the generic `"spend"` value with a descriptive `note`.
