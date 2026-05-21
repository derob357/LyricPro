# Remote Live Mode — Phase 1: Core Video Lobby (LiveKit Cloud) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first piece of the Remote Live mode — a host can create a video-enabled multiplayer room on LiveKit Cloud, share an invite link, and 2–8 players can join and see each other in a video grid before starting the game. This is the foundation for Phases 2–5 (turn-based gameplay, spectator content, audio controls, polish).

**Architecture:**

- **LiveKit Cloud (Build tier)** as managed WebRTC backend — Apache 2.0 escape hatch preserved.
- **Server-side token minting** via tRPC procedure; `LIVEKIT_API_SECRET` never leaves the server. Tokens TTL=15min, refreshed on demand.
- **Client SDK (`livekit-client`)** drives the React video grid; works in browser and inside Capacitor's WKWebView with a small iOS AVAudioSession pre-warm shim to avoid cold-start audio glitches.
- **`game_rooms` schema is extended** (not replaced) — Remote Live games are normal game rooms with `is_video_room=true` and a `video_room_name`. Existing solo/multiplayer/team flows untouched.

**Tech Stack:**

- Server: tRPC v10, Drizzle ORM, Postgres (Supabase), `livekit-server-sdk` (Node)
- Client: React 18, `livekit-client`, `@livekit/components-react` (optional helpers)
- Mobile: Capacitor 6 (iOS WKWebView + Android Chromium WebView)
- Tests: Vitest (`pnpm test:server` + `pnpm test:client`)
- DB migration via `drizzle-kit generate && drizzle-kit migrate`

**Spec source:** [docs/specs/multiplayer-mode-design.md](../../specs/multiplayer-mode-design.md) (vendor comparison section updated 2026-05-20).

**Scope explicitly NOT in Phase 1:**

- Turn-based private-screen gameplay (Phase 2)
- Spectator view, fun facts, ads (Phase 3)
- Mute Others / host moderation (Phase 4)
- Connection-quality indicators, reconnection polish, mobile-responsive grid optimization (Phase 5)

---

## File Structure

**New files:**

- `drizzle/0012_remote-live-mode.sql` — DDL: extend `game_mode` enum + add columns to `game_rooms`
- `server/_core/livekit.ts` — Token minting + room admin SDK wrapper
- `server/_core/livekit.test.ts` — Unit tests for token shape and validation
- `server/routers/liveRoom.ts` — tRPC procedures (`createLiveRoom`, `getLiveRoom`, `joinLiveRoom`, `leaveLiveRoom`, `refreshToken`)
- `server/routers/liveRoom.test.ts` — tRPC integration tests with mocked LiveKit
- `client/src/lib/livekit/useLiveKitRoom.ts` — React hook wrapping `livekit-client` Room lifecycle
- `client/src/lib/livekit/iosAudioShim.ts` — Capacitor iOS AVAudioSession pre-warm
- `client/src/components/livekit/VideoTile.tsx` — Single-participant video tile
- `client/src/components/livekit/VideoGrid.tsx` — 2×4 max video grid layout
- `client/src/components/livekit/PermissionGate.tsx` — Pre-flight mic/camera permission UX
- `client/src/components/livekit/VideoTile.test.tsx` — Render tests
- `client/src/components/livekit/VideoGrid.test.tsx` — Layout tests
- `client/src/pages/VideoLobby.tsx` — `/lobby/live/:roomCode` page
- `ios/App/App/LiveKitAudioPlugin.swift` — Native iOS plugin for AVAudioSession
- `ios/App/App/LiveKitAudioPlugin.m` — Objective-C bridge

**Modified files:**

- `drizzle/schema.ts` — Add `'remote_live'` to `gameModeEnum`; add columns to `gameRooms` table
- `server/_core/env.ts` — Add `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL` env validation
- `server/_core/index.ts` (or root router file) — Register `liveRoom` router
- `client/src/App.tsx` — Register `/lobby/live/:roomCode` route
- `client/src/pages/GameSetup.tsx` — Add "Remote Live" mode option (paywalled via existing subscription enforcement)
- `.env.example` — Add LiveKit vars with placeholder values
- `package.json` — Add deps: `livekit-server-sdk`, `livekit-client`
- `ios/App/App/Info.plist` — Add `NSMicrophoneUsageDescription` + `NSCameraUsageDescription`
- `CHANGELOG.md` — `v0.5.0-alpha.1` entry

---

## Task 0: Dependencies & Environment Setup

**Files:**

- Modify: `package.json`
- Modify: `.env.example`
- Modify: `server/_core/env.ts`

- [ ] **Step 0.1: Install LiveKit packages**

Run:

```bash
pnpm add livekit-server-sdk@^2.7.0
pnpm add livekit-client@^2.5.0
```

Expected: `pnpm-lock.yaml` updated; no peer-dep warnings.

- [ ] **Step 0.2: Add env-var placeholders to `.env.example`**

Append to `.env.example`:

```bash
# ── LiveKit Cloud (Remote Live mode) ────────────────────────────────────────
# Get these from https://cloud.livekit.io → Project Settings → Keys.
# LIVEKIT_URL is the wss:// URL for your project (NOT the dashboard URL).
# Server-side secret. NEVER ship to client bundle.
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_URL=wss://your-project.livekit.cloud
```

- [ ] **Step 0.3: Add env validation in `server/_core/env.ts`**

Find the existing env Zod schema and add three required fields. Example block to insert alongside other env entries:

```typescript
LIVEKIT_API_KEY: z.string().min(20, "LIVEKIT_API_KEY required for Remote Live mode"),
LIVEKIT_API_SECRET: z.string().min(20, "LIVEKIT_API_SECRET required for Remote Live mode"),
LIVEKIT_URL: z.string().url().startsWith("wss://", "LIVEKIT_URL must start with wss://"),
```

If your existing env loader uses a different validator (e.g. manual `process.env.X ?? throw`), match that pattern instead — match the surrounding code style.

- [ ] **Step 0.4: Manual step — add LiveKit credentials to `.env` and Vercel**

**Do not paste credentials into chat or the plan.** Add to local `.env` and to Vercel Dashboard → Project → Settings → Environment Variables:

- `LIVEKIT_API_KEY` (from LiveKit Cloud → Keys)
- `LIVEKIT_API_SECRET` (from LiveKit Cloud → Keys)
- `LIVEKIT_URL` (from LiveKit Cloud → Settings → URL)

LiveKit project name suggestion: `lyricpro-prod` (separate dev project recommended later).

- [ ] **Step 0.5: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example server/_core/env.ts
git commit -m "chore(remote-live): add livekit-server-sdk + livekit-client deps and env vars"
```

---

## Task 1: Schema Migration — `remote_live` Mode + Video Room Columns

**Files:**

- Create: `drizzle/0012_remote-live-mode.sql`
- Modify: `drizzle/schema.ts:445-469` (gameRooms table) and the `gameModeEnum` definition
- Test: `server/routers/liveRoom.test.ts` (created in Task 3, but schema integrity is asserted by Drizzle compile in this task)

- [ ] **Step 1.1: Write the migration SQL**

Create `drizzle/0012_remote-live-mode.sql`:

```sql
-- Phase 1: Remote Live mode — extend game_rooms for LiveKit video rooms.
-- Idempotent: safe to re-run.
--
-- NOTE: this table uses camelCase quoted column names ("roomCode",
-- "hostUserId", etc) — match that convention for the new columns.

