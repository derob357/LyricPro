# Homepage Revert + Email Opt-in Implementation Plan (Project B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/` becomes the full welcome page again with the guest Play Now card embedded in the hero, plus a compliant unchecked marketing opt-in with consent audit storage on both guest and account paths.

**Architecture:** The interstitial's quick-start logic is extracted into a reusable `PlayNowCard` component that Home embeds in its hero (replacing the two CTA buttons). Consent is captured at three points — guest card, SignIn signup, ProfileCompletion — and stamped server-side (timestamp, wording version, source, IP) onto `guest_sessions` / `users` via hand-written migration 0019. The Interstitial page is retired; `/welcome` redirects to `/`.

**Tech Stack:** React + wouter, tRPC, Drizzle/Postgres (hand-written migrations ONLY — never `db:push`/`drizzle-kit generate`; the local `.env` DB **is prod**), vitest + Testing Library (`pnpm test:client`, `pnpm test:server`).

**Spec:** `docs/superpowers/specs/2026-06-10-homepage-email-optin-design.md`

**Branch:** cut `feat/homepage-email-optin` from `main` (NOT from `feat/gameplay-results-fixes` — Project A is in PR #2 and unmerged; no file overlap is expected except `Interstitial.test.tsx`, which this project deletes and A does not touch).

**Project conventions binding every task:** outline lucide icons only (no emoji); no `Co-Authored-By` trailers; subagents never read or echo `.env` values.

---

## Background for the implementer

- Current routing (`client/src/App.tsx:55-56`): `/` → `Interstitial`, `/welcome` → `Home`.
- `client/src/pages/Interstitial.tsx` (200 lines): guest quick-start — email (regex-gated, required for guests), genre `<select>`, decades multi-select popover, Start button → `createGuestSession` + `createRoom({mode:"solo", difficulty:"low", timerSeconds:90, rounds:3, explicitFilter:false})` → `/play/:roomCode`. Also a "MyDashboard" card (being dropped) and its own fixed nav.
- `client/src/pages/Home.tsx`: full welcome page. Hero buttons to replace are lines ~136-145 (`Play Now — Free to try` + `Host a Game`). `handlePlayNow`/`handleHostGame` (lines 28-42) open an auth dialog for unauthenticated users — the new card makes solo play guest-capable, so `handlePlayNow` becomes unused (delete it and the now-unused pieces; `handleHostGame` stays for the new outline button). Home has its own fixed nav (keep). Footer already links `/privacy` (line 323) — currently a 404.
- `server/routers/game.ts:116-137` `createGuestSession`: input `{nickname?, email?}`, IP-rate-limited, inserts into `guestSessions`.
- `drizzle/schema.ts:262-268` `guestSessions`, `:218+` `users`. Column style: camelCase quoted (e.g. `"sessionToken"`).
- Migrations: latest is `drizzle/0018_answer_method_mc.sql`; this project adds `0019`. Apply-script pattern: `scripts/apply-answer-method-mc-migration.mjs` (env-fallback chain, `postgres({max:1})`).
- Auth: `client/src/pages/SignIn.tsx` — signup is `?mode=signup` (line 30), submit button "Create account" (line ~335); flows: password, magic link (`trpc.auth.sendMagicLink`), OAuth (`supabase.auth.signInWithOAuth`, line ~150). Post-auth landing: `client/src/pages/AuthCallback.tsx`; OAuth first-timers hit `client/src/pages/ProfileCompletion.tsx` (`updateProfileMutation.mutate` at line 51). The tRPC auth router lives in `server/routers/` (find the file exporting `sendMagicLink` — likely `auth.ts`).
- Old test `client/src/pages/Interstitial.test.tsx` (mock pattern donor) is deleted in Task 5 after its assertions are ported to the new card tests in Task 2.

Consent wording (research delta D4, passes CAN-SPAM/GDPR/CASL) — version id `lp-optin-v1`:

> Yes, I'd like to receive tips, game updates, and promotions from LyricPro by email. Unsubscribe anytime.

---

### Task 1: Migration 0019 — consent audit columns

**Files:**
- Modify: `drizzle/schema.ts` (guestSessions + users)
- Create: `drizzle/0019_marketing_consent.sql`
- Create: `scripts/apply-marketing-consent-migration.mjs`

- [ ] **Step 1: Extend `drizzle/schema.ts`**

Append to the `guestSessions` pgTable (after `email`):

```typescript
  // Marketing consent audit (GDPR/CASL: timestamp + wording version + source + IP)
  marketingOptIn: boolean("marketingOptIn").default(false).notNull(),
  consentedAt: timestamp("consentedAt", { withTimezone: true }),
  consentWordingVersion: varchar("consentWordingVersion", { length: 32 }),
  consentSource: varchar("consentSource", { length: 64 }),
  consentIp: varchar("consentIp", { length: 45 }),
```

Append the IDENTICAL five columns to the `users` pgTable (after `email`). Check the file's existing imports — `boolean`, `timestamp`, `varchar` are already imported from drizzle-orm/pg-core.

- [ ] **Step 2: Write `drizzle/0019_marketing_consent.sql`**

```sql
-- 0019: marketing consent audit columns on guest_sessions + users.
-- Additive only; all columns nullable or defaulted, so safe on live tables.
ALTER TABLE guest_sessions
  ADD COLUMN IF NOT EXISTS "marketingOptIn" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "consentedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "consentWordingVersion" varchar(32),
  ADD COLUMN IF NOT EXISTS "consentSource" varchar(64),
  ADD COLUMN IF NOT EXISTS "consentIp" varchar(45);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "marketingOptIn" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "consentedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "consentWordingVersion" varchar(32),
  ADD COLUMN IF NOT EXISTS "consentSource" varchar(64),
  ADD COLUMN IF NOT EXISTS "consentIp" varchar(45);
```

- [ ] **Step 3: Write the apply script**

Copy `scripts/apply-answer-method-mc-migration.mjs` to `scripts/apply-marketing-consent-migration.mjs`; point it at `drizzle/0019_marketing_consent.sql`; this one CAN be wrapped in a transaction (plain ALTER TABLE) — wrap it (`BEGIN`/`COMMIT` via `sql.begin`) following whichever older apply script does transactional DDL (e.g. `apply-match-realtime-migration.mjs`).

- [ ] **Step 4: Verify table name**

Confirm in `drizzle/schema.ts` that the pgTable names are exactly `guest_sessions` and `users` (first argument of pgTable). Adjust SQL if they differ.

- [ ] **Step 5: typecheck + commit (do NOT run the migration — the controller applies it)**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

```bash
git add drizzle/schema.ts drizzle/0019_marketing_consent.sql scripts/apply-marketing-consent-migration.mjs
git commit -m "feat(consent): migration 0019 — marketing consent audit columns on guest_sessions + users"
```

---

### Task 2: PlayNowCard component (extraction + opt-in checkbox)

**Files:**
- Create: `client/src/components/PlayNowCard.tsx`
- Create: `client/src/components/PlayNowCard.test.tsx`
- Reference (do not modify yet): `client/src/pages/Interstitial.tsx`

- [ ] **Step 1: Write failing tests** (port assertions from `Interstitial.test.tsx`, same mock pattern)

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return { ...actual, useLocation: () => ["/", navigate] };
});
const authState = vi.hoisted(() => ({ value: { user: null as any, isAuthenticated: false } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => authState.value }));
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

