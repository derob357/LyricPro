# Interstitial Home Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/` with a two-choice interstitial (MyDashboard → `/welcome`; Play Now → email + genre + decade(s) → straight into question 1 of a default 3-round solo game) over a blown-up 3D golden-note background.

**Architecture:** New `Interstitial` page at `/` with a reusable `NoteBackground3D` (CSS perspective/rotate3d/float, no WebGL). The old `Home` page moves to `/welcome`. Play Now mints a guest session (lead-captures the email) for unauthenticated visitors, then calls the existing `createRoom` solo flow with `difficulty:"low"`, `timerSeconds:90`, `rounds:3` and navigates to `/play/:roomCode`. Backend gains a 90s timer cap and a `guest_sessions.email` column.

**Tech Stack:** React + wouter + tRPC + framer-motion + Tailwind (client); Express + tRPC + drizzle/Postgres (server); vitest + @testing-library/react (tests).

**Spec:** `docs/superpowers/specs/2026-06-07-interstitial-home-page-design.md`

---

## File Structure

- **Create:** `client/src/components/NoteBackground3D.tsx` — fixed full-bleed animated note background.
- **Create:** `client/src/pages/Interstitial.tsx` — the new `/` page (two cards + Play Now flow).
- **Create:** `client/src/lib/formatTime.ts` — `mm:ss` formatter (shared, testable).
- **Create:** `client/src/pages/Interstitial.test.tsx` — interstitial behavior tests.
- **Create:** `client/src/components/NoteBackground3D.test.tsx` — background render test.
- **Create:** `client/src/lib/formatTime.test.ts` — formatter unit test.
- **Modify:** `server/routers/game.ts` — `createRoom` timer cap `45→90`; `createGuestSession` accepts/persists `email`.
- **Modify:** `drizzle/schema.ts` — add nullable `email` to `guestSessions`; run `pnpm db:push` to emit migration `0014`.
- **Modify:** `client/src/App.tsx` — route `/` → `Interstitial`, add `/welcome` → `Home`.
- **Modify:** `client/src/pages/Gameplay.tsx` — use `formatTime` for the timer label.
- **Modify:** `client/src/pages/FinalResults.tsx` — pre-fill captured email, add "Exit to welcome".
- **Modify:** `client/src/pages/SignIn.tsx` — read `?email=` to pre-fill the email field.
- **Modify:** `server/routers/game.test.ts` (or nearest existing game test file) — server assertions.

> **Single-Supabase caveat (from spec D2):** `pnpm db:push` applies to **production**. The `email` column is additive + nullable, so it is safe.

---

## Task 1: Backend — raise createRoom timer cap to 90s

**Files:**
- Modify: `server/routers/game.ts` (createRoom input zod, ~line 225)
- Test: `server/routers/game.test.ts` (create if absent — check `ls server/routers/*.test.ts` first; otherwise put it in the nearest existing server test and mirror its imports)

- [ ] **Step 1: Find the existing server test setup**

Run: `ls server/routers/*.test.ts server/**/*.test.ts 2>/dev/null; grep -rln "createRoom" server --include=*.test.ts`
Expected: shows where (if anywhere) game procedures are tested. Mirror that file's harness (db mock / test caller). If none exists, create `server/routers/game.timer.test.ts` using the same import style as any existing `server/**/*.test.ts`.

- [ ] **Step 2: Write the failing test**

Add a test asserting the input schema accepts 90 and rejects 91. The `createRoom` input is a zod object; test the schema directly to avoid DB setup. Extract is not required — re-declare the relevant rule in the test by importing the router input is not exported, so test via a thin schema check:

```ts
// server/routers/game.timer.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";

// Mirrors the createRoom timerSeconds rule. Keep in sync with game.ts.
const timerSecondsSchema = z.number().int().min(15).max(90).default(30);

describe("createRoom timerSeconds bounds", () => {
  it("accepts 90s (new quick-play default)", () => {
    expect(timerSecondsSchema.parse(90)).toBe(90);
  });
  it("still accepts 15s lower bound", () => {
    expect(timerSecondsSchema.parse(15)).toBe(15);
  });
  it("rejects above 90", () => {
    expect(() => timerSecondsSchema.parse(91)).toThrow();
  });
});
```

> Note: this guards the intended bound. Step 3 makes `game.ts` match it.

- [ ] **Step 3: Run test to verify it passes against the intended bound, then break it**

Run: `pnpm test:server -- game.timer`
Expected: PASS (the test encodes the target). Now confirm the real router still says `.max(45)`:
Run: `grep -n "timerSeconds: z.number" server/routers/game.ts`
Expected: shows `.max(45)` — the production code is out of sync with the test's intent.

- [ ] **Step 4: Update the real cap in game.ts**