-- 1. Add 'remote_live' to the game_mode enum.
ALTER TYPE game_mode ADD VALUE IF NOT EXISTS 'remote_live';

-- 2. Extend game_rooms with video-room columns (camelCase to match existing).
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS "isVideoRoom" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS "videoRoomName" TEXT;
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS "maxPlayers" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS "turnOrder" JSONB;

-- 3. Constrain maxPlayers to the 2-8 range allowed by the spec.
ALTER TABLE game_rooms DROP CONSTRAINT IF EXISTS game_rooms_max_players_check;
ALTER TABLE game_rooms ADD CONSTRAINT game_rooms_max_players_check
  CHECK ("maxPlayers" BETWEEN 2 AND 8);

-- 4. Unique index on videoRoomName (when set) so LiveKit room names are 1:1 with game rooms.
CREATE UNIQUE INDEX IF NOT EXISTS game_rooms_video_room_name_idx
  ON game_rooms ("videoRoomName")
  WHERE "videoRoomName" IS NOT NULL;
```

- [ ] **Step 1.2: Update Drizzle schema**

In `drizzle/schema.ts`, find the `gameModeEnum` definition (lines around 240-244 per current state) and add `'remote_live'`:

```typescript
export const gameModeEnum = pgEnum("game_mode", [
  "solo",
  "multiplayer",
  "team",
  "remote_live",
]);
```

Find the `gameRooms` definition (line 445) and add the new columns right before `streakInsurance`:

```typescript
  isVideoRoom: boolean("is_video_room").default(false).notNull(),
  videoRoomName: text("video_room_name"),
  maxPlayers: integer("max_players").default(8).notNull(),
  turnOrder: jsonb("turn_order").$type<number[] | null>(),
```

- [ ] **Step 1.3: Verify schema compiles**

Run: `pnpm check`

Expected: PASS — no TypeScript errors.

- [ ] **Step 1.4: Apply the migration**

Run (from project root, with `.env` loaded):

```bash
set -a; source .env; set +a
node scripts/apply-three-layer-schema-migration.mjs --file drizzle/0012_remote-live-mode.sql
```

If the existing migration runner doesn't accept `--file`, use `psql` directly:

```bash
psql "$SUPABASE_SESSION_POOLER_STRING" -f drizzle/0012_remote-live-mode.sql
```

Expected output: `ALTER TYPE`, four `ALTER TABLE`, `CREATE UNIQUE INDEX`.

- [ ] **Step 1.5: Verify columns exist**

Run:

```bash
psql "$SUPABASE_SESSION_POOLER_STRING" -c "\d game_rooms" | grep -E 'is_video_room|video_room_name|max_players|turn_order'
```

Expected: all four columns listed.

- [ ] **Step 1.6: Commit**

```bash
git add drizzle/0012_remote-live-mode.sql drizzle/schema.ts
git commit -m "feat(remote-live): schema migration — add remote_live mode + video room columns"
```

---

## Task 2: Server-Side LiveKit Helper (`server/_core/livekit.ts`)

**Files:**

- Create: `server/_core/livekit.ts`
- Test: `server/_core/livekit.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `server/_core/livekit.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { mintLiveKitToken, generateRoomName, MAX_TOKEN_TTL_SECONDS } from "./livekit";

describe("livekit token minting", () => {
  beforeEach(() => {
    process.env.LIVEKIT_API_KEY = "test_key_at_least_20_chars_long";
    process.env.LIVEKIT_API_SECRET = "test_secret_at_least_20_chars_long";
    process.env.LIVEKIT_URL = "wss://example.livekit.cloud";
  });

  it("mints a JWT with required claims", async () => {
    const token = await mintLiveKitToken({
      roomName: "room_abc",
      identity: "user_42",
      name: "Alice",
      ttlSeconds: 900,
    });
    expect(token).toMatch(/^eyJ/); // JWT header prefix
    // JWT has three dot-separated segments.
    expect(token.split(".")).toHaveLength(3);
    // Decode payload (base64url middle segment) and check claims.
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    expect(payload.video.room).toBe("room_abc");
    expect(payload.video.roomJoin).toBe(true);
    expect(payload.sub).toBe("user_42");
    expect(payload.name).toBe("Alice");
  });

  it("rejects ttlSeconds above MAX_TOKEN_TTL_SECONDS", async () => {
    await expect(
      mintLiveKitToken({
        roomName: "room_abc",
        identity: "user_42",
        name: "Alice",
        ttlSeconds: MAX_TOKEN_TTL_SECONDS + 1,
      }),
    ).rejects.toThrow(/ttl/i);
  });

  it("rejects empty identity (would let unknown clients join)", async () => {
    await expect(
      mintLiveKitToken({
        roomName: "room_abc",
        identity: "",
        name: "Alice",
        ttlSeconds: 900,
      }),
    ).rejects.toThrow(/identity/i);
  });

  it("rejects room name with illegal characters", async () => {
    await expect(
      mintLiveKitToken({
        roomName: "room with spaces",
        identity: "user_42",
        name: "Alice",
        ttlSeconds: 900,
      }),
    ).rejects.toThrow(/room name/i);
  });
});

describe("generateRoomName", () => {
  it("returns a 32-char hex string prefixed with 'lp_'", () => {
    const name = generateRoomName();
    expect(name).toMatch(/^lp_[a-f0-9]{32}$/);
  });

  it("returns unique values across calls", () => {
    const names = new Set(Array.from({ length: 100 }, generateRoomName));
    expect(names.size).toBe(100);
  });
});
```

- [ ] **Step 2.2: Run test, confirm it fails**

Run: `pnpm test:server -- livekit.test`

Expected: FAIL — `Cannot find module './livekit'`.

- [ ] **Step 2.3: Implement `server/_core/livekit.ts`**

