# Admin Curated Contests — Phase 1 Design

**Date:** 2026-06-27
**Status:** Approved (design); pending spec review
**Scope:** Phase 1 of 2. Phase 2 (scheduled entry-fee/prize events) is a separate follow-up spec.

## Goal

Let an admin build a reusable, hand-picked set of songs (and, optionally, the exact
lyric line per song) and **launch a multiplayer contest room** from it, getting a
shareable room code. Example: build an "Anita Baker" or "LL Cool J" set, hit Launch,
share the code; players join and compete on exactly those songs in that order.

## In scope (Phase 1)

- A reusable **Curated Song Set** entity + admin builder UI.
- The **multiplayer match engine serving a custom, ordered song list** (with per-song
  lyric overrides) — the core new gameplay wiring.
- **Launch-now**: create a multiplayer room from a set → return a shareable room code/link.

## Out of scope (→ Phase 2)

Scheduling/start times, capacity caps, Golden Note entry fees, prize pools, upcoming-
contest listings. (These reuse the existing Tournaments + `prizePools` + GN systems and
are designed separately. Phase 1 is a hard prerequisite — sets must exist and the engine
must serve them first.)

## Background (current code)

- **Rooms:** `gameRooms` (`drizzle/schema.ts:478-518`). Already has
  `customPackSongIds` (jsonb `number[]`, ordered). Created via `game.createRoom`
  (`server/routers/game.ts:119-249`); players join by `roomCode`.
- **Solo song selection** already honors `customPackSongIds` — linear serve by index
  (`server/routers/game.ts:395-438`).
- **Multiplayer** uses `selectSongForRoom` (`server/_core/songSelection.ts:89-299`)
  via `matchEngine.startMatch` (`server/routers/matchEngine.ts:72-114`) and **ignores**
  `customPackSongIds`. Questions are built by `buildMatchQuestion`
  (`server/_core/buildMatchQuestion.ts:77-164`) with distractors drawn from a
  candidate pool.
- **Admin:** pages in `client/src/pages/admin/`; admin tRPC routers registered in
  `server/app-router.ts:342-348`; all admin routers use `adminProcedure`
  (`ctx.user.role === 'admin'`). Audit via `recordAdminAction`.

## Data model

### New table: `curatedSongSets` (`drizzle/schema.ts`)

```ts
export const curatedSetStatusEnum = pgEnum("curated_set_status", ["active", "draft"]);

export const curatedSongSets = pgTable("curated_song_sets", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  // Ordered list. variantIndex null => use the song's default lyric;
  // a number => override to that index in songs.lyricVariants.
  items: jsonb("items")
    .$type<Array<{ songId: number; variantIndex: number | null }>>()
    .default([])
    .notNull(),
  status: curatedSetStatusEnum("status").default("active").notNull(),
  createdBy: integer("created_by").notNull(), // users.id (admin)
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});
```

### Change to `gameRooms`

Add one column to carry per-song lyric overrides into a live room, aligned by index
with the existing `customPackSongIds`:

```ts
// null entry => engine picks the variant normally; number => forced variant index
customPackVariants: jsonb("customPackVariants").$type<Array<number | null>>(),
```

A new Drizzle migration adds the table + column. Both are additive/nullable — no
backfill, no impact on existing rows or the solo custom-pack path.

## Core change: multiplayer engine honors custom packs

In `matchEngine` (`startMatch` + round-advance / `buildMatchQuestion` call site):

1. **Branch on pack mode.** If `room.customPackSongIds` is a non-empty array, select
   the next song from the pack at `index = usedSongIds.length` (linear, in order),
   instead of calling `selectSongForRoom`. End the match gracefully when
   `index >= customPackSongIds.length` (pack exhausted) — Phase 1 sets
   `roundsTotal = set length`, so this is the natural end.
2. **Lyric override.** If `customPackVariants[index]` is a valid index into the song's
   `lyricVariants`, use that variant; otherwise fall back to the engine's normal variant
   choice (variant[0] for multiplayer). Out-of-range/stale override → fall back, never
   throw.
3. **Distractor pool — DECISION (a).** Build MC distractors from the **broader catalog**
   (same genre/era as the target, active+approved), NOT from the set. This keeps an
   all-one-artist set from making "name the artist" trivial. Reuse the existing
   candidate-pool query used by the standard path; just don't restrict it to the pack.