In `server/routers/game.ts`, change the `createRoom` input line:

```ts
// before
timerSeconds: z.number().int().min(15).max(45).default(30),
// after
timerSeconds: z.number().int().min(15).max(90).default(30),
```

- [ ] **Step 5: Re-run tests**

Run: `pnpm test:server -- game.timer`
Expected: PASS
Run: `pnpm check`
Expected: no new type errors.

- [ ] **Step 6: Commit**

```bash
git add server/routers/game.ts server/routers/game.timer.test.ts
git commit -m "feat(game): raise createRoom timer cap to 90s"
```

---

## Task 2: Backend — guest_sessions.email + createGuestSession email capture

**Files:**
- Modify: `drizzle/schema.ts` (guestSessions table, ~line 260)
- Modify: `server/routers/game.ts` (`createGuestSession`, ~line 207)
- Test: `server/routers/game.guest.test.ts` (create)

- [ ] **Step 1: Add the nullable email column to the schema**

In `drizzle/schema.ts`, inside `guestSessions = pgTable("guest_sessions", {...})`, add an `email` column after `nickname`:

```ts
export const guestSessions = pgTable("guest_sessions", {
  id: serial("id").primaryKey(),
  sessionToken: varchar("sessionToken", { length: 128 }).notNull().unique(),
  nickname: varchar("nickname", { length: 64 }).notNull(),
  email: varchar("email", { length: 254 }), // nullable — lead capture from interstitial
  createdAt: createdAtColumn(),
});
```

- [ ] **Step 2: Generate + apply the migration**

Run: `pnpm db:push`
Expected: drizzle generates `drizzle/0014_*.sql` adding `email` to `guest_sessions` and applies it. (Applies to prod — additive/nullable, safe.)
Run: `git status --short drizzle/`
Expected: a new `0014_*.sql` and updated `drizzle/meta/` snapshot are present.

- [ ] **Step 3: Write the failing test for createGuestSession email + nickname derivation**

```ts
// server/routers/game.guest.test.ts
import { describe, it, expect } from "vitest";

// Pure helper under test (added in Step 4). Derives a display nickname from an
// email local-part when no explicit nickname is given.
import { deriveGuestNickname } from "./guestNickname";

describe("deriveGuestNickname", () => {
  it("uses the email local-part when nickname is absent", () => {
    expect(deriveGuestNickname(undefined, "Jamie.Lee@example.com")).toBe("Jamie.Lee");
  });
  it("prefers an explicit nickname", () => {
    expect(deriveGuestNickname("DJ Spin", "x@y.com")).toBe("DJ Spin");
  });
  it("falls back to 'Guest' when neither is usable", () => {
    expect(deriveGuestNickname(undefined, undefined)).toBe("Guest");
    expect(deriveGuestNickname("", "")).toBe("Guest");
  });
  it("truncates to 64 chars", () => {
    const long = "a".repeat(100) + "@example.com";
    expect(deriveGuestNickname(undefined, long).length).toBeLessThanOrEqual(64);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test:server -- game.guest`
Expected: FAIL — `Cannot find module './guestNickname'`.

- [ ] **Step 5: Create the helper**

```ts
// server/routers/guestNickname.ts
// Derives a guest display nickname. Prefers an explicit nickname; otherwise
// uses the email local-part; otherwise "Guest". Always <= 64 chars to fit the
// guest_sessions.nickname column.
export function deriveGuestNickname(nickname?: string, email?: string): string {
  const explicit = (nickname ?? "").trim();
  if (explicit) return explicit.slice(0, 64);
  const local = (email ?? "").split("@")[0]?.trim() ?? "";
  if (local) return local.slice(0, 64);
  return "Guest";
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test:server -- game.guest`
Expected: PASS

- [ ] **Step 7: Wire email + helper into createGuestSession**

In `server/routers/game.ts`, import the helper near the top:

```ts
import { deriveGuestNickname } from "./guestNickname";
```

Replace the `createGuestSession` procedure (currently requires `nickname`) with one that accepts an optional `nickname` and optional `email`, derives the nickname, and persists the email:

```ts
  // Create a guest session (interstitial lead capture: email optional)
  createGuestSession: publicProcedure
    .input(z.object({
      nickname: z.string().min(1).max(64).optional(),
      email: z.string().email().max(254).optional(),
    }))
    .mutation(async ({ input }) => {
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
```

- [ ] **Step 8: Run checks**

Run: `pnpm test:server -- game.guest`
Expected: PASS
Run: `pnpm check`
Expected: no new type errors (the drizzle insert now allows `email`).

- [ ] **Step 9: Commit**