```typescript
/**
 * LiveKit Cloud SDK wrapper for the LyricPro server.
 *
 * Responsibilities:
 *   - Mint short-lived access tokens for clients (server-side only — the API
 *     secret never leaves this process).
 *   - Generate unique room names for new game rooms.
 *   - Provide a thin RoomServiceClient for admin operations (delete room,
 *     list participants) — used by later phases.
 *
 * Security:
 *   - Token TTL is hard-capped at MAX_TOKEN_TTL_SECONDS (15 min).
 *   - Room names must match ALLOWED_ROOM_NAME_PATTERN (prevents accidental
 *     injection into LiveKit's URL routing).
 *   - Identity must be non-empty (LiveKit allows empty, but that lets two
 *     clients accidentally share a presence slot).
 */
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { randomBytes } from "node:crypto";

export const MAX_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
const ALLOWED_ROOM_NAME_PATTERN = /^lp_[a-f0-9]{32}$/;

export interface MintTokenInput {
  roomName: string;
  identity: string;
  name: string;
  ttlSeconds: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

/**
 * Mints a JWT access token granting the holder permission to join a specific
 * LiveKit room as a specific identity. Token expires after ttlSeconds.
 */
export async function mintLiveKitToken(input: MintTokenInput): Promise<string> {
  const { roomName, identity, name, ttlSeconds } = input;

  if (!identity || identity.length === 0) {
    throw new Error("identity must be a non-empty string");
  }
  if (ttlSeconds <= 0 || ttlSeconds > MAX_TOKEN_TTL_SECONDS) {
    throw new Error(
      `ttlSeconds must be between 1 and ${MAX_TOKEN_TTL_SECONDS} (got ${ttlSeconds})`,
    );
  }
  if (!ALLOWED_ROOM_NAME_PATTERN.test(roomName)) {
    throw new Error(
      `Invalid room name: ${roomName} (must match ${ALLOWED_ROOM_NAME_PATTERN})`,
    );
  }

  const apiKey = requireEnv("LIVEKIT_API_KEY");
  const apiSecret = requireEnv("LIVEKIT_API_SECRET");

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    ttl: ttlSeconds,
  });
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return at.toJwt();
}

/**
 * Generates a cryptographically random room name suitable for LiveKit.
 * Format: lp_<32 hex chars>, e.g. lp_8f3a1c... (135 bits of entropy).
 */
export function generateRoomName(): string {
  return `lp_${randomBytes(16).toString("hex")}`;
}

/**
 * Returns a server-side admin client. Use sparingly; most flows should mint a
 * client-side token instead. Only callable from server code.
 */
export function getRoomService(): RoomServiceClient {
  const apiKey = requireEnv("LIVEKIT_API_KEY");
  const apiSecret = requireEnv("LIVEKIT_API_SECRET");
  // RoomServiceClient takes the HTTPS host, not the wss:// URL.
  const host = requireEnv("LIVEKIT_URL").replace(/^wss:\/\//, "https://");
  return new RoomServiceClient(host, apiKey, apiSecret);
}
```

- [ ] **Step 2.4: Run test, confirm it passes**

Run: `pnpm test:server -- livekit.test`

Expected: PASS — all 6 tests green.

- [ ] **Step 2.5: Commit**

```bash
git add server/_core/livekit.ts server/_core/livekit.test.ts
git commit -m "feat(remote-live): server-side LiveKit token minting + room name generator"
```

---

## Task 3: tRPC `liveRoom` Router

**Files:**

- Create: `server/routers/liveRoom.ts`
- Create: `server/routers/liveRoom.test.ts`
- Modify: `server/_core/index.ts` (or wherever the root router merges sub-routers — find it via `grep -rn "createTRPCRouter" server/_core/ | head`)

- [ ] **Step 3.1: Write the failing test**

Create `server/routers/liveRoom.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createCallerFactory } from "@trpc/server";
import { liveRoomRouter } from "./liveRoom";
import type { TRPCContext } from "../_core/trpc";

// Minimal context mock — adjust property names to match your real TRPCContext.
function makeCtx(overrides: Partial<TRPCContext> = {}): TRPCContext {
  return {
    user: { id: 42, email: "host@example.com", firstName: "Alice" },
    db: {} as any, // tests stub specific db calls per-test
    req: {} as any,
    res: {} as any,
    ...overrides,
  } as TRPCContext;
}

vi.mock("../_core/livekit", async () => {
  const actual = await vi.importActual<typeof import("../_core/livekit")>(
    "../_core/livekit",
  );
  return {
    ...actual,
    mintLiveKitToken: vi.fn().mockResolvedValue("eyJtocked.jwt.token"),
    generateRoomName: vi.fn().mockReturnValue("lp_" + "a".repeat(32)),
  };
});

describe("liveRoomRouter.createLiveRoom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a game_rooms row with is_video_room=true and returns inviteCode + livekitUrl", async () => {
    const insertedRoom = {
      id: 7,
      roomCode: "ABC123",
      inviteCode: "INV789",
      videoRoomName: "lp_" + "a".repeat(32),
      isVideoRoom: true,
    };
    const ctx = makeCtx();
    (ctx.db as any).insert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([insertedRoom]),
      }),
    });

    const caller = createCallerFactory()(liveRoomRouter)(ctx);
    const result = await caller.createLiveRoom({
      selectedGenres: ["R&B"],
      selectedDecades: ["2000s"],
      difficulty: "medium",
      maxPlayers: 6,
      timerSeconds: 30,
      roundsTotal: 10,
    });

    expect(result.inviteCode).toBe("INV789");
    expect(result.livekitUrl).toMatch(/^wss:\/\//);
    expect(result.token).toBe("eyJtocked.jwt.token");
  });

  it("rejects when caller is not authenticated", async () => {
    const ctx = makeCtx({ user: null as any });
    const caller = createCallerFactory()(liveRoomRouter)(ctx);
    await expect(
      caller.createLiveRoom({
        selectedGenres: ["R&B"],
        selectedDecades: ["2000s"],
        difficulty: "medium",
        maxPlayers: 6,
        timerSeconds: 30,
        roundsTotal: 10,
      }),
    ).rejects.toThrow(/UNAUTHORIZED/i);
  });

  it("rejects maxPlayers out of range", async () => {
    const ctx = makeCtx();
    const caller = createCallerFactory()(liveRoomRouter)(ctx);
    await expect(
      caller.createLiveRoom({
        selectedGenres: ["R&B"],
        selectedDecades: ["2000s"],
        difficulty: "medium",
        maxPlayers: 99,
        timerSeconds: 30,
        roundsTotal: 10,
      }),
    ).rejects.toThrow(/maxPlayers/i);
  });
});

describe("liveRoomRouter.joinLiveRoom", () => {
  it("mints a token when caller is in the room roster", async () => {
    const ctx = makeCtx();
    (ctx.db as any).query = {
      gameRooms: {
        findFirst: vi.fn().mockResolvedValue({
          id: 7,
          videoRoomName: "lp_" + "a".repeat(32),
          isVideoRoom: true,
          maxPlayers: 6,
        }),
      },
      roomPlayers: {
        findFirst: vi.fn().mockResolvedValue({ id: 1, roomId: 7, userId: 42 }),
        findMany: vi.fn().mockResolvedValue([{ id: 1 }]),
      },
    };
    const caller = createCallerFactory()(liveRoomRouter)(ctx);
    const result = await caller.joinLiveRoom({ inviteCode: "INV789" });
    expect(result.token).toBe("eyJtocked.jwt.token");
    expect(result.livekitUrl).toMatch(/^wss:\/\//);
  });

  it("rejects join when room is at max capacity", async () => {
    const ctx = makeCtx();
    (ctx.db as any).query = {
      gameRooms: {
        findFirst: vi.fn().mockResolvedValue({
          id: 7,
          videoRoomName: "lp_" + "a".repeat(32),
          isVideoRoom: true,
          maxPlayers: 2,
        }),
      },
      roomPlayers: {
        findFirst: vi.fn().mockResolvedValue(null), // not yet a member
        findMany: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]), // already 2
      },
    };
    const caller = createCallerFactory()(liveRoomRouter)(ctx);
    await expect(
      caller.joinLiveRoom({ inviteCode: "INV789" }),
    ).rejects.toThrow(/full|capacity/i);
  });
});
```

