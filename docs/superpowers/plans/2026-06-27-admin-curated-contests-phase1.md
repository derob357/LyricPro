# Admin Curated Contests (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin build reusable hand-picked song sets (with optional per-song lyric overrides) and launch a multiplayer contest room from one, returning a shareable room code.

**Architecture:** A new `curatedSongSets` table holds ordered `{songId, variantIndex}` items. A shared `selectCustomPackSong` helper serves a room's `customPackSongIds` in order (distractors drawn from the broader same-genre catalog, not the set). The multiplayer match engine (`startMatch`/`advanceRound`) branches to this helper when a room has a custom pack. A new admin-gated `adminCuratedSets` tRPC router does CRUD + `launch` (creates a multiplayer room from a set). Three new admin client pages provide the set builder + launch.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres/Supabase), tRPC, Vitest, React + wouter + @tanstack/react-query, Tailwind, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-06-27-admin-curated-contests-phase1-design.md`

**Design decisions locked in spec:**
- **(a)** Distractors come from the broader same-genre catalog, never just the set (so an all-one-artist set doesn't make "name the artist" trivial).
- **(b)** In pack mode, no difficulty *song/section* filtering — serve exactly the admin's songs; difficulty only affects scoring + MC options.
- Reorder uses **move up/down buttons** (no new drag-and-drop dependency — YAGNI).

---

## Task 1: Schema — `curatedSongSets` table + `gameRooms.customPackVariants`

**Files:**
- Modify: `drizzle/schema.ts`
- Generate: a new `drizzle/NNNN_*.sql` migration (auto-named)

- [ ] **Step 1: Add the enum + table to `drizzle/schema.ts`**

Place near the other content tables (after the `songs`/`gameRooms` definitions). The `pgEnum`, `serial`, `varchar`, `text`, `jsonb`, `integer`, `createdAtColumn`, `updatedAtColumn` helpers already exist in this file.

```typescript
// ─── Curated Song Sets (admin-built contest packs) ──────────────────────────
export const curatedSetStatusEnum = pgEnum("curated_set_status", ["active", "draft"]);

export const curatedSongSets = pgTable("curated_song_sets", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  // Ordered list. variantIndex null => use the song's default lyric (variant 0);
  // a number => force that index into songs.lyricVariants.
  items: jsonb("items")
    .$type<Array<{ songId: number; variantIndex: number | null }>>()
    .default([])
    .notNull(),
  status: curatedSetStatusEnum("status").default("active").notNull(),
  createdBy: integer("created_by").notNull(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export type CuratedSongSet = typeof curatedSongSets.$inferSelect;
export type InsertCuratedSongSet = typeof curatedSongSets.$inferInsert;
```

- [ ] **Step 2: Add `customPackVariants` to the `gameRooms` table**

Inside the existing `gameRooms = pgTable("game_rooms", {...})` object, immediately after the `customPackSongIds` line (`drizzle/schema.ts:500`):

```typescript
  // Per-song lyric overrides aligned by index with customPackSongIds. A null
  // entry => engine picks the variant normally (variant 0); a number => forced
  // variant index. Set by curated-contest launch.
  customPackVariants: jsonb("customPackVariants").$type<Array<number | null>>(),
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm exec drizzle-kit generate`
Expected: a new file `drizzle/NNNN_<auto-name>.sql` is created containing `CREATE TYPE "curated_set_status"`, `CREATE TABLE "curated_song_sets"`, and `ALTER TABLE "game_rooms" ADD COLUMN "customPackVariants" jsonb;`. Open it and confirm those three statements are present.

- [ ] **Step 4: Typecheck**

Run: `pnpm check`
Expected: PASS (no TS errors). This confirms the new types compile.

- [ ] **Step 5: Commit**

```bash
git add drizzle/schema.ts drizzle/
git commit -m "feat(schema): curatedSongSets table + gameRooms.customPackVariants"
```

> **Migration apply note:** `pnpm db:push` runs generate + migrate against the DB. Applying to the shared DB is an ops step the engineer should do deliberately (it touches prod). For local test runs the live-DB tests below require the migration to be applied first.

---

## Task 2: Shared pack-selection helper `selectCustomPackSong`

**Files:**
- Create: `server/_core/customPack.ts`
- Test: `server/customPack.test.ts`

This isolates "given a room's pack + usedSongIds, return the next song, its broader-catalog distractor pool, and the forced variant index (or null)". Pure DB reads, no writes.

- [ ] **Step 1: Write the failing test**

```typescript
// server/customPack.test.ts
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
      // awaited directly (candidate pool query) OR followed by .limit()
      const p: any = Promise.resolve(nextResult());
      p.limit = () => Promise.resolve(nextResult());
      return p;
    },
  };
  return chain;
}

const SONG = { id: 7, genre: "R&B", isActive: true, approvalStatus: "approved" };
const POOL = [{ id: 8 }, { id: 9 }, { id: 10 }];

describe("selectCustomPackSong", () => {
  it("serves the song at index = usedSongIds.length", async () => {
    const db = makeFakeDb([[SONG], POOL]); // 1st query: song; 2nd: candidate pool
    const pick = await selectCustomPackSong(db as never, {
      customPackSongIds: [5, 7, 9],
      customPackVariants: null,
      usedSongIds: [5], // index 1 -> songId 7
    });
    expect(pick).not.toBeNull();
    expect(pick!.song.id).toBe(7);
    // candidateSongs includes the picked song (buildMatchQuestion requires it)
    expect(pick!.candidateSongs.some((s: any) => s.id === 7)).toBe(true);
    expect(pick!.variantIndex).toBeNull();
  });

  it("returns null when the pack is exhausted", async () => {
    const db = makeFakeDb([]);
    const pick = await selectCustomPackSong(db as never, {
      customPackSongIds: [5, 7],
      customPackVariants: null,
      usedSongIds: [5, 7], // index 2 >= length 2
    });
    expect(pick).toBeNull();
  });

  it("passes through a valid variant override", async () => {
    const db = makeFakeDb([[SONG], POOL]);
    const pick = await selectCustomPackSong(db as never, {
      customPackSongIds: [7],
      customPackVariants: [2],
      usedSongIds: [],
    });
    expect(pick!.variantIndex).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/customPack.test.ts`
Expected: FAIL with "Cannot find module './_core/customPack'".

- [ ] **Step 3: Write the implementation**

```typescript
// server/_core/customPack.ts
import { and, eq, ne } from "drizzle-orm";
import { songs } from "../../drizzle/schema";
import type { getDb } from "../db";
import type { SongRow } from "./songSelection";

export interface CustomPackPick {
  /** The song to serve this round. */
  song: SongRow;
  /** Broader same-genre distractor pool (active+approved), INCLUDING the picked
   *  song — buildMatchQuestion expects the picked song to be present and excludes
   *  it internally. Decision (a): pool is the catalog, not the set. */
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
  if (index >= customPackSongIds.length) return null; // pack exhausted

  const nextSongId = customPackSongIds[index];
  if (nextSongId === undefined) return null;

  const [song] = await db.select().from(songs).where(eq(songs.id, nextSongId)).limit(1);
  if (!song) return null; // stale id — treat as exhausted; caller ends gracefully

  // Decision (a): same-genre catalog pool (not the set), excluding the answer.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run server/customPack.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/_core/customPack.ts server/customPack.test.ts
git commit -m "feat(engine): selectCustomPackSong helper (pack order + broader-catalog distractors)"
```

---

## Task 3: Multiplayer `startMatch` honors custom packs

**Files:**
- Modify: `server/routers/matchEngine.ts` (the `startMatch` mutation, ~lines 73-114)
- Test: `server/matchEngine.customPack.test.ts`

`startMatch` currently always calls `selectSongForRoom`. Add a branch: when the room has a non-empty `customPackSongIds`, use `selectCustomPackSong` + the chosen variant instead.

- [ ] **Step 1: Add the import**

At the top of `server/routers/matchEngine.ts`, alongside the existing imports:

```typescript
import { selectCustomPackSong } from "../_core/customPack";
```

- [ ] **Step 2: Replace the song-pick block in `startMatch`**

Replace the existing block from `const used: number[] = ...` through the `const question: MatchQuestion = buildMatchQuestion({...});` (currently `matchEngine.ts:84-102`) with this pack-aware version. The surrounding lines (room load, `assertCanStart`, the `db.update(...).set({...currentQuestion: question})` write, and the return) stay exactly as they are.

```typescript
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

    const question: MatchQuestion = buildMatchQuestion({
      song: pickedSong,
      variant: pickedVariant,
      candidateSongs,
      difficulty: room.difficulty as "low" | "medium" | "high",
    });
```

In the subsequent `db.update(gameRooms).set({...})`, the existing lines `currentSongId: pick.songId` and `usedSongIds: JSON.stringify([...used, pick.songId])` must become `currentSongId: songId` and `usedSongIds: JSON.stringify([...used, songId])` (since `pick` no longer exists in this scope).

- [ ] **Step 3: Write the test**

```typescript
// server/matchEngine.customPack.test.ts
import { describe, it, expect, vi } from "vitest";
vi.mock("stripe", () => ({ default: vi.fn().mockImplementation(() => ({ checkout: { sessions: { create: vi.fn() } }, webhooks: { constructEvent: vi.fn() }, subscriptions: { retrieve: vi.fn() }, customers: { search: vi.fn().mockResolvedValue({ data: [] }) } })) }));

import { appRouter } from "./app-router";
import { getDb } from "./db";
import { gameRooms, roomPlayers, songs } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const DB_URL = process.env.SUPABASE_SESSION_POOLER_STRING ?? process.env.SUPABASE_DIRECT_CONNECTION_STRING ?? process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

function adminCaller() {
  return appRouter.createCaller({
    user: { id: 1, role: "admin", email: "admin@test" } as any,
    req: {} as any, res: {} as any, ip: undefined, userAgent: undefined,
    requestId: `vitest-cp-${Date.now()}`, countryCode: "US",
  });
}

liveDescribe("matchEngine custom pack", () => {
  it("startMatch serves the first pack song and uses a catalog distractor pool", async () => {
    const db = (await getDb())!;
    // Pick two real active songs of DIFFERENT artists to seed the pack.
    const seed = await db.select().from(songs).where(eq(songs.isActive, true)).limit(5);
    if (seed.length < 2) return; // empty DB — skip
    const packIds = [seed[0].id, seed[1].id];

    const code = `CP${Date.now().toString().slice(-6)}`;
    const [room] = await db.insert(gameRooms).values({
      roomCode: code, hostUserId: 1, mode: "multiplayer",
      selectedGenres: "[]", selectedDecades: "[]", difficulty: "medium",
      roundsTotal: packIds.length, status: "waiting", usedSongIds: "[]",
      customPackSongIds: packIds, customPackVariants: null,
    }).returning();
    await db.insert(roomPlayers).values({ roomId: room.id, userId: 1, joinOrder: 0, isReady: true, isActive: true });

    const res = await adminCaller().matchEngine.startMatch({ roomCode: code });
    expect(res.currentRound).toBe(1);

    const [after] = await db.select().from(gameRooms).where(eq(gameRooms.id, room.id)).limit(1);
    expect(after.currentSongId).toBe(packIds[0]); // first pack song, in order
    const q = after.currentQuestion as any;
    expect(q.songId).toBe(packIds[0]);
    expect(q.artistOptions.length).toBe(4); // distractors found from the catalog

    // cleanup
    await db.delete(roomPlayers).where(eq(roomPlayers.roomId, room.id));
    await db.delete(gameRooms).where(eq(gameRooms.id, room.id));
  });
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run server/matchEngine.customPack.test.ts`
Expected: PASS (or SKIP if no DB configured locally — then rely on CI/staging DB).

- [ ] **Step 5: Run the existing match-engine tests to confirm no regression**

Run: `pnpm exec vitest run server/matchEngine.start.test.ts`
Expected: PASS (standard branch unchanged).

- [ ] **Step 6: Commit**

```bash
git add server/routers/matchEngine.ts server/matchEngine.customPack.test.ts
git commit -m "feat(engine): multiplayer startMatch serves curated custom packs"
```

---

## Task 4: Multiplayer `advanceRound` honors custom packs + graceful exhaustion

**Files:**
- Modify: `server/routers/matchEngine.ts` (the `advanceRound` mutation, ~lines 349-424)
- Test: extend `server/matchEngine.customPack.test.ts`

`advanceRound` has the same `selectSongForRoom` call for the "next" decision. Apply the same branch, and on pack exhaustion finish the match gracefully (the existing code already finishes when `selectSongForRoom` returns null — mirror that).

- [ ] **Step 1: Replace the next-song block in `advanceRound`**

In the `decision === "next"` path, replace the `let pick = ...; try { pick = await selectSongForRoom(...) } catch {...}` block and the subsequent question-build (currently `matchEngine.ts:~395-413`) with:

```typescript
    const used: number[] = room.usedSongIds ? JSON.parse(room.usedSongIds) : [];
    const pack =
      Array.isArray(room.customPackSongIds) && room.customPackSongIds.length > 0
        ? (room.customPackSongIds as number[])
        : null;

    let songId: number;
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

    const questionAdv: MatchQuestion = buildMatchQuestion({
      song: pickedSong,
      variant: pickedVariant,
      candidateSongs,
      difficulty: room.difficulty as "low" | "medium" | "high",
    });
```

In the following `db.update(gameRooms).set({...})`, change `currentSongId: pick.songId` → `currentSongId: songId`, `usedSongIds: JSON.stringify([...used, pick.songId])` → `usedSongIds: JSON.stringify([...used, songId])`, and `currentQuestion: questionAdv` stays.

- [ ] **Step 2: Add an exhaustion test**

Append to `server/matchEngine.customPack.test.ts`:

```typescript
  it("finishes the match when the pack is exhausted", async () => {
    const db = (await getDb())!;
    const seed = await db.select().from(songs).where(eq(songs.isActive, true)).limit(1);
    if (seed.length < 1) return;
    const code = `CX${Date.now().toString().slice(-6)}`;
    // Single-song pack already 'used' -> next advance must complete.
    const [room] = await db.insert(gameRooms).values({
      roomCode: code, hostUserId: 1, mode: "multiplayer", selectedGenres: "[]", selectedDecades: "[]",
      difficulty: "medium", roundsTotal: 1, status: "active", currentRound: 1, roundPhase: "intermission",
      usedSongIds: JSON.stringify([seed[0].id]), customPackSongIds: [seed[0].id], customPackVariants: null,
    }).returning();
    await db.insert(roomPlayers).values({ roomId: room.id, userId: 1, joinOrder: 0, isReady: true, isActive: true });

    const res: any = await adminCaller().matchEngine.advanceRound({ roomCode: code });
    expect(res.complete).toBe(true);
    const [after] = await db.select().from(gameRooms).where(eq(gameRooms.id, room.id)).limit(1);
    expect(after.status).toBe("finished");

    await db.delete(roomPlayers).where(eq(roomPlayers.roomId, room.id));
    await db.delete(gameRooms).where(eq(gameRooms.id, room.id));
  });
```

> Note: if `advanceRound` has additional guards (e.g. all-players-answered) that block a forced call, adjust the fixture to satisfy them — read the `nextRoundDecision` inputs at the top of `advanceRound` and set room/player fields so the decision resolves to `"next"`.

- [ ] **Step 3: Run tests**

Run: `pnpm exec vitest run server/matchEngine.customPack.test.ts`
Expected: PASS (or SKIP without DB).

- [ ] **Step 4: Commit**

```bash
git add server/routers/matchEngine.ts server/matchEngine.customPack.test.ts
git commit -m "feat(engine): advanceRound serves curated packs; finishes on exhaustion"
```

---

## Task 5: `adminCuratedSets` router — CRUD + songsByArtist

**Files:**
- Create: `server/routers/adminCuratedSets.ts`
- Test: `server/adminCuratedSets.test.ts`

- [ ] **Step 1: Write the router**

```typescript
// server/routers/adminCuratedSets.ts
import { z } from "zod";
import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { curatedSongSets, songs } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { recordAdminAction } from "../_core/audit";

const itemSchema = z.object({ songId: z.number().int(), variantIndex: z.number().int().nullable() });

export const adminCuratedSetsRouter = router({
  list: adminProcedure
    .input(z.object({ search: z.string().optional(), status: z.enum(["active", "draft"]).optional() }).default({}))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const conds = [];
      if (input.search) conds.push(ilike(curatedSongSets.name, `%${input.search}%`));
      if (input.status) conds.push(eq(curatedSongSets.status, input.status));
      const rows = await db.select().from(curatedSongSets)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(curatedSongSets.updatedAt));
      return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, status: r.status, songCount: r.items.length, updatedAt: r.updatedAt }));
    }),

  get: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [set] = await db.select().from(curatedSongSets).where(eq(curatedSongSets.id, input.id)).limit(1);
      if (!set) throw new TRPCError({ code: "NOT_FOUND" });
      // Resolve song metadata + available variant prompts for the builder UI.
      const ids = set.items.map((i) => i.songId);
      const songRows = ids.length
        ? await db.select().from(songs).where(inArray(songs.id, ids))
        : [];
      const byId = new Map(songRows.map((s) => [s.id, s]));
      const resolvedItems = set.items.map((it) => {
        const s = byId.get(it.songId);
        const variants = (s?.lyricVariants ?? []) as Array<{ prompt: string }>;
        return {
          songId: it.songId,
          variantIndex: it.variantIndex,
          title: s?.title ?? "(missing song)",
          artistName: s?.artistName ?? "",
          available: !!s && s.isActive && s.approvalStatus === "approved",
          variantPrompts: variants.map((v) => v.prompt),
        };
      });
      return { id: set.id, name: set.name, description: set.description, status: set.status, items: resolvedItems };
    }),

  create: adminProcedure
    .input(z.object({ name: z.string().min(1), description: z.string().optional(), items: z.array(itemSchema).default([]), status: z.enum(["active", "draft"]).default("active") }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return await db.transaction(async (tx) => {
        const [created] = await tx.insert(curatedSongSets).values({
          name: input.name, description: input.description ?? null, items: input.items, status: input.status, createdBy: ctx.user.id,
        }).returning();
        await recordAdminAction({ ctx, tx, action: "curatedSet.create", targetType: "curatedSet", targetId: String(created.id), payload: { after: created } });
        return created;
      });
    }),

  update: adminProcedure
    .input(z.object({ id: z.number().int(), patch: z.object({ name: z.string().min(1).optional(), description: z.string().nullable().optional(), items: z.array(itemSchema).optional(), status: z.enum(["active", "draft"]).optional() }) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return await db.transaction(async (tx) => {
        const [before] = await tx.select().from(curatedSongSets).where(eq(curatedSongSets.id, input.id)).limit(1);
        if (!before) throw new TRPCError({ code: "NOT_FOUND" });
        const [after] = await tx.update(curatedSongSets).set({ ...input.patch, updatedAt: new Date() }).where(eq(curatedSongSets.id, input.id)).returning();
        await recordAdminAction({ ctx, tx, action: "curatedSet.update", targetType: "curatedSet", targetId: String(input.id), payload: { before, after, params: input.patch } });
        return after;
      });
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return await db.transaction(async (tx) => {
        const [before] = await tx.select().from(curatedSongSets).where(eq(curatedSongSets.id, input.id)).limit(1);
        if (!before) throw new TRPCError({ code: "NOT_FOUND" });
        await tx.delete(curatedSongSets).where(eq(curatedSongSets.id, input.id));
        await recordAdminAction({ ctx, tx, action: "curatedSet.delete", targetType: "curatedSet", targetId: String(input.id), payload: { before } });
        return { ok: true };
      });
    }),

  // Builder helper: songs by an artist (active+approved), with variant prompts.
  songsByArtist: adminProcedure
    .input(z.object({ artist: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const rows = await db.select().from(songs).where(
        and(ilike(songs.artistName, `%${input.artist}%`), eq(songs.isActive, true), eq(songs.approvalStatus, "approved")),
      );
      return rows.map((s) => ({ id: s.id, title: s.title, artistName: s.artistName, variantPrompts: ((s.lyricVariants ?? []) as Array<{ prompt: string }>).map((v) => v.prompt) }));
    }),
});
```

> The `launch` procedure is added in Task 6 (it needs the room-insert logic) — keep it out of this task.

- [ ] **Step 2: Write the test**

```typescript
// server/adminCuratedSets.test.ts
import { describe, it, expect, vi } from "vitest";
vi.mock("stripe", () => ({ default: vi.fn().mockImplementation(() => ({ checkout: { sessions: { create: vi.fn() } }, webhooks: { constructEvent: vi.fn() }, subscriptions: { retrieve: vi.fn() }, customers: { search: vi.fn().mockResolvedValue({ data: [] }) } })) }));
import { appRouter } from "./app-router";

const DB_URL = process.env.SUPABASE_SESSION_POOLER_STRING ?? process.env.SUPABASE_DIRECT_CONNECTION_STRING ?? process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

function caller(role: "admin" | "user") {
  return appRouter.createCaller({ user: { id: 1, role, email: "x@test" } as any, req: {} as any, res: {} as any, ip: undefined, userAgent: undefined, requestId: `vitest-cs-${Date.now()}-${Math.random()}`, countryCode: "US" });
}

describe("adminCuratedSets gate", () => {
  it("rejects non-admins", async () => {
    await expect(caller("user").adminCuratedSets.list({})).rejects.toThrow();
  });
});

liveDescribe("adminCuratedSets CRUD", () => {
  it("create -> get -> update -> delete round-trips", async () => {
    const c = caller("admin");
    const created = await c.adminCuratedSets.create({ name: `Vitest Set ${Date.now()}`, items: [{ songId: 1, variantIndex: null }] });
    expect(created.id).toEqual(expect.any(Number));
    const got = await c.adminCuratedSets.get({ id: created.id });
    expect(got.items.length).toBe(1);
    const upd = await c.adminCuratedSets.update({ id: created.id, patch: { status: "draft" } });
    expect(upd.status).toBe("draft");
    const del = await c.adminCuratedSets.delete({ id: created.id });
    expect(del.ok).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm exec vitest run server/adminCuratedSets.test.ts`
Expected: the gate test PASSES; CRUD PASSES with DB (else SKIP).

- [ ] **Step 4: Commit**

```bash
git add server/routers/adminCuratedSets.ts server/adminCuratedSets.test.ts
git commit -m "feat(admin): adminCuratedSets router (CRUD + songsByArtist)"
```

---

## Task 6: `adminCuratedSets.launch` — create a contest room from a set

**Files:**
- Modify: `server/routers/adminCuratedSets.ts` (add `launch` + imports)
- Test: extend `server/adminCuratedSets.test.ts`

- [ ] **Step 1: Add imports for room creation**

At the top of `server/routers/adminCuratedSets.ts` add:

```typescript
import { gameRooms, roomPlayers } from "../../drizzle/schema";
import { customAlphabet } from "nanoid";

const roomCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
const makeRoomCode = customAlphabet(roomCodeAlphabet, 6);
```

> `nanoid` is already a dependency (used by `game.createRoom` for room codes). If the existing code uses a shared helper, reuse that instead of redefining.

- [ ] **Step 2: Add the `launch` procedure inside the router object**

```typescript
  launch: adminProcedure
    .input(z.object({
      setId: z.number().int(),
      mode: z.enum(["multiplayer", "team"]).default("multiplayer"),
      difficulty: z.enum(["low", "medium", "high"]).default("medium"),
      timerSeconds: z.number().int().min(15).max(90).default(30),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [set] = await db.select().from(curatedSongSets).where(eq(curatedSongSets.id, input.setId)).limit(1);
      if (!set) throw new TRPCError({ code: "NOT_FOUND", message: "Set not found" });
      if (set.items.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "This set has no songs." });

      // Validate songs are still active+approved; drop the rest, keep order.
      const ids = set.items.map((i) => i.songId);
      const live = await db.select({ id: songs.id, title: songs.title }).from(songs)
        .where(and(inArray(songs.id, ids), eq(songs.isActive, true), eq(songs.approvalStatus, "approved")));
      const liveIds = new Set(live.map((s) => s.id));
      const usable = set.items.filter((i) => liveIds.has(i.songId));
      const droppedSongs = set.items.filter((i) => !liveIds.has(i.songId)).map((i) => i.songId);
      if (usable.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "No active songs remain in this set." });

      // Generate a unique room code.
      let roomCode = makeRoomCode();
      for (let attempt = 0; attempt < 5; attempt++) {
        const [exists] = await db.select({ id: gameRooms.id }).from(gameRooms).where(eq(gameRooms.roomCode, roomCode)).limit(1);
        if (!exists) break;
        roomCode = makeRoomCode();
      }

      const [room] = await db.insert(gameRooms).values({
        roomCode,
        hostUserId: ctx.user.id,
        mode: input.mode,
        difficulty: input.difficulty,
        timerSeconds: input.timerSeconds,
        roundsTotal: usable.length,
        selectedGenres: "[]",   // pack mode ignores these but the columns are NOT NULL
        selectedDecades: "[]",
        explicitFilter: false,
        status: "waiting",
        currentRound: 0,
        currentPlayerIndex: 0,
        usedSongIds: "[]",
        customPackSongIds: usable.map((i) => i.songId),
        customPackVariants: usable.map((i) => i.variantIndex),
      }).returning();

      await db.insert(roomPlayers).values({ roomId: room.id, userId: ctx.user.id, joinOrder: 0, isReady: false, isActive: true });

      await recordAdminAction({ ctx, tx: db as never, action: "curatedSet.launch", targetType: "gameRoom", targetId: String(room.id), payload: { setId: input.setId, roomCode, droppedSongs } });

      return { roomCode, roomId: room.id, droppedSongs };
    }),
```

> If `recordAdminAction` requires a transaction handle (`tx`), wrap the inserts + audit in `db.transaction(async (tx) => {...})` exactly like `create`/`update` above, using `tx` for all writes. Match the signature you confirmed in Task 5.

- [ ] **Step 3: Add the launch test**

```typescript
liveDescribe("adminCuratedSets.launch", () => {
  it("creates a multiplayer room with the set's songs as the custom pack", async () => {
    const c = caller("admin");
    const db = (await import("./db")).getDb && (await (await import("./db")).getDb())!;
    const { songs } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const seed = await db.select().from(songs).where(eq(songs.isActive, true)).limit(2);
    if (seed.length < 2) return;
    const set = await c.adminCuratedSets.create({ name: `Launch ${Date.now()}`, items: seed.map((s: any) => ({ songId: s.id, variantIndex: null })) });
    const launched = await c.adminCuratedSets.launch({ setId: set.id, mode: "multiplayer" });
    expect(launched.roomCode).toMatch(/^[A-Z2-9]{6}$/);
    const { gameRooms } = await import("../drizzle/schema");
    const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, launched.roomCode)).limit(1);
    expect(room.customPackSongIds).toEqual(seed.map((s: any) => s.id));
    expect(room.roundsTotal).toBe(2);
    // cleanup
    const { roomPlayers } = await import("../drizzle/schema");
    await db.delete(roomPlayers).where(eq(roomPlayers.roomId, room.id));
    await db.delete(gameRooms).where(eq(gameRooms.id, room.id));
    await c.adminCuratedSets.delete({ id: set.id });
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run server/adminCuratedSets.test.ts`
Expected: PASS (or SKIP without DB).

- [ ] **Step 5: Commit**

```bash
git add server/routers/adminCuratedSets.ts server/adminCuratedSets.test.ts
git commit -m "feat(admin): curated set launch creates a multiplayer contest room"
```

---

## Task 7: Register the router

**Files:**
- Modify: `server/app-router.ts`

- [ ] **Step 1: Add the import** (with the other `admin*` imports near the top):

```typescript
import { adminCuratedSetsRouter } from "./routers/adminCuratedSets";
```

- [ ] **Step 2: Register it** in the `router({...})` object alongside the other admin routers (after `adminGenres: adminGenresRouter,`):

```typescript
  adminCuratedSets: adminCuratedSetsRouter,
```

- [ ] **Step 3: Typecheck**

Run: `pnpm check`
Expected: PASS — `trpc.adminCuratedSets.*` is now part of `AppRouter` (the client gains types).

- [ ] **Step 4: Commit**

```bash
git add server/app-router.ts
git commit -m "feat(admin): register adminCuratedSets router"
```

---

## Task 8: Client — Curated Sets list page + routes

**Files:**
- Create: `client/src/pages/admin/CuratedSetsList.tsx`
- Modify: `client/src/App.tsx` (imports + routes)

Follow the `SongsList.tsx` pattern (admin gate, `trpc.*.useQuery`, Card/table, `Link` to new/edit).

- [ ] **Step 1: Create `CuratedSetsList.tsx`**

```tsx
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Rocket } from "lucide-react";
import { useState } from "react";

export default function CuratedSetsList() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { data, isLoading, refetch } = trpc.adminCuratedSets.list.useQuery({}, { enabled: user?.role === "admin" });
  const launch = trpc.adminCuratedSets.launch.useMutation();
  const [launched, setLaunched] = useState<{ code: string; dropped: number } | null>(null);

  if (user?.role !== "admin") return <div className="p-8 text-center text-red-600 font-semibold">Access Denied: Admin only</div>;

  async function onLaunch(id: number) {
    const res = await launch.mutateAsync({ setId: id, mode: "multiplayer" });
    setLaunched({ code: res.roomCode, dropped: res.droppedSongs.length });
  }

  return (
    <div className="container py-8 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Curated Games</h1>
        <Link href="/admin/curated-sets/new"><Button className="gap-2"><Plus className="w-4 h-4" /> New set</Button></Link>
      </div>

      {launched && (
        <Card className="p-4 border-green-500/40 bg-green-500/10">
          <p className="font-medium">Contest launched. Share this code: <span className="font-mono text-lg">{launched.code}</span></p>
          {launched.dropped > 0 && <p className="text-sm text-yellow-500">{launched.dropped} song(s) were skipped (no longer active).</p>}
        </Card>
      )}

      {isLoading ? <p>Loading…</p> : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left"><tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Songs</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr></thead>
            <tbody>
              {data?.map((s) => (
                <tr key={s.id} className="border-t hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium cursor-pointer" onClick={() => navigate(`/admin/curated-sets/${s.id}`)}>{s.name}</td>
                  <td className="px-4 py-3">{s.songCount}</td>
                  <td className="px-4 py-3"><Badge variant={s.status === "active" ? "default" : "secondary"}>{s.status}</Badge></td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" className="gap-1" disabled={s.songCount === 0 || launch.isPending} onClick={() => onLaunch(s.id)}>
                      <Rocket className="w-3.5 h-3.5" /> Launch
                    </Button>
                  </td>
                </tr>
              ))}
              {data?.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No sets yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register routes in `client/src/App.tsx`**

Add imports next to the other admin page imports:

```typescript
import CuratedSetsList from "./pages/admin/CuratedSetsList";
import CuratedSetNew from "./pages/admin/CuratedSetNew";
import CuratedSetEdit from "./pages/admin/CuratedSetEdit";
```

Add routes after the tournaments routes (order matters in wouter — `/new` before `/:id`):

```tsx
<Route path="/admin/curated-sets" component={CuratedSetsList} />
<Route path="/admin/curated-sets/new" component={CuratedSetNew} />
<Route path="/admin/curated-sets/:id" component={CuratedSetEdit} />
```

> `CuratedSetNew`/`CuratedSetEdit` don't exist yet — Task 9 creates them. To keep this commit compiling, create them as one-line placeholder default-export components first (`export default function CuratedSetNew(){return null;}`) and flesh them out in Task 9, OR do Tasks 8+9 before committing. Recommended: implement Task 9, then commit 8+9 together.

- [ ] **Step 3: Typecheck**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 4: Commit** (with Task 9 — see note)

---

## Task 9: Client — Set builder (New + Edit)

**Files:**
- Create: `client/src/pages/admin/CuratedSetNew.tsx`
- Create: `client/src/pages/admin/CuratedSetEdit.tsx`
- Create: `client/src/pages/admin/CuratedSetBuilder.tsx` (shared builder body)

The builder is the substantive UI. Extract a shared `CuratedSetBuilder` used by both New (no `setId`, calls `create`) and Edit (has `setId`, loads via `get`, calls `update`). Reuse the inline-toast + draft-state pattern from `SongEdit.tsx`/`SongNew.tsx`.

- [ ] **Step 1: Create `CuratedSetBuilder.tsx`**

The builder holds: `name`, `description`, and an ordered `items: { songId, variantIndex, title, artistName, variantPrompts }[]`. Capabilities:
- **Add by artist:** an artist input → `trpc.adminCuratedSets.songsByArtist.useQuery({artist}, {enabled})` → list with "Add" buttons (skip songs already in `items`).
- **Search & add:** reuse `trpc.adminSongs.list.useQuery({ search, limit: 20 })` → "Add" buttons.
- **Per-row:** title • artist • a `Select` of `variantPrompts` (option value = index; a "Default" option = `null`) → sets that row's `variantIndex`; **Move up / Move down** buttons (swap with neighbor); **Remove** button.
- **Save:** New → `create.mutate({ name, description, items: items.map(({songId,variantIndex})=>({songId,variantIndex})) })` then navigate to the new id; Edit → `update.mutate({ id, patch: {...} })`.

```tsx
import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronUp, ChevronDown, Trash2, Save } from "lucide-react";