```bash
git add drizzle/schema.ts drizzle/0014_*.sql drizzle/meta server/routers/game.ts server/routers/guestNickname.ts server/routers/game.guest.test.ts
git commit -m "feat(game): guest_sessions.email + email-aware createGuestSession"
```

---

## Task 3: Client — mm:ss timer formatter (fixes 90s display)

**Files:**
- Create: `client/src/lib/formatTime.ts`
- Create: `client/src/lib/formatTime.test.ts`
- Modify: `client/src/pages/Gameplay.tsx:476` (timer label)

- [ ] **Step 1: Write the failing test**

```ts
// client/src/lib/formatTime.test.ts
import { describe, it, expect } from "vitest";
import { formatMMSS } from "./formatTime";

describe("formatMMSS", () => {
  it("formats sub-minute as 0:SS with zero-pad", () => {
    expect(formatMMSS(30)).toBe("0:30");
    expect(formatMMSS(5)).toBe("0:05");
  });
  it("formats 90s as 1:30 (the new quick-play default)", () => {
    expect(formatMMSS(90)).toBe("1:30");
  });
  it("formats 60s as 1:00", () => {
    expect(formatMMSS(60)).toBe("1:00");
  });
  it("clamps negatives to 0:00", () => {
    expect(formatMMSS(-3)).toBe("0:00");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:client -- formatTime`
Expected: FAIL — `Cannot find module './formatTime'`.

- [ ] **Step 3: Implement the formatter**

```ts
// client/src/lib/formatTime.ts
// Formats a whole-second count as m:ss (e.g. 90 -> "1:30", 5 -> "0:05").
// Used by the gameplay countdown so timers above 59s read correctly.
export function formatMMSS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:client -- formatTime`
Expected: PASS

- [ ] **Step 5: Use it in Gameplay**

In `client/src/pages/Gameplay.tsx`, add the import with the other `@/lib` imports:

```ts
import { formatMMSS } from "@/lib/formatTime";
```

Replace the hardcoded timer label (around line 476):

```tsx
// before
<Clock className="w-3.5 h-3.5" /> 0:{String(timeLeft).padStart(2, "0")}
// after
<Clock className="w-3.5 h-3.5" /> {formatMMSS(timeLeft)}
```

- [ ] **Step 6: Run checks**

Run: `pnpm test:client -- formatTime`
Expected: PASS
Run: `pnpm check`
Expected: no new type errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/formatTime.ts client/src/lib/formatTime.test.ts client/src/pages/Gameplay.tsx
git commit -m "fix(gameplay): mm:ss timer label so 90s reads 1:30"
```

---

## Task 4: Client — NoteBackground3D component

**Files:**
- Create: `client/src/components/NoteBackground3D.tsx`
- Create: `client/src/components/NoteBackground3D.test.tsx`

Uses the existing asset `public/brand/golden-note.svg` (served at `/brand/golden-note.svg`).

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/NoteBackground3D.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NoteBackground3D } from "./NoteBackground3D";

describe("NoteBackground3D", () => {
  it("renders the golden-note asset, decorative and non-interactive", () => {
    const { container, getByTestId } = render(<NoteBackground3D />);
    const img = getByTestId("note-bg-img") as HTMLImageElement;
    expect(img.getAttribute("src")).toContain("golden-note.svg");
    // Decorative: hidden from a11y tree.
    expect(img.getAttribute("aria-hidden")).toBe("true");
    // Non-interactive wrapper.
    const root = getByTestId("note-bg-root");
    expect(root.className).toContain("pointer-events-none");
    expect(container).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:client -- NoteBackground3D`
Expected: FAIL — `Cannot find module './NoteBackground3D'`.

- [ ] **Step 3: Implement the component**