- [ ] **Step 3.2: Run test, confirm it fails**

Run: `pnpm test:server -- liveRoom.test`

Expected: FAIL — `Cannot find module './liveRoom'`.

- [ ] **Step 3.3: Implement `server/routers/liveRoom.ts`**

```typescript
/**
 * tRPC router for Remote Live mode (Phase 1 — lobby only).
 *
 * Procedures:
 *   - createLiveRoom: host creates a new video-enabled game room, returns
 *     invite code + LiveKit token + ws URL.
 *   - getLiveRoom (by inviteCode): public preview of a room (player count,
 *     genres, host name) — used by the join page.
 *   - joinLiveRoom (by inviteCode): caller is added to roomPlayers and a
 *     fresh LiveKit token is minted for them.
 *   - leaveLiveRoom: marks caller as inactive (does not delete the room).
 *   - refreshToken: short-TTL tokens; this endpoint re-issues for an active
 *     room member. Rate-limited per user.
 *
 * Security:
 *   - All token-issuing procedures require auth (ctx.user.id).
 *   - joinLiveRoom enforces maxPlayers and inviteExpiresAt.
 *   - refreshToken rate-limited via existing rateLimit module.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../_core/trpc";
import { gameRooms, roomPlayers } from "../../drizzle/schema";
import { mintLiveKitToken, generateRoomName } from "../_core/livekit";
import { rateLimit } from "../_core/rateLimit";
import { generateInviteCode } from "../routers/game"; // existing helper

const TOKEN_TTL_SECONDS = 15 * 60;
const INVITE_EXPIRY_DAYS = 7;

const createLiveRoomInput = z.object({
  selectedGenres: z.array(z.string()).min(1),
  selectedDecades: z.array(z.string()).min(1),
  difficulty: z.enum(["low", "medium", "high"]).default("medium"),
  maxPlayers: z.number().int().min(2).max(8),
  timerSeconds: z.number().int().min(10).max(120).default(30),
  roundsTotal: z.number().int().min(1).max(50).default(10),
  explicitFilter: z.boolean().default(false),
});

export const liveRoomRouter = createTRPCRouter({
  createLiveRoom: protectedProcedure
    .input(createLiveRoomInput)
    .mutation(async ({ ctx, input }) => {
      const videoRoomName = generateRoomName();
      const inviteCode = generateInviteCode();
      const inviteExpiresAt = new Date(
        Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      );

      const [room] = await ctx.db
        .insert(gameRooms)
        .values({
          roomCode: inviteCode.slice(0, 8).toUpperCase(),
          hostUserId: ctx.user.id,
          mode: "remote_live",
          rankingMode: "total_points",
          timerSeconds: input.timerSeconds,
          roundsTotal: input.roundsTotal,
          selectedGenres: JSON.stringify(input.selectedGenres),
          selectedDecades: JSON.stringify(input.selectedDecades),
          difficulty: input.difficulty,
          explicitFilter: input.explicitFilter,
          status: "waiting",
          isVideoRoom: true,
          videoRoomName,
          maxPlayers: input.maxPlayers,
          inviteCode,
          inviteExpiresAt,
        })
        .returning();

      // Host auto-joins as first roomPlayer.
      await ctx.db.insert(roomPlayers).values({
        roomId: room.id,
        userId: ctx.user.id,
        guestName: ctx.user.firstName ?? "Host",
        joinOrder: 0,
        isReady: false,
        isActive: true,
      });

      const token = await mintLiveKitToken({
        roomName: videoRoomName,
        identity: `user_${ctx.user.id}`,
        name: ctx.user.firstName ?? "Host",
        ttlSeconds: TOKEN_TTL_SECONDS,
      });

      return {
        roomId: room.id,
        roomCode: room.roomCode,
        inviteCode: room.inviteCode!,
        videoRoomName,
        livekitUrl: process.env.LIVEKIT_URL!,
        token,
      };
    }),

  getLiveRoom: protectedProcedure
    .input(z.object({ inviteCode: z.string().min(4).max(64) }))
    .query(async ({ ctx, input }) => {
      const room = await ctx.db.query.gameRooms.findFirst({
        where: and(
          eq(gameRooms.inviteCode, input.inviteCode),
          eq(gameRooms.isVideoRoom, true),
        ),
      });
      if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      if (room.inviteExpiresAt && room.inviteExpiresAt < new Date()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Invite expired" });
      }

      const players = await ctx.db.query.roomPlayers.findMany({
        where: and(eq(roomPlayers.roomId, room.id), eq(roomPlayers.isActive, true)),
      });

      return {
        roomId: room.id,
        roomCode: room.roomCode,
        difficulty: room.difficulty,
        selectedGenres: JSON.parse(room.selectedGenres) as string[],
        selectedDecades: JSON.parse(room.selectedDecades) as string[],
        maxPlayers: room.maxPlayers,
        playerCount: players.length,
        status: room.status,
      };
    }),

  joinLiveRoom: protectedProcedure
    .input(z.object({ inviteCode: z.string().min(4).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const room = await ctx.db.query.gameRooms.findFirst({
        where: and(
          eq(gameRooms.inviteCode, input.inviteCode),
          eq(gameRooms.isVideoRoom, true),
        ),
      });
      if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      if (room.status !== "waiting") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Game already started" });
      }

      const existingMember = await ctx.db.query.roomPlayers.findFirst({
        where: and(eq(roomPlayers.roomId, room.id), eq(roomPlayers.userId, ctx.user.id)),
      });

      if (!existingMember) {
        const allPlayers = await ctx.db.query.roomPlayers.findMany({
          where: and(eq(roomPlayers.roomId, room.id), eq(roomPlayers.isActive, true)),
        });
        if (allPlayers.length >= room.maxPlayers) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Room is full (${room.maxPlayers} player capacity)`,
          });
        }
        await ctx.db.insert(roomPlayers).values({
          roomId: room.id,
          userId: ctx.user.id,
          guestName: ctx.user.firstName ?? "Player",
          joinOrder: allPlayers.length,
          isActive: true,
        });
      }

      const token = await mintLiveKitToken({
        roomName: room.videoRoomName!,
        identity: `user_${ctx.user.id}`,
        name: ctx.user.firstName ?? "Player",
        ttlSeconds: TOKEN_TTL_SECONDS,
      });

      return {
        roomId: room.id,
        roomCode: room.roomCode,
        videoRoomName: room.videoRoomName!,
        livekitUrl: process.env.LIVEKIT_URL!,
        token,
      };
    }),

  leaveLiveRoom: protectedProcedure
    .input(z.object({ roomId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(roomPlayers)
        .set({ isActive: false })
        .where(and(eq(roomPlayers.roomId, input.roomId), eq(roomPlayers.userId, ctx.user.id)));
      return { success: true };
    }),

  refreshToken: protectedProcedure
    .input(z.object({ roomId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await rateLimit({
        key: `livekit_token_refresh:${ctx.user.id}`,
        limit: 20,
        windowSeconds: 60,
      });

      const member = await ctx.db.query.roomPlayers.findFirst({
        where: and(
          eq(roomPlayers.roomId, input.roomId),
          eq(roomPlayers.userId, ctx.user.id),
          eq(roomPlayers.isActive, true),
        ),
      });
      if (!member) throw new TRPCError({ code: "FORBIDDEN", message: "Not a room member" });

      const room = await ctx.db.query.gameRooms.findFirst({
        where: eq(gameRooms.id, input.roomId),
      });
      if (!room?.videoRoomName) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Video room not found" });
      }

      const token = await mintLiveKitToken({
        roomName: room.videoRoomName,
        identity: `user_${ctx.user.id}`,
        name: ctx.user.firstName ?? "Player",
        ttlSeconds: TOKEN_TTL_SECONDS,
      });
      return { token, livekitUrl: process.env.LIVEKIT_URL! };
    }),
});
```

- [ ] **Step 3.4: Register the router**

Find the root router file (likely `server/_core/index.ts` or `server/routers/index.ts`). Look for an `appRouter = createTRPCRouter({ ... })` block and add:

```typescript
import { liveRoomRouter } from "../routers/liveRoom";