import PlayNowCard from "./PlayNowCard";

function fillRequired() {
  fireEvent.change(screen.getByTestId("genre-trigger"), { target: { value: "Pop" } });
  fireEvent.click(screen.getByTestId("decade-trigger"));
  fireEvent.click(screen.getByTestId("decade-opt-1990–2000"));
}

describe("PlayNowCard", () => {
  beforeEach(() => {
    navigate.mockClear();
    createGuestSession.mutateAsync.mockReset().mockResolvedValue({ token: "guest-tok", nickname: "jamie" });
    createRoom.mutateAsync.mockReset().mockResolvedValue({ roomCode: "ROOM42" });
    authState.value = { user: null, isAuthenticated: false };
    localStorage.clear();
  });

  it("guest: requires email + genre + decade before Start enables; opt-in NOT required", () => {
    render(<PlayNowCard />);
    const start = screen.getByTestId("play-start") as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("email-input"), { target: { value: "jamie@example.com" } });
    fillRequired();
    expect(start.disabled).toBe(false); // checkbox untouched — still startable
  });

  it("guest: opt-in checkbox is UNCHECKED by default and passes false", async () => {
    render(<PlayNowCard />);
    fireEvent.change(screen.getByTestId("email-input"), { target: { value: "jamie@example.com" } });
    fillRequired();
    fireEvent.click(screen.getByTestId("play-start"));
    await waitFor(() => expect(createGuestSession.mutateAsync).toHaveBeenCalled());
    expect(createGuestSession.mutateAsync).toHaveBeenCalledWith({
      email: "jamie@example.com",
      marketingOptIn: false,
      consentSource: "home-play-card",
    });
  });

  it("guest: checking opt-in passes true", async () => {
    render(<PlayNowCard />);
    fireEvent.change(screen.getByTestId("email-input"), { target: { value: "jamie@example.com" } });
    fireEvent.click(screen.getByTestId("optin-checkbox"));
    fillRequired();
    fireEvent.click(screen.getByTestId("play-start"));
    await waitFor(() => expect(createGuestSession.mutateAsync).toHaveBeenCalled());
    expect(createGuestSession.mutateAsync.mock.calls[0][0].marketingOptIn).toBe(true);
  });

  it("guest flow: quick-start config preserved + navigate", async () => {
    render(<PlayNowCard />);
    fireEvent.change(screen.getByTestId("email-input"), { target: { value: "jamie@example.com" } });
    fillRequired();
    fireEvent.click(screen.getByTestId("play-start"));
    await waitFor(() => expect(createRoom.mutateAsync).toHaveBeenCalled());
    expect(localStorage.getItem("lyricpro_guest_token")).toBe("guest-tok");
    expect(createRoom.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      mode: "solo", genres: ["Pop"], decades: ["1990–2000"],
      difficulty: "low", timerSeconds: 90, rounds: 3, explicitFilter: false, guestToken: "guest-tok",
    }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/play/ROOM42"));
  });

  it("authenticated: no email field, no opt-in checkbox, no guest session", async () => {
    authState.value = { user: { id: "u1" }, isAuthenticated: true };
    render(<PlayNowCard />);
    expect(screen.queryByTestId("email-input")).toBeNull();
    expect(screen.queryByTestId("optin-checkbox")).toBeNull();
    fillRequired();
    fireEvent.click(screen.getByTestId("play-start"));
    await waitFor(() => expect(createRoom.mutateAsync).toHaveBeenCalled());
    expect(createGuestSession.mutateAsync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** `pnpm test:client -- PlayNowCard.test.tsx` — FAIL (module missing).

- [ ] **Step 3: Implement `client/src/components/PlayNowCard.tsx`**

Extract from `Interstitial.tsx` lines 19-176 (state, handleStart, the PLAY NOW card JSX — NOT the nav, NOT the MyDashboard card, NOT NoteBackground3D). Changes from the original:

```tsx
import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Play, ChevronDown } from "lucide-react";
import { toast } from "sonner";

const GENRES = ["Country", "Hip Hop", "R&B", "Pop", "Rock", "Gospel", "Soul", "Jazz", "Blues", "Alternative", "Reggae", "Mixed"];
const DECADES = ["1940–1950", "1950–1960", "1960–1970", "1970–1980", "1980–1990", "1990–2000", "2000–2010", "2010–2020", "2020–Present"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Must match CONSENT_WORDING_VERSION in server/_core/consent.ts — bump both together.
const CONSENT_SOURCE = "home-play-card";

export default function PlayNowCard() {
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();

  const [email, setEmail] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
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
        const guest = await createGuestSession.mutateAsync({
          email,
          marketingOptIn,
          consentSource: CONSENT_SOURCE,
        });
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
    <div className="glass-strong rounded-2xl p-6 sm:p-8 border border-primary/20 max-w-xl mx-auto text-left">
      <h2 className="font-display text-2xl font-bold mb-1 flex items-center gap-2">
        <Play className="w-5 h-5 text-primary" /> Play Now
      </h2>
      <p className="text-muted-foreground text-sm mb-5">
        {isAuthenticated ? "Pick a genre and decade — straight into the game." : "No sign-up needed. Drop your email, pick a vibe, and play."}
      </p>

      <div className="space-y-4">
        {!isAuthenticated && (
          <div>
            <label htmlFor="play-email" className="text-xs uppercase tracking-wide text-muted-foreground">Email</label>
            <Input
              id="play-email"
              data-testid="email-input"
              type="email"
              inputMode="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1"
            />
            <label className="mt-2 flex items-start gap-2 cursor-pointer">
              <Checkbox
                data-testid="optin-checkbox"
                checked={marketingOptIn}
                onCheckedChange={(v) => setMarketingOptIn(v === true)}
                className="mt-0.5"
              />
              <span className="text-xs text-muted-foreground leading-snug">
                Yes, I'd like to receive tips, game updates, and promotions from LyricPro by email.
                Unsubscribe anytime. <a href="/privacy" className="underline hover:text-foreground">Privacy Policy</a>
              </span>
            </label>
          </div>
        )}

        {/* genre <select> + decades Popover: copy VERBATIM from Interstitial.tsx lines 123-165
            (same data-testids: genre-trigger, genre-opt-*, decade-trigger, decade-opt-*) */}

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
  );
}
```

(The genre/decades block comment above is an instruction to copy the existing JSX verbatim — do that, don't leave the comment in.)

- [ ] **Step 4: Run** `pnpm test:client -- PlayNowCard.test.tsx` — all 5 PASS. (`tsc --noEmit` will fail until Task 3 extends the server input — if so, note it and proceed; the type error is resolved in Task 3. If the repo's tRPC client types block the test run itself, do Task 3's server-side input change FIRST in this same task and fold it into this commit, reporting the resequencing.)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/PlayNowCard.tsx client/src/components/PlayNowCard.test.tsx
git commit -m "feat(home): extract PlayNowCard with marketing opt-in checkbox"
```

---

### Task 3: Server consent capture (createGuestSession + setMarketingConsent)

**Files:**
- Create: `server/_core/consent.ts`
- Modify: `server/routers/game.ts:116-137` (createGuestSession)
- Modify: the auth tRPC router (file exporting `sendMagicLink` — likely `server/routers/auth.ts`)
- Test: `server/consent.test.ts`

- [ ] **Step 1: Write failing test for the consent stamp helper**

`server/consent.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildConsentStamp, CONSENT_WORDING_VERSION } from "./_core/consent";

describe("buildConsentStamp", () => {
  it("opted in: stamps version, source, ip, and a consentedAt date", () => {
    const s = buildConsentStamp(true, "home-play-card", "1.2.3.4");
    expect(s.marketingOptIn).toBe(true);
    expect(s.consentWordingVersion).toBe(CONSENT_WORDING_VERSION);
    expect(s.consentSource).toBe("home-play-card");
    expect(s.consentIp).toBe("1.2.3.4");
    expect(s.consentedAt).toBeInstanceOf(Date);
  });

  it("not opted in: opt-in false and ALL audit fields null (no data hoarding)", () => {
    const s = buildConsentStamp(false, "home-play-card", "1.2.3.4");
    expect(s).toEqual({
      marketingOptIn: false,
      consentedAt: null,
      consentWordingVersion: null,
      consentSource: null,
      consentIp: null,
    });
  });

  it("clamps source length and tolerates missing ip", () => {
    const s = buildConsentStamp(true, "x".repeat(100), undefined);
    expect(s.consentSource!.length).toBeLessThanOrEqual(64);
    expect(s.consentIp).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `pnpm test:server -- consent.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement `server/_core/consent.ts`**

```typescript
/** Marketing-consent audit stamping (research delta D4).
 *  Version id must match the wording rendered by the client checkboxes
 *  (PlayNowCard, SignIn, ProfileCompletion). Bump when the wording changes:
 *  "Yes, I'd like to receive tips, game updates, and promotions from
 *   LyricPro by email. Unsubscribe anytime."
 */
export const CONSENT_WORDING_VERSION = "lp-optin-v1";

export interface ConsentStamp {
  marketingOptIn: boolean;
  consentedAt: Date | null;
  consentWordingVersion: string | null;
  consentSource: string | null;
  consentIp: string | null;
}

export function buildConsentStamp(
  optIn: boolean,
  source: string | undefined,
  ip: string | undefined | null,
): ConsentStamp {
  if (!optIn) {
    return {
      marketingOptIn: false,
      consentedAt: null,
      consentWordingVersion: null,
      consentSource: null,
      consentIp: null,
    };
  }
  return {
    marketingOptIn: true,
    consentedAt: new Date(),
    consentWordingVersion: CONSENT_WORDING_VERSION,
    consentSource: (source ?? "unknown").slice(0, 64),
    consentIp: ip ? ip.slice(0, 45) : null,
  };
}
```

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Wire into createGuestSession** (`server/routers/game.ts:116-137`)

Input gains:

```typescript
      marketingOptIn: z.boolean().default(false),
      consentSource: z.string().max(64).optional(),
```

Insert becomes:

```typescript
      await db.insert(guestSessions).values({
        sessionToken: token,
        nickname,
        email: input.email ?? null,
        ...buildConsentStamp(input.marketingOptIn, input.consentSource, ctx.req.ip),
      });
```

(import `buildConsentStamp` from `../_core/consent`). IP comes from `ctx.req.ip` server-side — NEVER from client input.

- [ ] **Step 6: Add `setMarketingConsent` to the auth router**

Locate the auth router (exports `sendMagicLink`). Add a `protectedProcedure`:

```typescript
  setMarketingConsent: protectedProcedure
    .input(z.object({
      optIn: z.boolean(),
      source: z.string().max(64),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.update(users)
        .set(buildConsentStamp(input.optIn, input.source, ctx.req.ip))
        .where(eq(users.id, ctx.user.id));
      return { ok: true };
    }),
```

Match the file's existing imports/idioms (`getDb`, `users`, `eq`, `protectedProcedure`). Note: calling with `optIn:false` clears all audit fields — that's the withdrawal path, intended.

- [ ] **Step 7:** `pnpm test:server` + `pnpm exec tsc --noEmit` — green (this also resolves Task 2's pending client type error if any).

- [ ] **Step 8: Commit**

```bash
git add server/_core/consent.ts server/consent.test.ts server/routers/game.ts server/routers/auth.ts
git commit -m "feat(consent): stamp marketing consent on guest sessions; setMarketingConsent for accounts"
```

(adjust the auth router path in `git add` to the real filename.)

---

### Task 4: Home hero — embed PlayNowCard + Host a Game

**Files:**
- Modify: `client/src/pages/Home.tsx`
- Test: `client/src/pages/Home.hero.test.tsx` (create)

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return { ...actual, useLocation: () => ["/", navigate] };
});
const authState = vi.hoisted(() => ({ value: { user: null as any, isAuthenticated: false } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => authState.value }));
// PlayNowCard has its own test file — stub it here.
vi.mock("@/components/PlayNowCard", () => ({
  __esModule: true,
  default: () => <div data-testid="play-now-card" />,
}));
// Home pulls several data components; stub the heavy ones if render fails and report.
vi.mock("@/lib/trpc", () => ({ trpc: {} }));

import Home from "./Home";

describe("Home hero", () => {
  beforeEach(() => { navigate.mockClear(); authState.value = { user: null, isAuthenticated: false }; });

  it("renders the PlayNowCard in the hero and no old CTA buttons", () => {
    render(<Home />);
    expect(screen.getByTestId("play-now-card")).toBeTruthy();
    expect(screen.queryByText(/Play Now — Free to try/)).toBeNull();
  });

  it("Host a Game button sits below the card; unauthenticated click opens auth dialog", () => {
    render(<Home />);
    const host = screen.getByRole("button", { name: /Host a Game/i });
    fireEvent.click(host);
    // unauthenticated → auth dialog opens (existing handleHostGame behavior)
    expect(screen.getByText(/sign/i)).toBeTruthy();
  });
});
```

(If `vi.mock("@/lib/trpc", ...)` as empty object breaks Home's other sections (WeaknessPackCard etc. consume trpc), stub those components instead — `vi.mock("@/components/WeaknessPackCard", ...)`, `vi.mock("@/components/SuggestionCard", ...)` — and give trpc the minimal hooks the page itself calls. Reconcile from the error messages and report what was needed. If the auth-dialog assertion text is wrong, read the Dialog content in Home.tsx (~`authOpen`) and assert its real title.)

- [ ] **Step 2: Run** — FAIL (card not present).

- [ ] **Step 3: Implement in Home.tsx**

Replace lines ~136-145 (the two hero buttons inside `<motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-4 justify-center items-center">`) with:

```tsx
            <motion.div variants={fadeUp} className="w-full">
              <PlayNowCard />
              <div className="flex justify-center mt-4">
                <Button size="lg" variant="outline" onClick={handleHostGame}
                  className="border-border/60 hover:border-primary/50 hover:bg-primary/5 px-8 py-5 text-base font-semibold rounded-xl">
                  <Users className="w-5 h-5 mr-2" /> Host a Game
                </Button>
              </div>
            </motion.div>
```

Add `import PlayNowCard from "@/components/PlayNowCard";`. Delete `handlePlayNow` (lines 28-34) — the nav "Play Free" button (line ~96-99) that referenced it should navigate to the card instead: change its onClick to scroll/no-op is overdesign — simplest correct behavior: keep the button but `onClick={() => document.getElementById("play-now-anchor")?.scrollIntoView({ behavior: "smooth" })}` with `id="play-now-anchor"` on the hero card wrapper div. Keep `handleHostGame` and the `authOpen` dialog as-is.

- [ ] **Step 4: Run test file, then full** `pnpm test:client` + `pnpm exec tsc --noEmit` — green.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/Home.tsx client/src/pages/Home.hero.test.tsx
git commit -m "feat(home): Play Now card replaces hero CTAs; Host a Game moves below card"
```

---

### Task 5: Routing — / is Home, /welcome redirects, Interstitial retired

**Files:**
- Modify: `client/src/App.tsx:55-56`
- Delete: `client/src/pages/Interstitial.tsx`, `client/src/pages/Interstitial.test.tsx`

- [ ] **Step 1: App.tsx**

```tsx
      <Route path="/" component={Home} />
      <Route path="/welcome">{() => <Redirect to="/" />}</Route>
```

`Redirect` is already used in App.tsx (line 77 pattern `<Redirect to=... />`) — confirm it's imported from wouter; remove the `Interstitial` import.

- [ ] **Step 2: Delete the files**

```bash
git rm client/src/pages/Interstitial.tsx client/src/pages/Interstitial.test.tsx
```

(Confirm nothing else imports Interstitial first: `grep -rn "Interstitial" client/src --include="*.tsx" --include="*.ts"` — App.tsx should be the only hit, already fixed.)

- [ ] **Step 3: Check the guest redirect in GameSetup** (`client/src/pages/GameSetup.tsx` ~line 48): it redirects guests to `/` — still correct (now lands on Home with the card). No change; just verify and note.

- [ ] **Step 4:** `pnpm test:client` + `pnpm exec tsc --noEmit` — green (Interstitial tests are gone; PlayNowCard tests cover the behavior).

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat(routing): / is the welcome page again; /welcome redirects; interstitial retired"
```

---

### Task 6: Signup consent — SignIn checkbox + ProfileCompletion + AuthCallback relay

**Files:**
- Modify: `client/src/pages/SignIn.tsx`
- Modify: `client/src/pages/AuthCallback.tsx`
- Modify: `client/src/pages/ProfileCompletion.tsx`
- Test: extend an existing SignIn test file if present (`SignIn.apple-scope.test.tsx` exists — create `SignIn.optin.test.tsx` instead, same mock pattern)

Relay design: signup may complete in a different page-load (magic link, OAuth redirect), so the checkbox state can't ride the auth call. Persist intent in `localStorage["lyricpro_pending_optin"]` (value = consent source string), then after authentication `AuthCallback` calls `auth.setMarketingConsent` and clears the key. ProfileCompletion ALSO shows the checkbox (OAuth users may never have seen SignIn's form) pre-seeded from the pending key.

- [ ] **Step 1: SignIn.tsx** — in the `isSignUp` form, directly above the "Create account" submit button, add state + checkbox:

```tsx
  const [marketingOptIn, setMarketingOptIn] = useState(false);
```

```tsx
              {isSignUp && (
                <label className="flex items-start gap-2 cursor-pointer">
                  <Checkbox
                    data-testid="signup-optin"
                    checked={marketingOptIn}
                    onCheckedChange={(v) => {
                      const on = v === true;
                      setMarketingOptIn(on);
                      if (on) localStorage.setItem("lyricpro_pending_optin", "signup-form");
                      else localStorage.removeItem("lyricpro_pending_optin");
                    }}
                    className="mt-0.5"
                  />
                  <span className="text-xs text-muted-foreground leading-snug">
                    Yes, I'd like to receive tips, game updates, and promotions from LyricPro by email.
                    Unsubscribe anytime. <a href="/privacy" className="underline hover:text-foreground">Privacy Policy</a>
                  </span>
                </label>
              )}
```

(import Checkbox from "@/components/ui/checkbox" if absent.) Setting the key on toggle (not on submit) covers all three auth flows without touching each handler.

- [ ] **Step 2: AuthCallback.tsx** — read the file first. After the session is established and before the final navigate, add:

```typescript
      const pendingOptIn = localStorage.getItem("lyricpro_pending_optin");
      if (pendingOptIn) {
        try {
          await setMarketingConsent.mutateAsync({ optIn: true, source: pendingOptIn });
        } catch {
          /* consent write must never block login */
        }
        localStorage.removeItem("lyricpro_pending_optin");
      }
```

with `const setMarketingConsent = trpc.auth.setMarketingConsent.useMutation();` — adapt placement to the file's real flow (it may use useEffect + async fn).

- [ ] **Step 3: ProfileCompletion.tsx** — add the same checkbox (same wording, `data-testid="completion-optin"`), default `useState(!!localStorage.getItem("lyricpro_pending_optin"))`. In the save handler (~line 51), after `updateProfileMutation.mutate(...)` succeeds (or alongside), call `setMarketingConsent.mutateAsync({ optIn: marketingOptIn, source: "profile-completion" })` in a try/catch that never blocks profile save; clear the pending key.

- [ ] **Step 4: Test** `client/src/pages/SignIn.optin.test.tsx` — mock pattern from `SignIn.apple-scope.test.tsx` (read it; reuse its trpc/supabase mocks). Two tests:

```typescript
  it("signup mode shows the unchecked opt-in; toggling sets the pending key", () => {
    // render with ?mode=signup (mock useSearch / location accordingly per the existing test file's pattern)
    const box = screen.getByTestId("signup-optin");
    expect((box as HTMLInputElement).getAttribute("data-state")).toBe("unchecked");
    fireEvent.click(box);
    expect(localStorage.getItem("lyricpro_pending_optin")).toBe("signup-form");
    fireEvent.click(box);
    expect(localStorage.getItem("lyricpro_pending_optin")).toBeNull();
  });

  it("sign-in mode (no ?mode=signup) shows NO opt-in checkbox", () => {
    expect(screen.queryByTestId("signup-optin")).toBeNull();
  });
```

(Radix Checkbox renders a button with `data-state` — adjust the unchecked assertion to the real DOM; the localStorage assertions are the contract.)

- [ ] **Step 5:** `pnpm test:client` + `pnpm exec tsc --noEmit` — green.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/SignIn.tsx client/src/pages/AuthCallback.tsx client/src/pages/ProfileCompletion.tsx client/src/pages/SignIn.optin.test.tsx
git commit -m "feat(consent): signup opt-in checkbox with post-auth relay (SignIn, AuthCallback, ProfileCompletion)"
```

---

### Task 7: Minimal /privacy page

**Files:**
- Create: `client/src/pages/Privacy.tsx`
- Modify: `client/src/App.tsx` (add route)

The Home footer and all three consent checkboxes link `/privacy`, which currently 404s. Ship a minimal honest page; **flag in your report that the copy needs Deric's/legal review before any marketing send.**

- [ ] **Step 1: `client/src/pages/Privacy.tsx`**

```tsx
import { Music } from "lucide-react";

export default function Privacy() {
  return (
    <div className="min-h-screen text-foreground">
      <div className="container max-w-2xl py-16 space-y-6">
        <div className="flex items-center gap-2">
          <Music className="w-5 h-5 text-primary" />
          <h1 className="font-display text-3xl font-bold">Privacy Policy</h1>
        </div>
        <p className="text-muted-foreground text-sm">Last updated: June 10, 2026</p>
        <section className="space-y-3 text-sm leading-relaxed">
          <h2 className="font-semibold text-lg">What we collect</h2>
          <p>
            When you play as a guest we collect your email address to provide game access.
            When you create an account we store your profile details and gameplay statistics.
          </p>
          <h2 className="font-semibold text-lg">Marketing email</h2>
          <p>
            We only send tips, game updates, and promotions if you explicitly check the opt-in box.
            We record when you consented, the wording you saw, and the form you used, so we can honor
            your choice. You can unsubscribe at any time via the link in any email, and withdrawing
            consent stops marketing email without affecting your account.
          </p>
          <h2 className="font-semibold text-lg">What we don't do</h2>
          <p>We don't sell your personal information.</p>
          <h2 className="font-semibold text-lg">Contact</h2>
          <p>Questions about your data? Email support@playlyricpro.com.</p>
        </section>
      </div>
    </div>
  );
}
```

(Verify the support email — grep the repo for an existing support/contact address and use that one; if none exists, leave this and flag it.)

- [ ] **Step 2: Route in App.tsx** (alongside other public routes):

```tsx
      <Route path="/privacy" component={Privacy} />
```

- [ ] **Step 3:** `pnpm test:client` + `pnpm exec tsc --noEmit` — green.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Privacy.tsx client/src/App.tsx
git commit -m "feat(legal): minimal /privacy page backing the consent checkbox links"
```

---

### Task 8: Full verification

- [ ] **Step 1:** `pnpm exec tsc --noEmit && pnpm test` — all green; paste counts.
- [ ] **Step 2: Manual smoke (controller/user):** `/` shows welcome hero with embedded card; guest start works end-to-end; `/welcome` redirects; opt-in row absent when signed in; `/privacy` renders; signup form shows checkbox only in `?mode=signup`.
- [ ] **Step 3: Report** any deviations, the consent-source values used (`home-play-card`, `signup-form`, `profile-completion`), and the legal-review flag for the privacy copy.

---

## Self-review notes (already applied)

- Spec coverage: routing+hero (Tasks 4-5), email required unchanged (PlayNowCard keeps the gate), opt-in checkbox guest+signup (Tasks 2, 6), consent audit columns + server stamping (Tasks 1, 3), interstitial retired + `/welcome` redirect (Task 5), privacy link target (Task 7 — spec implied a working link; the page is the minimal honest backing).
- Migration 0019 is applied by the CONTROLLER (not the implementer subagent), same protocol as 0018.
- `consentIp` stored only when opted in (data minimization) — buildConsentStamp guarantees it.
- Type consistency: `buildConsentStamp` return shape matches the five schema columns exactly; client sends `marketingOptIn`/`consentSource`, server stamps the rest.