```tsx
// client/src/components/NoteBackground3D.tsx
import { useEffect, useRef } from "react";

// Fixed, full-bleed, blown-up golden note that floats with a subtle 3D tilt
// and mouse parallax. Decorative only (aria-hidden, pointer-events-none) and
// sits behind page content. Honors prefers-reduced-motion: no float/parallax.
export function NoteBackground3D() {
  const noteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = noteRef.current;
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const dx = (e.clientX / window.innerWidth - 0.5) * 2;  // -1..1
        const dy = (e.clientY / window.innerHeight - 0.5) * 2; // -1..1
        el.style.setProperty("--px", `${dx * 18}px`);
        el.style.setProperty("--py", `${dy * 18}px`);
        el.style.setProperty("--rx", `${dy * -6}deg`);
        el.style.setProperty("--ry", `${dx * 6}deg`);
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      data-testid="note-bg-root"
      aria-hidden="true"
      className="fixed inset-0 -z-10 overflow-hidden pointer-events-none select-none"
    >
      {/* glow halo */}
      <div className="absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, oklch(0.78 0.18 75 / 0.20), oklch(0.65 0.28 290 / 0.08) 55%, transparent 75%)" }} />
      {/* blown-up note with 3D tilt + float */}
      <div
        ref={noteRef}
        className="note-bg-float absolute left-1/2 top-1/2 h-[88vmin] w-[88vmin] -translate-x-1/2 -translate-y-1/2 opacity-[0.45]"
        style={{
          transform:
            "translate(calc(-50% + var(--px, 0px)), calc(-50% + var(--py, 0px))) perspective(1200px) rotate3d(1, 0.5, 0, calc(16deg + var(--rx, 0deg))) rotateY(var(--ry, 0deg))",
          filter: "drop-shadow(0 0 80px oklch(0.78 0.18 75 / 0.35))",
          transition: "transform 0.18s ease-out",
        }}
      >
        <img
          data-testid="note-bg-img"
          src="/brand/golden-note.svg"
          alt=""
          aria-hidden="true"
          className="h-full w-full object-contain"
          draggable={false}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the float keyframes to global CSS**

In `client/src/index.css`, append (near the other keyframes/glow utilities):

```css
@keyframes noteBgFloat {
  0%, 100% { translate: 0 -10px; }
  50%      { translate: 0 10px; }
}
.note-bg-float { animation: noteBgFloat 7s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .note-bg-float { animation: none; }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test:client -- NoteBackground3D`
Expected: PASS

- [ ] **Step 6: Run checks**

Run: `pnpm check`
Expected: no new type errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/NoteBackground3D.tsx client/src/components/NoteBackground3D.test.tsx client/src/index.css
git commit -m "feat(home): NoteBackground3D blown-up floating note background"
```

---

## Task 5: Client — routing swap (Home → /welcome, Interstitial stub at /)

This task creates a minimal `Interstitial` stub so routing can be wired and verified before Task 6 builds the full form.

**Files:**
- Create: `client/src/pages/Interstitial.tsx` (stub)
- Modify: `client/src/App.tsx` (imports + routes)
- Test: `client/src/pages/Interstitial.test.tsx` (route smoke test)

- [ ] **Step 1: Create the Interstitial stub**

```tsx
// client/src/pages/Interstitial.tsx
import { useLocation } from "wouter";
import { NoteBackground3D } from "@/components/NoteBackground3D";
import { Button } from "@/components/ui/button";

export default function Interstitial() {
  const [, navigate] = useLocation();
  return (
    <div className="relative min-h-screen text-foreground">
      <NoteBackground3D />
      <div className="container relative z-10 flex min-h-screen items-center justify-center">
        <Button data-testid="mydashboard-btn" variant="outline" onClick={() => navigate("/welcome")}>
          Go to Dashboard
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the routes in App.tsx**

In `client/src/App.tsx`, add the Interstitial import next to the others:

```ts
import Interstitial from "./pages/Interstitial";
```

Change the `/` route and add `/welcome` (keep `Home` imported):

```tsx
// before
<Route path="/" component={Home} />
// after
<Route path="/" component={Interstitial} />
<Route path="/welcome" component={Home} />
```

- [ ] **Step 3: Write the failing route test**

```tsx
// client/src/pages/Interstitial.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return { ...actual, useLocation: () => ["/", navigate] };
});

import Interstitial from "./Interstitial";

describe("Interstitial (stub)", () => {
  it("MyDashboard navigates to /welcome", () => {
    render(<Interstitial />);
    screen.getByTestId("mydashboard-btn").click();
    expect(navigate).toHaveBeenCalledWith("/welcome");
  });
});
```

- [ ] **Step 4: Run test**

Run: `pnpm test:client -- Interstitial`
Expected: PASS (stub already wired).

- [ ] **Step 5: Audit `navigate("/")` call sites that meant "marketing home"**

Run: `grep -rn 'navigate("/")\|href="/"\|to="/"' client/src --include=*.tsx`
For each hit decide: "leave game / go to entry" → keep `/`; "go to the welcome/marketing page" → change to `/welcome`. Known cases to repoint to `/welcome`:
- `client/src/pages/FinalResults.tsx` "Home" button (the post-game exit) — handled fully in Task 7; if you touch it here, only note it.
Leave game-flow back-buttons (e.g. GameSetup header "Back") pointing at `/` (the interstitial) — that is correct.

Document each decision in the commit body.

- [ ] **Step 6: Run full client suite + typecheck**

Run: `pnpm test:client`
Expected: PASS (no regressions).
Run: `pnpm check`
Expected: no new type errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/Interstitial.tsx client/src/pages/Interstitial.test.tsx client/src/App.tsx
git commit -m "feat(home): route / to interstitial stub, move old Home to /welcome"
```

---