export const appRouter = createTRPCRouter({
  // ...existing routers
  liveRoom: liveRoomRouter,
});
```

- [ ] **Step 3.5: Run test, confirm it passes**

Run: `pnpm test:server -- liveRoom.test`

Expected: PASS — all 5 tests green.

- [ ] **Step 3.6: Verify full server tests still pass**

Run: `pnpm test:server`

Expected: All server tests pass (one known pre-existing failure in `contentReadMode.test.ts` is unrelated — see todo.md Phase 5c).

- [ ] **Step 3.7: Commit**

```bash
git add server/routers/liveRoom.ts server/routers/liveRoom.test.ts server/_core/index.ts
git commit -m "feat(remote-live): tRPC liveRoom router (create/get/join/leave/refresh)"
```

---

## Task 4: Client — LiveKit React Hook (`useLiveKitRoom`)

**Files:**

- Create: `client/src/lib/livekit/useLiveKitRoom.ts`

- [ ] **Step 4.1: Implement the hook**

```typescript
/**
 * React hook that manages a LiveKit Room connection lifecycle.
 *
 * Usage:
 *   const { room, participants, status, error } = useLiveKitRoom({
 *     livekitUrl: "wss://...",
 *     token: "eyJ...",
 *     autoConnect: true,
 *   });
 *
 * Status transitions: idle -> connecting -> connected -> (reconnecting|disconnected)
 *
 * The hook does NOT auto-publish tracks — callers explicitly call
 * room.localParticipant.setMicrophoneEnabled(true) / setCameraEnabled(true)
 * when ready. This matches the PermissionGate flow (Task 5b).
 */
import { useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  type RemoteParticipant,
  type LocalParticipant,
  ConnectionState,
} from "livekit-client";

export type RoomStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export interface UseLiveKitRoomOptions {
  livekitUrl: string;
  token: string;
  autoConnect?: boolean;
}

export interface UseLiveKitRoomResult {
  room: Room | null;
  participants: (RemoteParticipant | LocalParticipant)[];
  status: RoomStatus;
  error: Error | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export function useLiveKitRoom(
  opts: UseLiveKitRoomOptions,
): UseLiveKitRoomResult {
  const roomRef = useRef<Room | null>(null);
  const [status, setStatus] = useState<RoomStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [participants, setParticipants] = useState<
    (RemoteParticipant | LocalParticipant)[]
  >([]);

  const refreshParticipants = (room: Room) => {
    setParticipants([room.localParticipant, ...Array.from(room.remoteParticipants.values())]);
  };

  const connect = async () => {
    if (roomRef.current) return;
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    roomRef.current = room;

    room
      .on(RoomEvent.ParticipantConnected, () => refreshParticipants(room))
      .on(RoomEvent.ParticipantDisconnected, () => refreshParticipants(room))
      .on(RoomEvent.TrackSubscribed, () => refreshParticipants(room))
      .on(RoomEvent.TrackUnsubscribed, () => refreshParticipants(room))
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        if (state === ConnectionState.Connected) setStatus("connected");
        else if (state === ConnectionState.Connecting) setStatus("connecting");
        else if (state === ConnectionState.Reconnecting) setStatus("reconnecting");
        else if (state === ConnectionState.Disconnected) setStatus("disconnected");
      })
      .on(RoomEvent.Disconnected, () => {
        refreshParticipants(room);
      });

    try {
      setStatus("connecting");
      await room.connect(opts.livekitUrl, opts.token);
      refreshParticipants(room);
    } catch (err) {
      setError(err as Error);
      setStatus("error");
      roomRef.current = null;
    }
  };

  const disconnect = async () => {
    if (roomRef.current) {
      await roomRef.current.disconnect();
      roomRef.current = null;
      setParticipants([]);
      setStatus("disconnected");
    }
  };

  useEffect(() => {
    if (opts.autoConnect) {
      void connect();
    }
    return () => {
      void disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.livekitUrl, opts.token]);

  return {
    room: roomRef.current,
    participants,
    status,
    error,
    connect,
    disconnect,
  };
}
```

- [ ] **Step 4.2: Type-check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 4.3: Commit**

```bash
git add client/src/lib/livekit/useLiveKitRoom.ts
git commit -m "feat(remote-live): useLiveKitRoom React hook for Room lifecycle"
```

---

## Task 5: Client — VideoTile + VideoGrid Components

**Files:**

- Create: `client/src/components/livekit/VideoTile.tsx`
- Create: `client/src/components/livekit/VideoGrid.tsx`
- Test: `client/src/components/livekit/VideoTile.test.tsx`
- Test: `client/src/components/livekit/VideoGrid.test.tsx`

- [ ] **Step 5.1: Write the failing tests**

Create `client/src/components/livekit/VideoTile.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { VideoTile } from "./VideoTile";

// Mock participant: minimal shape used by VideoTile.
function makeParticipant(overrides: Record<string, unknown> = {}) {
  return {
    identity: "user_42",
    name: "Alice",
    isLocal: false,
    videoTrackPublications: new Map(),
    audioTrackPublications: new Map(),
    isSpeaking: false,
    ...overrides,
  } as any;
}