export type BuilderItem = { songId: number; variantIndex: number | null; title: string; artistName: string; variantPrompts: string[] };

export function CuratedSetBuilder(props: {
  initial: { name: string; description: string; items: BuilderItem[] };
  onSave: (data: { name: string; description: string | null; items: { songId: number; variantIndex: number | null }[] }) => Promise<void>;
  saving: boolean;
}) {
  const [, navigate] = useLocation();
  const [name, setName] = useState(props.initial.name);
  const [description, setDescription] = useState(props.initial.description);
  const [items, setItems] = useState<BuilderItem[]>(props.initial.items);
  const [artist, setArtist] = useState("");
  const [songSearch, setSongSearch] = useState("");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const show = (msg: string, ok: boolean) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const byArtist = trpc.adminCuratedSets.songsByArtist.useQuery({ artist }, { enabled: artist.trim().length > 1 });
  const search = trpc.adminSongs.list.useQuery({ search: songSearch, limit: 20 }, { enabled: songSearch.trim().length > 1 });

  const has = (id: number) => items.some((i) => i.songId === id);
  const add = (s: { id: number; title: string; artistName: string; variantPrompts?: string[] }) => {
    if (has(s.id)) return;
    setItems((xs) => [...xs, { songId: s.id, variantIndex: null, title: s.title, artistName: s.artistName, variantPrompts: s.variantPrompts ?? [] }]);
  };
  const move = (i: number, d: -1 | 1) => setItems((xs) => { const j = i + d; if (j < 0 || j >= xs.length) return xs; const c = [...xs]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const remove = (i: number) => setItems((xs) => xs.filter((_, k) => k !== i));
  const setVariant = (i: number, v: number | null) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, variantIndex: v } : x)));

  async function save() {
    if (!name.trim()) return show("Name is required", false);
    if (items.length === 0) return show("Add at least one song", false);
    try {
      await props.onSave({ name: name.trim(), description: description.trim() || null, items: items.map(({ songId, variantIndex }) => ({ songId, variantIndex })) });
      show("Saved", true);
    } catch (e) { show(e instanceof Error ? e.message : "Save failed", false); }
  }

  return (
    <div className="container py-8 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/curated-sets")} className="gap-2"><ChevronLeft className="w-4 h-4" /> Back</Button>
        <Button size="sm" onClick={save} disabled={props.saving} className="gap-2"><Save className="w-4 h-4" /> {props.saving ? "Saving…" : "Save"}</Button>
      </div>
      {toast && <div className={`px-4 py-2 rounded text-sm ${toast.ok ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>{toast.msg}</div>}

      <Card className="p-4 space-y-3">
        <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Anita Baker Night" /></div>
        <div><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      </Card>

      <Card className="p-4 space-y-3">
        <Label>Add by artist</Label>
        <Input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Type an artist…" />
        <div className="flex flex-wrap gap-2">
          {byArtist.data?.filter((s) => !has(s.id)).map((s) => (
            <Button key={s.id} size="sm" variant="outline" onClick={() => add(s)}>+ {s.title}</Button>
          ))}
        </div>
        <Label className="pt-2">Search & add</Label>
        <Input value={songSearch} onChange={(e) => setSongSearch(e.target.value)} placeholder="Search any song…" />
        <div className="flex flex-wrap gap-2">
          {search.data?.rows.filter((s) => !has(s.id)).map((s) => (
            <Button key={s.id} size="sm" variant="outline" onClick={() => add({ id: s.id, title: s.title, artistName: s.artistName })}>+ {s.title} — {s.artistName}</Button>
          ))}
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left"><tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Song</th><th className="px-3 py-2">Lyric</th><th className="px-3 py-2 text-right">Order</th></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.songId} className="border-t">
                <td className="px-3 py-2">{i + 1}</td>
                <td className="px-3 py-2">{it.title} <span className="text-muted-foreground">— {it.artistName}</span></td>
                <td className="px-3 py-2">
                  <Select value={it.variantIndex === null ? "default" : String(it.variantIndex)} onValueChange={(v) => setVariant(i, v === "default" ? null : Number(v))}>
                    <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default lyric</SelectItem>
                      {it.variantPrompts.map((p, idx) => <SelectItem key={idx} value={String(idx)}>{p.slice(0, 50)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <Button size="icon" variant="ghost" onClick={() => move(i, -1)}><ChevronUp className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => move(i, 1)}><ChevronDown className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(i)}><Trash2 className="w-4 h-4 text-red-400" /></Button>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No songs yet — add some above.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Create `CuratedSetNew.tsx`**

```tsx
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { CuratedSetBuilder } from "./CuratedSetBuilder";

export default function CuratedSetNew() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const create = trpc.adminCuratedSets.create.useMutation();
  if (user?.role !== "admin") return <div className="p-8 text-center text-red-600 font-semibold">Access Denied: Admin only</div>;
  return (
    <CuratedSetBuilder
      initial={{ name: "", description: "", items: [] }}
      saving={create.isPending}
      onSave={async (data) => { const created = await create.mutateAsync(data); navigate(`/admin/curated-sets/${created.id}`); }}
    />
  );
}
```

- [ ] **Step 3: Create `CuratedSetEdit.tsx`**

```tsx
import { useParams } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { CuratedSetBuilder, type BuilderItem } from "./CuratedSetBuilder";

export default function CuratedSetEdit() {
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { data, isLoading } = trpc.adminCuratedSets.get.useQuery({ id }, { enabled: !!id && user?.role === "admin" });
  const update = trpc.adminCuratedSets.update.useMutation();
  if (user?.role !== "admin") return <div className="p-8 text-center text-red-600 font-semibold">Access Denied: Admin only</div>;
  if (isLoading || !data) return <div className="p-8">Loading…</div>;
  const items: BuilderItem[] = data.items.map((it) => ({ songId: it.songId, variantIndex: it.variantIndex, title: it.title, artistName: it.artistName, variantPrompts: it.variantPrompts }));
  return (
    <CuratedSetBuilder
      initial={{ name: data.name, description: data.description ?? "", items }}
      saving={update.isPending}
      onSave={async (d) => { await update.mutateAsync({ id, patch: d }); }}
    />
  );
}
```

- [ ] **Step 4: Typecheck + build**

Run: `pnpm check && pnpm exec vite build`
Expected: PASS / built.

- [ ] **Step 5: Commit (Tasks 8 + 9 together)**

```bash
git add client/src/pages/admin/CuratedSetsList.tsx client/src/pages/admin/CuratedSetNew.tsx client/src/pages/admin/CuratedSetEdit.tsx client/src/pages/admin/CuratedSetBuilder.tsx client/src/App.tsx
git commit -m "feat(admin-ui): curated set list, builder, and launch"
```

---

## Task 10: Admin nav link + manual verification

**Files:**
- Modify: the admin navigation component (find it: `grep -rn "/admin/tournaments" client/src` to locate the admin nav/menu where tournament links live)

- [ ] **Step 1: Add a nav entry** "Curated Games" → `/admin/curated-sets`, mirroring the existing "Tournaments" link in the same component.

- [ ] **Step 2: Manual smoke test** (against a dev server with the migration applied):
  1. Visit `/admin/curated-sets` as an admin → see the list (empty).
  2. New set → add 2 songs by artist + 1 by search → set a lyric override on one → Save.
  3. Back on the list → Launch → see a room code.
  4. Join that room code in two browser sessions, start the match → confirm the served songs are exactly the set, in order, and that the MC artist options are NOT all the same artist (decision a).

- [ ] **Step 3: Commit**

```bash
git add client/src
git commit -m "feat(admin-ui): nav link to Curated Games"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** table + override column (T1), engine threading start+advance (T3/T4), broader-catalog distractors decision (a) (T2 helper + asserted in T3), no section-filter decision (b) (inherent — pack branch skips `selectSongForRoom`), reusable sets + builder (T5/T9), launch-now + share code (T6/T8), admin-gated (T5 gate test), error handling: empty set / dropped songs (T6), stale override fallback (T2/T3), exhaustion (T4). Phase-2 items (scheduling/entry-fee/prize) intentionally excluded.
- **Type consistency:** `items: {songId, variantIndex|null}` and `customPackVariants: (number|null)[]` are used identically across T1, T2, T5, T6, T9. Helper returns `{song, candidateSongs, variantIndex}` consumed identically in T3/T4.
- **Known follow-up (not blocking):** the solo `game.ts` pack branch is left as-is (works today); a later cleanup can refactor it onto `selectCustomPackSong` for full DRY. Noted, not required for Phase 1.