## Task 6: Client — Interstitial Play Now form + guest/auth flow

Builds the full Option-B layout and the core flow. Replaces the Task 5 stub body.

**Files:**
- Modify: `client/src/pages/Interstitial.tsx`
- Modify: `client/src/pages/Interstitial.test.tsx`

**Canonical lists (copy verbatim from `GameSetup.tsx` for backend compatibility):**
```ts
const GENRES = ["Country", "Hip Hop", "R&B", "Pop", "Rock", "Gospel", "Soul", "Jazz", "Blues", "Alternative", "Reggae", "Mixed"];
const DECADES = ["1940–1950", "1950–1960", "1960–1970", "1970–1980", "1980–1990", "1990–2000", "2000–2010", "2010–2020", "2020–Present"];
```

- [ ] **Step 1: Write failing tests for validation + flows**

Replace `client/src/pages/Interstitial.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return { ...actual, useLocation: () => ["/", navigate] };
});

// Auth mock — flip isAuthenticated per test via the hoisted object.
const authState = vi.hoisted(() => ({ value: { user: null as any, isAuthenticated: false } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => authState.value }));

// trpc mutation mocks
const createGuestSession = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
const createRoom = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    game: {
      createGuestSession: { useMutation: () => createGuestSession },
      createRoom: { useMutation: () => createRoom },
    },
  },
}));

import Interstitial from "./Interstitial";

function selectGenreAndDecade() {
  // Genre (native-friendly select trigger uses role combobox; click first item)
  fireEvent.click(screen.getByTestId("genre-trigger"));
  fireEvent.click(screen.getByTestId("genre-opt-Pop"));
  // Decade (multiselect popover)
  fireEvent.click(screen.getByTestId("decade-trigger"));
  fireEvent.click(screen.getByTestId("decade-opt-1990–2000"));
}

describe("Interstitial Play Now", () => {
  beforeEach(() => {
    navigate.mockClear();
    createGuestSession.mutateAsync.mockReset().mockResolvedValue({ token: "guest-tok", nickname: "jamie" });
    createRoom.mutateAsync.mockReset().mockResolvedValue({ roomCode: "ROOM42" });
    authState.value = { user: null, isAuthenticated: false };
    localStorage.clear();
  });

  it("disables Start until email + genre + decade are all set (guest)", () => {
    render(<Interstitial />);
    const start = screen.getByTestId("play-start") as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("email-input"), { target: { value: "jamie@example.com" } });
    expect(start.disabled).toBe(true); // still missing genre/decade
    selectGenreAndDecade();
    expect(start.disabled).toBe(false);
  });

  it("guest flow: creates guest session, stores token+email, creates 3-round low/90s solo room, navigates to /play", async () => {
    render(<Interstitial />);
    fireEvent.change(screen.getByTestId("email-input"), { target: { value: "jamie@example.com" } });
    selectGenreAndDecade();
    fireEvent.click(screen.getByTestId("play-start"));

    await waitFor(() => expect(createRoom.mutateAsync).toHaveBeenCalled());
    expect(createGuestSession.mutateAsync).toHaveBeenCalledWith({ email: "jamie@example.com" });
    expect(localStorage.getItem("lyricpro_guest_token")).toBe("guest-tok");
    expect(localStorage.getItem("lyricpro_guest_email")).toBe("jamie@example.com");
    expect(createRoom.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      mode: "solo", genres: ["Pop"], decades: ["1990–2000"],
      difficulty: "low", timerSeconds: 90, rounds: 3, explicitFilter: false,
      guestToken: "guest-tok",
    }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/play/ROOM42"));
  });

  it("authenticated flow: no email field, no guest session, creates room without guestToken", async () => {
    authState.value = { user: { id: "u1", firstName: "Sam" }, isAuthenticated: true };
    render(<Interstitial />);
    expect(screen.queryByTestId("email-input")).toBeNull();
    selectGenreAndDecade();
    fireEvent.click(screen.getByTestId("play-start"));
    await waitFor(() => expect(createRoom.mutateAsync).toHaveBeenCalled());
    expect(createGuestSession.mutateAsync).not.toHaveBeenCalled();
    expect(createRoom.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      mode: "solo", genres: ["Pop"], decades: ["1990–2000"],
      difficulty: "low", timerSeconds: 90, rounds: 3,
    }));
    expect(createRoom.mutateAsync.mock.calls[0][0].guestToken).toBeUndefined();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/play/ROOM42"));
  });

  it("MyDashboard navigates to /welcome", () => {
    render(<Interstitial />);
    fireEvent.click(screen.getByTestId("mydashboard-btn"));
    expect(navigate).toHaveBeenCalledWith("/welcome");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:client -- Interstitial`
