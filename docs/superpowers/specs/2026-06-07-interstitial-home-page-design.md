# Interstitial Home Page — Design Spec

**Date:** 2026-06-07
**Project:** LyricPro Ai
**Status:** Approved (design) — pending implementation plan

## Goal

Replace the marketing landing page at `/` with a lightweight **interstitial** that presents a
returning visitor with two clear choices over a blown-up 3D golden-note background:

1. **MyDashboard** — go to the existing welcome/landing page.
2. **Play Now** — capture an email, pick a genre and decade(s), and drop the visitor
   straight into question 1 of a default 3-round solo game with no setup screen.

The existing visual language (dark purple/black canvas, glass cards, gold/purple glow) is preserved.

## Decisions (locked)

| # | Decision |
|---|----------|
| 1 | **MyDashboard** routes to the **old landing page** (current `Home.tsx`), moved to `/welcome`. Not `/dashboard`. |
| 2 | **Play Now email** is **lead capture + guest identity**: store the email, mint a lightweight guest session so anyone plays instantly without signing in. |
| 3 | **Genre** = single-select dropdown. **Decade(s)** = multi-select dropdown. |
| 4 | **Default game:** Solo · 3 rounds · **Low** difficulty · **90s** timer · Clean Mode off. |
| 5 | **Authenticated users:** email field hidden; play uses their account (no guest session). |
| 6 | **Email is required** to start a game (Start disabled until a valid email is present). |
| 7 | **Background:** CSS-driven blown-up `golden-note.svg` (perspective + rotate3d + float + mouse parallax). No WebGL / new deps. |
| 8 | **Layout:** Option B — Play Now is the primary (wider) card; MyDashboard is the secondary (narrower) card. |
| 9 | **Post-game (guests):** prompt to sign up using the captured email, or exit to `/welcome`. |

## Routing

- `/` → new `Interstitial.tsx`.
- `/welcome` → current `Home.tsx` content (moved; content unchanged). MyDashboard → `/welcome`.
- Audit every `navigate("/")` call site. Sites that meant "go to marketing home" that should now
  land on the welcome page are repointed to `/welcome`; sites that just mean "leave the game / go to
  the entry point" stay on `/` (the interstitial). Explicit per-site decisions in the plan.
- Guest **post-game exit** → `/welcome`.

## Components

### `NoteBackground3D` (new, reusable)
- Fixed, full-bleed, `pointer-events:none`, sits behind page content (`z-index` below cards).
- Renders the existing `public/brand/golden-note.svg` scaled large and centered, low opacity,
  with a soft radial gold/purple glow halo.
- Motion: CSS `perspective` + `rotate3d` tilt, slow float keyframe loop, subtle mouse-parallax
  (translate on pointer move).
- **Accessibility:** under `prefers-reduced-motion: reduce`, disable float + parallax (static tilt only).

### `Interstitial.tsx` (new, route `/`)
- Slim top nav matching current Home (brand + Leaderboards / Shop / Sign In).
- `<NoteBackground3D />` behind two glass cards.
- **Play Now card** (primary, wider) — see Play Now form below.
- **MyDashboard card** (secondary, narrower) — short blurb + "Go to Dashboard →" button → `/welcome`.
- Responsive: cards stack on mobile, Play Now first.

### Play Now form
Fields (canonical lists reused from `GameSetup.tsx` for backend compatibility):
- **Email** — text input, required, basic email-format validation. **Hidden when authenticated**
  (uses account instead).
- **Genre** — single-select dropdown. Options = `GameSetup` `GENRES`:
  `Country, Hip Hop, R&B, Pop, Rock, Gospel, Soul, Jazz, Blues, Alternative, Reggae, Mixed`.
- **Decade(s)** — multi-select dropdown. Options = `GameSetup` `DECADES`:
  `1940–1950 … 2020–Present`.
- **Start** button — disabled until: (valid email OR authenticated) AND genre selected AND ≥1 decade.
  Shows "Starting…" while the room is being created.

## Core flow — Play Now → question 1

**Guest (unauthenticated):**
1. `game.createGuestSession({ email })` → `{ token }`. Server derives a nickname from the email
   local-part and persists the email (lead capture).
2. Client stores `localStorage["lyricpro_guest_token"] = token` and `localStorage["lyricpro_guest_email"] = email`.
3. `game.createRoom({ mode:"solo", genres:[genre], decades, difficulty:"low", timerSeconds:90, rounds:3, explicitFilter:false, guestToken: token })`.
4. `navigate("/play/{roomCode}")` → Gameplay question 1. **GameSetup is bypassed entirely.**

**Authenticated:**
- Same as above minus steps 1–2 (no guest token; `createRoom` uses the authenticated context).

> Note: `createGuestSession` and `lyricpro_guest_token` are currently **dormant** — nothing in the
> client mints a guest session today, though Gameplay / RoundResults / FinalResults already *read*
> the token. This interstitial becomes the first writer. Backend guest support already exists.

## Post-game sign-up prompt (`FinalResults.tsx`)

- Enhance the existing `{!isAuthenticated}` "Save Your Score!" card:
  - Pre-fill the captured email (`localStorage["lyricpro_guest_email"]`).
  - Primary CTA → sign-up with the email pre-populated (passed to our SignIn/SignUp entry).
  - Add a secondary **"Exit to welcome"** action → `/welcome`.
- Authenticated users: unchanged.

## Backend changes

### D1 — Timer cap
- `game.createRoom` input: raise `timerSeconds` max from `45` → `90` (zod). Keep min `15`.
- Verify the Gameplay timer bar renders correctly at 90s (it is percentage-based; expected fine —
  confirm during implementation).

### D2 — Guest email lead capture
- Add nullable `email` column (`varchar`) to `guest_sessions` (drizzle migration).
- Extend `game.createGuestSession` input to accept `{ nickname?: string; email?: string }`:
  - If `email` given and `nickname` absent, derive nickname from the email local-part.
  - Persist `email` on the row.
- **Single-Supabase caveat:** running the migration from a laptop applies to **production**.
  The change is additive + nullable, so it is safe to apply to prod.

## Testing

**Client**
- Interstitial renders with both cards and the background component.
- Start is disabled until validation passes (email required for guests; genre + ≥1 decade).
- Guest flow calls `createGuestSession` then `createRoom` with
  `mode:"solo", difficulty:"low", timerSeconds:90, rounds:3, genres:[genre]` and navigates to `/play/:roomCode`.
- Authenticated flow skips `createGuestSession` and hides the email field.
- MyDashboard navigates to `/welcome`.

**Server**
- `createRoom` accepts `timerSeconds:90`.
- `createGuestSession` persists the email and derives a nickname when only email is supplied.
- Existing game/guest tests remain green.

## Out of scope

- Multiplayer / team / remote-live from the interstitial (Play Now is solo-only here).
- Redesigning the `/welcome` (old Home) content.
- Any change to scoring, song selection, or Gameplay internals beyond the 90s timer verification.

## Files (anticipated)

- **New:** `client/src/pages/Interstitial.tsx`, `client/src/components/NoteBackground3D.tsx`.
- **Moved:** `client/src/pages/Home.tsx` → served at `/welcome`.
- **Edited:** `client/src/App.tsx` (routes), `client/src/pages/FinalResults.tsx` (email pre-fill + exit),
  `server/routers/game.ts` (timer cap + guest email), `drizzle/schema.ts` + new migration
  (`guest_sessions.email`), plus `navigate("/")` audit fixes.