4. **No difficulty song-filtering in pack mode — DECISION (b).** Serve exactly the
   admin's chosen songs/lyrics; do not apply the "low = chorus/hook only" section filter.
   `difficulty` still drives scoring and the MC option set, just not which songs/sections
   appear.

Solo path is unchanged (already pack-aware). Extract the pack-selection logic into a
small shared helper so solo and multiplayer agree on "next song + override" semantics.

## Admin UI — new "Curated Games" area (`client/src/pages/admin/`)

- **`CuratedSetsList.tsx`** — table of sets (name, # songs, status), search, create
  button, edit/delete, and a **Launch contest** action per row. Follows the
  `SongsList.tsx` pattern (cursor pagination, admin gate).
- **`CuratedSetNew.tsx` / `CuratedSetEdit.tsx`** — the set builder:
  - Name + description.
  - **Ordered song list**, drag-to-reorder; each row: title • artist • a **lyric-line
    dropdown** (default = existing; options = that song's `lyricVariants` prompts, to
    override).
  - **Add by artist:** type an artist → list that artist's catalog songs → check to add.
  - **Search & add:** search the full catalog → add individual songs.
  - Save via `adminCuratedSets` mutations; multi-section dirty-tracking + page-level save
    like `SongEdit.tsx`.
- **Launch dialog:** choose `mode` (multiplayer / team), `difficulty`, `timerSeconds`
  (rounds default to set size). On submit → returns `roomCode`; show code + copyable link.

## tRPC: `adminCuratedSets` router (`server/routers/adminCuratedSets.ts`, admin-gated)

- `list({ search?, status?, cursor?, limit? })` → sets + counts.
- `get(id)` → set with resolved song metadata (title/artist + available variants per song).
- `create({ name, description?, items, status })`, `update(id, patch)`, `delete(id)` —
  with `recordAdminAction` audit entries.
- `songsByArtist({ artist })` and reuse `adminSongs.list({ search })` for the two add modes
  (or add a thin search to this router) — returns active+approved songs with their variants.
- `launch({ setId, mode, difficulty, timerSeconds })` → validates the set (non-empty;
  drops any songs no longer active/approved and reports them), creates a `gameRooms` row
  (`mode`, `customPackSongIds` = ordered active songIds, `customPackVariants` = aligned
  overrides, `roundsTotal` = resulting length, `status = 'waiting'`), adds the admin as
  host player, returns `{ roomCode, roomId, droppedSongs }`. Reuses the room-creation
  internals from `game.createRoom` (extract a shared `createRoomRow` helper rather than
  duplicating).

Register the router in `server/app-router.ts` alongside the other `admin*` routers.

## Error handling

- Empty set (after dropping inactive songs) → `launch` returns a clear error; UI blocks.
- Songs disabled/removed after being added → filtered at launch; `droppedSongs` surfaced
  to the admin.
- Out-of-range/stale `variantIndex` → fall back to default variant, never throw.
- Pack exhaustion mid-match → match ends gracefully (final results), no error.
- All routers/pages behind `adminProcedure` / admin role check.

## Testing (TDD)

Mirror existing patterns (`server/matchEngine.*.test.ts`, `server/adminSongs.test.ts`):

- **Engine pack-mode:** serves songs in pack order; honors a valid `customPackVariants`
  override; falls back on out-of-range override; draws distractors from the general pool
  (asserts MC options aren't all the same artist for a single-artist set); ends at pack
  length.
- **`adminCuratedSets`:** CRUD happy paths + admin-gate rejection for non-admins.
- **`launch`:** builds a room with the correct `customPackSongIds`/`customPackVariants`/
  `roundsTotal`; drops inactive songs and reports them; rejects an empty set.

## Files touched (summary)

- `drizzle/schema.ts` (+ new migration) — `curatedSongSets` table, `gameRooms.customPackVariants`.
- `server/_core/songSelection.ts` or a new `customPack` helper — shared pack-selection logic.
- `server/routers/matchEngine.ts` — pack-mode branch in start/advance.
- `server/routers/game.ts` — extract `createRoomRow` helper (shared with launch).
- `server/routers/adminCuratedSets.ts` (new) + `server/app-router.ts` (register).
- `client/src/pages/admin/CuratedSetsList.tsx`, `CuratedSetNew.tsx`, `CuratedSetEdit.tsx`
  (new) + admin routing.
- Tests alongside the above.