Expected: FAIL — testids (`email-input`, `genre-trigger`, etc.) and the flow don't exist yet.

- [ ] **Step 3: Implement the full Interstitial**

Replace `client/src/pages/Interstitial.tsx` with:

```tsx
import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { NoteBackground3D } from "@/components/NoteBackground3D";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getLoginUrl } from "@/const";
import { Music, Play, LayoutDashboard, ChevronDown, Trophy, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

const GENRES = ["Country", "Hip Hop", "R&B", "Pop", "Rock", "Gospel", "Soul", "Jazz", "Blues", "Alternative", "Reggae", "Mixed"];
const DECADES = ["1940–1950", "1950–1960", "1960–1970", "1970–1980", "1980–1990", "1990–2000", "2000–2010", "2010–2020", "2020–Present"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Interstitial() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated } = useAuth();

  const [email, setEmail] = useState("");
  const [genre, setGenre] = useState<string>("");
  const [decades, setDecades] = useState<string[]>([]);
  const [isStarting, setIsStarting] = useState(false);

  const createGuestSession = trpc.game.createGuestSession.useMutation();
  const createRoom = trpc.game.createRoom.useMutation();

  const emailOk = isAuthenticated || EMAIL_RE.test(email);
  const canStart = emailOk && !!genre && decades.length > 0 && !isStarting;

  const toggleDecade = (d: string) =>
    setDecades((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const handleStart = async () => {
    if (!canStart) return;
    setIsStarting(true);
    try {
      let guestToken: string | undefined;
      if (!isAuthenticated) {
        const guest = await createGuestSession.mutateAsync({ email });
        guestToken = guest.token;
        localStorage.setItem("lyricpro_guest_token", guest.token);
        localStorage.setItem("lyricpro_guest_email", email);
      }
      const room = await createRoom.mutateAsync({
        mode: "solo",
        genres: [genre],
        decades,
        difficulty: "low",
        timerSeconds: 90,
        rounds: 3,
        explicitFilter: false,
        ...(guestToken ? { guestToken } : {}),
      });
      navigate(`/play/${room.roomCode}`);
    } catch (err: any) {
      toast.error(err?.message || "Could not start the game. Try again.");
      setIsStarting(false);
    }
  };

  return (
    <div className="relative min-h-screen text-foreground overflow-hidden">
      <NoteBackground3D />

      {/* slim nav */}
      <nav className="relative z-20 flex items-center justify-between h-16 container">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center glow-purple">
            <Music className="w-4 h-4 text-primary" />
          </div>
          <span className="font-display font-bold text-lg text-gradient">LyricPro Ai</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button onClick={() => navigate("/leaderboards")} className="text-muted-foreground hover:text-foreground hidden sm:flex items-center gap-1">
            <Trophy className="w-4 h-4" /> Leaderboards
          </button>
          <button onClick={() => navigate("/shop")} className="text-muted-foreground hover:text-foreground flex items-center gap-1">
            <ShoppingCart className="w-4 h-4" /> <span className="hidden sm:inline">Shop</span>
          </button>
          {!isAuthenticated && (
            <a href={getLoginUrl()} className="text-muted-foreground hover:text-foreground">Sign In</a>
          )}
        </div>
      </nav>

      {/* two cards */}
      <div className="relative z-10 container flex min-h-[calc(100vh-4rem)] items-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="grid w-full gap-6 md:grid-cols-[1.6fr_1fr] max-w-5xl mx-auto"
        >
          {/* PLAY NOW (primary) */}
          <div className="glass-strong rounded-2xl p-6 sm:p-8 border border-primary/20">
            <h2 className="font-display text-2xl font-bold mb-1 flex items-center gap-2">
              <Play className="w-5 h-5 text-primary" /> Play Now
            </h2>
            <p className="text-muted-foreground text-sm mb-5">
              {isAuthenticated ? "Pick a genre and decade — straight into the game." : "No sign-up needed. Drop your email, pick a vibe, and play."}
            </p>

            <div className="space-y-4">
              {!isAuthenticated && (
                <div>
                  <label className="text-xs uppercase tracking-wide text-muted-foreground">Email</label>
                  <Input
                    data-testid="email-input"
                    type="email"
                    inputMode="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1"
                  />
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-4">
                {/* Genre — single select */}
                <div>
                  <label className="text-xs uppercase tracking-wide text-muted-foreground">Genre</label>
                  <Select value={genre} onValueChange={setGenre}>
                    <SelectTrigger data-testid="genre-trigger" className="mt-1">
                      <SelectValue placeholder="Choose a genre" />
                    </SelectTrigger>
                    <SelectContent>
                      {GENRES.map((g) => (
                        <SelectItem key={g} value={g} data-testid={`genre-opt-${g}`}>{g}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Decades — multi select */}
                <div>
                  <label className="text-xs uppercase tracking-wide text-muted-foreground">Decade(s)</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button data-testid="decade-trigger" variant="outline" className="mt-1 w-full justify-between font-normal">
                        <span className="truncate">
                          {decades.length === 0 ? "Choose decade(s)" : `${decades.length} selected`}
                        </span>
                        <ChevronDown className="w-4 h-4 opacity-60" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-2">
                      <div className="max-h-64 overflow-auto space-y-1">
                        {DECADES.map((d) => (
                          <label key={d} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/5 cursor-pointer">
                            <Checkbox
                              data-testid={`decade-opt-${d}`}
                              checked={decades.includes(d)}
                              onCheckedChange={() => toggleDecade(d)}
                            />
                            <span className="text-sm">{d}</span>
                          </label>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <Button
                data-testid="play-start"
                disabled={!canStart}
                onClick={handleStart}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 glow-purple py-6 text-lg font-semibold rounded-xl"
              >
                {isStarting ? "Starting…" : (<><Play className="w-5 h-5 mr-2" /> Start playing</>)}
              </Button>
            </div>
          </div>

          {/* MY DASHBOARD (secondary) */}
          <div className="glass rounded-2xl p-6 sm:p-8 border border-border/40 flex flex-col">
            <h2 className="font-display text-xl font-bold mb-1 flex items-center gap-2">
              <LayoutDashboard className="w-5 h-5 text-accent" /> MyDashboard
            </h2>
            <p className="text-muted-foreground text-sm mb-6">
              Already have an account? Jump to your stats, progress, and leaderboards.
            </p>
            <div className="flex-1" />
            <Button
              data-testid="mydashboard-btn"
              variant="outline"
              onClick={() => navigate("/welcome")}
              className="w-full border-border/60 hover:border-primary/50 py-5 rounded-xl"
            >
              Go to Dashboard →
            </Button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
```