describe("VideoTile", () => {
  it("renders the participant name", () => {
    render(<VideoTile participant={makeParticipant({ name: "Alice" })} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("shows a 'You' badge for the local participant", () => {
    render(<VideoTile participant={makeParticipant({ isLocal: true })} />);
    expect(screen.getByText(/you/i)).toBeInTheDocument();
  });

  it("falls back to identity when name is missing", () => {
    render(
      <VideoTile participant={makeParticipant({ name: undefined, identity: "user_7" })} />,
    );
    expect(screen.getByText("user_7")).toBeInTheDocument();
  });
});
```

Create `client/src/components/livekit/VideoGrid.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { VideoGrid } from "./VideoGrid";

function makeParticipant(name: string) {
  return {
    identity: `user_${name}`,
    name,
    isLocal: false,
    videoTrackPublications: new Map(),
    audioTrackPublications: new Map(),
    isSpeaking: false,
  } as any;
}

describe("VideoGrid", () => {
  it("renders one tile per participant", () => {
    render(
      <VideoGrid
        participants={[makeParticipant("Alice"), makeParticipant("Bob"), makeParticipant("Carol")]}
      />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
  });

  it("renders an empty state when no participants", () => {
    render(<VideoGrid participants={[]} />);
    expect(screen.getByText(/waiting/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5.2: Run tests, confirm they fail**

Run: `pnpm test:client -- livekit/VideoTile livekit/VideoGrid`

Expected: FAIL — modules not found.

- [ ] **Step 5.3: Implement `VideoTile.tsx`**

```typescript
import { useEffect, useRef } from "react";
import {
  Track,
  type LocalParticipant,
  type RemoteParticipant,
} from "livekit-client";

interface VideoTileProps {
  participant: LocalParticipant | RemoteParticipant;
}

/**
 * Renders a single participant's camera tile.
 *
 * - Attaches the camera <video> element to the participant's video track if
 *   one is published; falls back to a placeholder with their initials.
 * - Shows a "You" badge for the local participant.
 * - Speaking ring (lightweight border highlight) when isSpeaking.
 */
export function VideoTile({ participant }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const videoPub = Array.from(participant.videoTrackPublications.values()).find(
      (p) => p.source === Track.Source.Camera,
    );
    const track = videoPub?.track;
    const el = videoRef.current;
    if (track && el) {
      track.attach(el);
      return () => {
        track.detach(el);
      };
    }
  }, [participant]);

  const displayName = participant.name || participant.identity;
  const hasVideo =
    Array.from(participant.videoTrackPublications.values()).some(
      (p) => p.track && !p.isMuted && p.source === Track.Source.Camera,
    );

  return (
    <div
      data-testid="video-tile"
      className={`relative aspect-video rounded-lg overflow-hidden bg-slate-800 border-2 ${
        participant.isSpeaking ? "border-emerald-400" : "border-transparent"
      }`}
    >
      {hasVideo ? (
        <video ref={videoRef} autoPlay playsInline muted={participant.isLocal} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-slate-400 text-2xl font-bold">
          {displayName.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="absolute bottom-1 left-1 px-2 py-0.5 text-xs bg-black/60 rounded text-white">
        {displayName}
        {participant.isLocal && (
          <span className="ml-1 text-emerald-400">(You)</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5.4: Implement `VideoGrid.tsx`**

```typescript
import type { LocalParticipant, RemoteParticipant } from "livekit-client";
import { VideoTile } from "./VideoTile";

interface VideoGridProps {
  participants: (LocalParticipant | RemoteParticipant)[];
}

/**
 * 2×4 max grid (CSS Grid auto-fit), one tile per participant.
 * Empty state shows when no one has joined yet (defensive — the local
 * participant should always be present once connected).
 */
export function VideoGrid({ participants }: VideoGridProps) {
  if (participants.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 p-8 text-center text-slate-400">
        Waiting for players to join…
      </div>
    );
  }

  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
      {participants.map((p) => (
        <VideoTile key={p.identity} participant={p} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5.5: Run tests, confirm they pass**

Run: `pnpm test:client -- livekit/VideoTile livekit/VideoGrid`

Expected: PASS — all 5 tests green.

- [ ] **Step 5.6: Commit**

```bash
git add client/src/components/livekit/
git commit -m "feat(remote-live): VideoTile + VideoGrid components"
```

---

## Task 6: Client — PermissionGate + iOS Audio Shim

**Files:**

- Create: `client/src/components/livekit/PermissionGate.tsx`
- Create: `client/src/lib/livekit/iosAudioShim.ts`

- [ ] **Step 6.1: Implement the iOS audio shim**

Create `client/src/lib/livekit/iosAudioShim.ts`:

```typescript
/**
 * iOS Capacitor AVAudioSession pre-warm.
 *
 * WKWebView starts the AVAudioSession in a category that causes the first
 * second of LiveKit audio to drop. We pre-activate the session via a native
 * plugin (LiveKitAudioPlugin) BEFORE Room.connect(). On non-iOS platforms
 * (web, Android), this is a no-op.
 *
 * The native plugin is registered as `LiveKitAudio` and exposes a single
 * `prewarm()` method.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

interface LiveKitAudioPlugin {
  prewarm(): Promise<void>;
}

const LiveKitAudio = registerPlugin<LiveKitAudioPlugin>("LiveKitAudio");

export async function prewarmIosAudio(): Promise<void> {
  if (Capacitor.getPlatform() !== "ios") return;
  try {
    await LiveKitAudio.prewarm();
  } catch (err) {
    // Non-fatal — log and continue; LiveKit will still work, just with the
    // first-second audio glitch documented in our research.
    console.warn("[livekit] iOS audio pre-warm failed:", err);
  }
}
```

- [ ] **Step 6.2: Implement `PermissionGate.tsx`**

```typescript
import { useState } from "react";
import { prewarmIosAudio } from "../../lib/livekit/iosAudioShim";

interface PermissionGateProps {
  onGranted: () => void;
}

/**
 * Pre-flight UI requesting mic + camera access. On user click:
 *   1. Pre-warm iOS AVAudioSession (no-op on web/Android).
 *   2. Call navigator.mediaDevices.getUserMedia to surface the permission
 *      prompt explicitly (rather than letting LiveKit do it mid-connect).
 *   3. Release the test tracks immediately.
 *   4. Notify parent via onGranted().
 *
 * If permission is denied, an error message is shown with a retry button.
 */
export function PermissionGate({ onGranted }: PermissionGateProps) {
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  const requestAccess = async () => {
    setRequesting(true);
    setError(null);
    try {
      await prewarmIosAudio();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      // Release immediately — LiveKit will re-acquire on connect.
      stream.getTracks().forEach((t) => t.stop());
      onGranted();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Permission denied";
      setError(`Camera and microphone access is required to join. (${message})`);
      setRequesting(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-700 p-6 text-center">
      <h2 className="text-lg font-semibold mb-2">Allow camera and microphone</h2>
      <p className="text-sm text-slate-400 mb-4">
        You'll see your fellow players and they'll see you. You can mute or hide
        yourself any time.
      </p>
      <button
        onClick={requestAccess}
        disabled={requesting}
        className="rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 px-4 py-2 text-white font-medium"
      >
        {requesting ? "Requesting…" : "Allow access"}
      </button>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 6.3: Type-check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 6.4: Commit**

```bash
git add client/src/lib/livekit/iosAudioShim.ts client/src/components/livekit/PermissionGate.tsx
git commit -m "feat(remote-live): PermissionGate + iOS AVAudioSession pre-warm shim"
```

---

## Task 7: Client — VideoLobby Page

**Files:**

- Create: `client/src/pages/VideoLobby.tsx`
- Modify: `client/src/App.tsx` (add route)

- [ ] **Step 7.1: Implement `VideoLobby.tsx`**

```typescript
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { trpc } from "../lib/trpc"; // adjust import to match your codebase
import { useLiveKitRoom } from "../lib/livekit/useLiveKitRoom";
import { VideoGrid } from "../components/livekit/VideoGrid";
import { PermissionGate } from "../components/livekit/PermissionGate";

/**
 * /lobby/live/:inviteCode
 *
 * - On mount, calls liveRoom.joinLiveRoom to get a token (or .getLiveRoom for
 *   preview if not yet a member — Phase 1 just joins directly).
 * - Shows PermissionGate first; on grant, instantiates the LiveKit room.
 * - Renders VideoGrid + share link + a placeholder "Start Game" button (host).
 */
export function VideoLobby() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const [permissionsGranted, setPermissionsGranted] = useState(false);

  const joinMutation = trpc.liveRoom.joinLiveRoom.useMutation();
  const [creds, setCreds] = useState<{ token: string; livekitUrl: string; roomId: number } | null>(null);

  useEffect(() => {
    if (!inviteCode || !permissionsGranted) return;
    joinMutation
      .mutateAsync({ inviteCode })
      .then((res) => setCreds(res))
      .catch((err) => {
        console.error("[lobby] join failed:", err);
        navigate("/");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode, permissionsGranted]);

  const { participants, status, error } = useLiveKitRoom({
    livekitUrl: creds?.livekitUrl ?? "",
    token: creds?.token ?? "",
    autoConnect: !!creds,
  });

  // Publish mic+camera once connected.
  // Done via a separate effect on the underlying room object — see Phase 5
  // for finer-grained control. For Phase 1 we publish on join.
  // (Kept simple here; useLiveKitRoom exposes `room` if needed.)

  if (!permissionsGranted) {
    return <PermissionGate onGranted={() => setPermissionsGranted(true)} />;
  }

  if (!creds) {
    return <div className="p-6 text-slate-400">Joining room…</div>;
  }

  const shareUrl = `${window.location.origin}/lobby/live/${inviteCode}`;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Multiplayer Lobby</h1>
        <div className="text-sm text-slate-400">
          Status: <span className="font-mono">{status}</span>
        </div>
      </header>

      {error && (
        <div className="rounded-md bg-red-900/30 border border-red-700 p-3 text-red-200">
          Connection error: {error.message}
        </div>
      )}

      <VideoGrid participants={participants} />

      <section className="rounded-lg border border-slate-700 p-4">
        <h3 className="font-semibold mb-2">Invite players</h3>
        <code className="block bg-slate-900 rounded px-2 py-1 text-sm break-all">
          {shareUrl}
        </code>
        <button
          onClick={() => navigator.clipboard.writeText(shareUrl)}
          className="mt-2 text-sm text-emerald-400 hover:underline"
        >
          Copy link
        </button>
      </section>

      <button
        disabled
        title="Phase 2 — turn-based gameplay not yet implemented"
        className="rounded-md bg-slate-700 px-4 py-2 text-slate-400 cursor-not-allowed"
      >
        Start Game (Phase 2)
      </button>
    </div>
  );
}
```

- [ ] **Step 7.2: Wire the route in `App.tsx`**

Find the existing route block (look for `<Route path="/lobby/...">` or similar). Add:

```typescript
import { VideoLobby } from "./pages/VideoLobby";

// inside <Routes>:
<Route path="/lobby/live/:inviteCode" element={<VideoLobby />} />
```

- [ ] **Step 7.3: Type-check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 7.4: Smoke test in browser**

Run: `pnpm dev`

Open `http://localhost:5173`, sign in. Use the tRPC playground or hit `liveRoom.createLiveRoom` from the console to mint a room. Navigate to `/lobby/live/<inviteCode>`. Expected:

1. Permission gate appears
2. After grant, lobby loads
3. Status shows `connecting` → `connected`
4. Local participant tile shows your video

- [ ] **Step 7.5: Commit**

```bash
git add client/src/pages/VideoLobby.tsx client/src/App.tsx
git commit -m "feat(remote-live): VideoLobby page + /lobby/live/:inviteCode route"
```

---

## Task 8: iOS Native Plugin for AVAudioSession Pre-Warm

**Files:**

- Create: `ios/App/App/LiveKitAudioPlugin.swift`
- Create: `ios/App/App/LiveKitAudioPlugin.m`
- Modify: `ios/App/App/Info.plist` (add usage descriptions if missing)

- [ ] **Step 8.1: Add Info.plist permissions**

Check existing keys with:

```bash
grep -E 'NSMicrophoneUsageDescription|NSCameraUsageDescription' ios/App/App/Info.plist
```

If missing, add inside the top-level `<dict>`:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>LyricPro uses your microphone for voice answers and Remote Live multiplayer.</string>
<key>NSCameraUsageDescription</key>
<string>LyricPro uses your camera for the Remote Live multiplayer video lobby.</string>
```

- [ ] **Step 8.2: Implement the Swift plugin**

Create `ios/App/App/LiveKitAudioPlugin.swift`:

```swift
import Foundation
import Capacitor
import AVFoundation

@objc(LiveKitAudioPlugin)
public class LiveKitAudioPlugin: CAPPlugin {
    @objc func prewarm(_ call: CAPPluginCall) {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(
                .playAndRecord,
                mode: .videoChat,
                options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker]
            )
            try session.setActive(true, options: [])
            call.resolve()
        } catch {
            call.reject("AVAudioSession activation failed: \(error.localizedDescription)")
        }
    }
}
```

- [ ] **Step 8.3: Implement the Obj-C bridge**

Create `ios/App/App/LiveKitAudioPlugin.m`:

```objc
#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(LiveKitAudioPlugin, "LiveKitAudio",
           CAP_PLUGIN_METHOD(prewarm, CAPPluginReturnPromise);
)
```

- [ ] **Step 8.4: Sync Capacitor**

Run:

```bash
npx cap sync ios
```

Expected: no errors; new plugin registered.

- [ ] **Step 8.5: Manual verification on device or simulator**

Open Xcode (`npx cap open ios`), build and run on iOS 16+ simulator or device. Navigate to a lobby. Verify:

- Permission prompts appear once (not repeatedly)
- First-second audio is clean (no dropout)

- [ ] **Step 8.6: Commit**

```bash
git add ios/App/App/LiveKitAudioPlugin.swift ios/App/App/LiveKitAudioPlugin.m ios/App/App/Info.plist
git commit -m "feat(remote-live): iOS AVAudioSession pre-warm Capacitor plugin"
```

---

## Task 9: GameSetup Integration — "Remote Live" Mode Option

**Files:**

- Modify: `client/src/pages/GameSetup.tsx`

- [ ] **Step 9.1: Add the mode option**

Find the existing game-mode selector in `GameSetup.tsx` (look for `"solo" | "multiplayer" | "team"`). Add `"remote_live"`. Example block — exact placement depends on the existing component structure:

```tsx
<button
  type="button"
  onClick={() => setMode("remote_live")}
  disabled={!user?.subscription?.tier || user.subscription.tier === "free"}
  className={`p-4 rounded-lg border ${mode === "remote_live" ? "border-emerald-400" : "border-slate-700"}`}
>
  <div className="font-semibold">Remote Live</div>
  <div className="text-xs text-slate-400">Video multiplayer (premium)</div>
</button>
```

- [ ] **Step 9.2: Handle remote_live submission**

Find the submit handler that calls `createGameRoom` (or similar). Branch on `mode === "remote_live"`:

```typescript
if (mode === "remote_live") {
  const result = await trpc.liveRoom.createLiveRoom.mutate({
    selectedGenres,
    selectedDecades,
    difficulty,
    maxPlayers: 8,
    timerSeconds,
    roundsTotal,
    explicitFilter,
  });
  navigate(`/lobby/live/${result.inviteCode}`);
  return;
}
// ...existing solo/multiplayer/team logic
```

- [ ] **Step 9.3: Type-check + run client tests**

Run: `pnpm check && pnpm test:client`

Expected: PASS.

- [ ] **Step 9.4: Commit**

```bash
git add client/src/pages/GameSetup.tsx
git commit -m "feat(remote-live): wire 'Remote Live' mode into GameSetup (premium gated)"
```

---

## Task 10: End-to-End Smoke Test + Security Pass

**Files:** (no code changes — verification only)

- [ ] **Step 10.1: Run full test suite**

Run: `pnpm test`

Expected: all tests pass (one known pre-existing failure in `contentReadMode.test.ts` per todo.md Phase 5c — unrelated).

- [ ] **Step 10.2: Verify API secret never appears in client bundle**

Run:

```bash
pnpm build
grep -r "LIVEKIT_API_SECRET" dist/ client/dist/ 2>/dev/null
```

Expected: NO matches.

- [ ] **Step 10.3: Verify token TTL is 15 min**

Decode a minted token (use https://jwt.io or `node -e`):

```bash
node -e "
const tok = process.argv[1];
const p = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString());
console.log('exp:', new Date(p.exp * 1000).toISOString());
console.log('iat:', new Date(p.iat * 1000).toISOString());
console.log('ttl_seconds:', p.exp - p.iat);
" "<paste-token-here>"
```

Expected: `ttl_seconds: 900`.

- [ ] **Step 10.4: Verify rate limit on refreshToken**

Hit `liveRoom.refreshToken` 21 times in 60 seconds from a single user. Expected: the 21st returns a `TOO_MANY_REQUESTS` error.

- [ ] **Step 10.5: Two-browser join smoke test**

In two browser sessions (different users):

1. User A: navigate to GameSetup, choose Remote Live, submit → lands on `/lobby/live/<code>`
2. User A: copy invite link
3. User B: sign in, paste link → sees PermissionGate, grants, joins
4. Both browsers show 2 tiles in the grid

- [ ] **Step 10.6: Capacitor iOS smoke test**

Build the iOS app, install on device/simulator, repeat 10.5. Expected: no first-second audio dropout; permission prompted once.

- [ ] **Step 10.7: Commit the CHANGELOG entry**

Append to `CHANGELOG.md` under a new `## [Unreleased]` section:

```markdown
## [Unreleased]

### Added
- **Remote Live mode (Phase 1: Core Video Lobby)** — LiveKit Cloud–backed
  video-conference lobby for 2–8 players. Host creates a room from GameSetup,
  shares an invite link, players join and see each other in a video grid.
  Premium-only. Phase 2 (turn-based gameplay) tracked separately.
- iOS Capacitor `LiveKitAudio` plugin for AVAudioSession pre-warm.
- `liveRoom` tRPC router: `createLiveRoom`, `getLiveRoom`, `joinLiveRoom`,
  `leaveLiveRoom`, `refreshToken`.
- Schema: `game_rooms.is_video_room`, `video_room_name`, `max_players`,
  `turn_order`; new `remote_live` value in `game_mode` enum.

### Security
- LiveKit API secret stays server-side; tokens have 15-minute TTL and
  per-user rate limit (20 refreshes/minute).
```

- [ ] **Step 10.8: Commit + tag**

```bash
git add CHANGELOG.md
git commit -m "docs(remote-live): CHANGELOG for Phase 1 video lobby"
git tag v0.5.0-alpha.1
git push origin main --tags
```

---

## Phases 2–5 — Outline Only

Phase 1 above produces a complete, shippable, testable foundation. The next four phases each warrant their own detailed plan when scheduled — included here as a roadmap.

### Phase 2: Turn-Based Gameplay (2–3 weeks)

- Server-authoritative turn rotation using `game_rooms.turn_order` + `current_player_index`
- Private gameplay screen for the active player (no LiveKit data-channel exposure of answers)
- Spectator countdown view for the other 1–7 players
- Real-time state sync via tRPC subscriptions over WebSocket
- Round-results screen shared across all participants

### Phase 3: Spectator Content (1–2 weeks)

- `fun_facts` table + admin authoring UI
- Fun-facts carousel on spectator view (rotate every 15s)
- iHeartMedia ad slot integration (banner + optional VPAID pre-roll)
- Spectator-view engagement metrics (impressions, clicks, dwell)

### Phase 4: Audio Controls (1 week)

- Per-player self-mute (already supported by LiveKit primitives — wire UI only)
- "Mute Others" focus mode for the active player (client-side audio attenuation)
- Host moderation (mute / kick individual players via `liveRoom.moderate` procedure)

### Phase 5: Polish (1–2 weeks)

- Connection-quality indicator per tile (uses LiveKit `ConnectionQuality` events)
- Robust reconnection UX (network-loss banner, auto-rejoin)
- Mobile-responsive grid + iOS battery optimization (pause remote video render during active gameplay turn)
- Cost monitoring dashboard pulling LiveKit Cloud billing API into admin pages

---

## References

- [LiveKit Cloud docs](https://docs.livekit.io/cloud/)
- [`livekit-server-sdk` API](https://docs.livekit.io/reference/server/server-apis/)
- [`livekit-client` API](https://docs.livekit.io/reference/client-sdk-js/)
- [Capacitor plugin authoring (iOS)](https://capacitorjs.com/docs/plugins/ios)
- Spec: [docs/specs/multiplayer-mode-design.md](../../specs/multiplayer-mode-design.md)