> **Note on the genre test:** Radix `Select` renders options in a portal and may not expose `data-testid` items to a plain `.click()` without pointer setup. If `genre-opt-*` is not found in jsdom, switch the test to drive selection via the component's `onValueChange` by rendering with a controlled wrapper, OR replace the Radix `Select` with a native `<select data-testid="genre-trigger">` styled to match. Prefer the native `<select>` if the portal makes the test flaky — it is simpler and fully accessible. Keep the same `genre` state contract.

- [ ] **Step 4: Run tests; if genre portal is flaky, switch genre to native select**

Run: `pnpm test:client -- Interstitial`
Expected: PASS. If the genre option click fails due to Radix portal behavior in jsdom, refactor the Genre control to a native element:

```tsx
<select
  data-testid="genre-trigger"
  value={genre}
  onChange={(e) => setGenre(e.target.value)}
  className="mt-1 w-full glass rounded-md border border-border/40 px-3 py-2 text-sm"
>
  <option value="" disabled>Choose a genre</option>
  {GENRES.map((g) => <option key={g} value={g} data-testid={`genre-opt-${g}`}>{g}</option>)}
</select>
```
And in the test, select via: `fireEvent.change(screen.getByTestId("genre-trigger"), { target: { value: "Pop" } });` (replace the two genre lines in `selectGenreAndDecade`). Re-run until green.

- [ ] **Step 5: Run full client suite + typecheck**

Run: `pnpm test:client`
Expected: PASS
Run: `pnpm check`
Expected: no new type errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Interstitial.tsx client/src/pages/Interstitial.test.tsx
git commit -m "feat(home): Play Now form + guest/auth quick-start flow"
```

---

## Task 7: Client — post-game sign-up pre-fill + exit to welcome

**Files:**
- Modify: `client/src/pages/FinalResults.tsx` (guest conversion card ~line 226; Home button ~line 257)
- Modify: `client/src/pages/SignIn.tsx` (read `?email=` to pre-fill, ~line 30-32)
- Test: `client/src/pages/FinalResults.signup.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/pages/FinalResults.signup.test.tsx
import { describe, it, expect } from "vitest";
import { buildGuestSignupHref } from "./finalResultsSignup";

describe("buildGuestSignupHref", () => {
  it("pre-fills the captured email on the signup URL", () => {
    expect(buildGuestSignupHref("jamie@example.com"))
      .toBe("/signin?mode=signup&email=jamie%40example.com");
  });
  it("falls back to plain signup when no email", () => {
    expect(buildGuestSignupHref(null)).toBe("/signin?mode=signup");
    expect(buildGuestSignupHref("")).toBe("/signin?mode=signup");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:client -- FinalResults.signup`
Expected: FAIL — `Cannot find module './finalResultsSignup'`.

- [ ] **Step 3: Create the helper**

```ts
// client/src/pages/finalResultsSignup.ts
// Builds the signup URL for a guest, pre-filling the email captured at the
// interstitial. Mirrors getSignUpUrl() ("/signin?mode=signup") and appends
// the email when present.
export function buildGuestSignupHref(email: string | null): string {
  const base = "/signin?mode=signup";
  if (!email) return base;
  return `${base}&email=${encodeURIComponent(email)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:client -- FinalResults.signup`
Expected: PASS

- [ ] **Step 5: Use it in FinalResults**

In `client/src/pages/FinalResults.tsx`, add the import:

```ts
import { buildGuestSignupHref } from "./finalResultsSignup";
```

Near the top of the component (where `guestToken` is read, ~line 20), read the captured email:

```ts
const guestEmail = localStorage.getItem("lyricpro_guest_email");
```

Update the guest conversion card (replace the `<a href={getLoginUrl()}>` CTA at ~line 242-246) to pre-fill the email and add an exit-to-welcome action:

```tsx
<Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90 w-full">
  <a href={buildGuestSignupHref(guestEmail)}>
    <User className="w-4 h-4 mr-2" /> Create Free Account
  </a>
</Button>
<button
  onClick={() => navigate("/welcome")}
  className="mt-2 w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
>
  No thanks — exit to welcome
</button>
```

- [ ] **Step 6: Pre-fill email on the SignIn page**

In `client/src/pages/SignIn.tsx`, the component reads `?mode=signup` from `useSearch()` (~line 30). Initialize the email state from `?email=`:

```ts
// before
const [email, setEmail] = useState("");
// after
const [email, setEmail] = useState(() => new URLSearchParams(search).get("email") ?? "");
```

(`search` is already in scope from `const search = useSearch();` at ~line 25.)

- [ ] **Step 7: Run checks**

Run: `pnpm test:client -- FinalResults.signup`
Expected: PASS
Run: `pnpm test:client`
Expected: PASS (no regressions).
Run: `pnpm check`
Expected: no new type errors.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/FinalResults.tsx client/src/pages/finalResultsSignup.ts client/src/pages/FinalResults.signup.test.tsx client/src/pages/SignIn.tsx
git commit -m "feat(home): post-game signup pre-fills captured email + exit to welcome"
```

---

## Task 8: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: server + client suites PASS.

- [ ] **Step 2: Typecheck**

Run: `pnpm check`
Expected: clean.

- [ ] **Step 3: Manual smoke (dev server)**

Run: `pnpm dev`, then in a browser:
- `/` shows the interstitial with the floating note. Start is disabled until email + genre + ≥1 decade.
- Filling them and clicking Start lands on `/play/<code>` at question 1 with a **1:30** timer (90s), Low difficulty.
- Finishing the 3-round game shows the guest conversion card with the email pre-filled and an "exit to welcome" link.
- **MyDashboard** → `/welcome` shows the old landing page.
- Repeat while signed in: no email field; Start works; no guest session created.

- [ ] **Step 4: Security spot-check (per user's security-first rule)**

- Confirm `createGuestSession` email is validated server-side (`z.string().email()` — done in Task 2) and never echoed in logs.
- Confirm no secrets/PII added to client logs. The captured email lives only in `localStorage` + the guest row.

---

## Self-Review

**Spec coverage:** Routing swap (Task 5) ✓; NoteBackground3D (Task 4) ✓; Option-B layout + Play Now form single-genre/multi-decade/email-required (Task 6) ✓; guest→game flow low/90s/3-round solo (Task 6) ✓; authenticated path hides email/no guest (Task 6) ✓; timer cap 45→90 (Task 1) + mm:ss display (Task 3) ✓; guest_sessions.email lead capture (Task 2) ✓; post-game signup pre-fill + exit to welcome (Task 7) ✓; tests both layers (Tasks 1-7) + verification (Task 8) ✓.

**Type consistency:** `createGuestSession.mutateAsync({ email })` returns `{ token, nickname }` (Task 2 server ↔ Task 6 client). `createRoom` payload keys match the server zod input in `game.ts` (`mode, genres, decades, difficulty, timerSeconds, rounds, explicitFilter, guestToken`). `formatMMSS` (Task 3) used in Gameplay. `buildGuestSignupHref` (Task 7) consistent across helper/test/usage. localStorage keys `lyricpro_guest_token` / `lyricpro_guest_email` consistent between Task 6 (write) and Task 7 (read), and `lyricpro_guest_token` matches existing readers in Gameplay/RoundResults/FinalResults.

**Placeholder scan:** No TBD/TODO; every code step shows full code; the one conditional (Radix vs native `<select>`) gives complete code for both branches.
