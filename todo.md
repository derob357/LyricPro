# LyricPro Ai - TODO

## Phase 2: Database Schema & Design System
- [x] Database schema (songs, game_rooms, room_players, teams, game_sessions, round_results, artist_metadata, guest_sessions)
- [x] Global CSS design system (dark mode, OKLCH colors, Space Grotesk + Inter fonts, glow effects)
- [x] App.tsx routing structure with all pages registered

## Phase 3: Landing Page & Navigation
- [x] Landing page hero section with tagline and CTAs
- [x] How It Works section
- [x] Scoring breakdown section (point system display)
- [x] Game modes section (solo, turn-based, team, remote live)
- [x] Navigation header with auth state
- [x] Footer

## Phase 4: Game Setup, Lobby & Onboarding
- [x] Guest play modal (nickname entry, localStorage token)
- [x] Game setup screen (mode, genre, decade, difficulty, timer, rounds, ranking mode)
- [x] Multiplayer lobby (room code, invite link, player list, team assignment, ready state)

## Phase 5: Gameplay Engine
- [x] Lyric prompt display with countdown timer
- [x] Typed answer input (lyric, artist, year fields)
- [x] Voice-to-text input support (Web Speech API)
- [x] Pass-to-next-player logic
- [x] Turn-based rotation engine
- [x] Live score updates
- [x] Fuzzy lyric matching (ignore caps, punctuation, spaces, levenshtein)
- [x] Artist alias matching
- [x] Year proximity scoring (exact=20, ±2=10, ±3=5)
- [x] Scoring engine (lyric=10, artist=10, year proximity)
- [x] Streak bonus and speed bonus modes

## Phase 6: Results Screens
- [x] Round results screen (correct answers, score breakdown)
- [x] Artist info links (official site, Instagram, Facebook, X, TikTok, YouTube, Spotify, Apple Music, news)
- [x] Final results screen (winner, rankings, total scores)
- [x] Save score CTA and guest-to-account conversion prompt
- [x] Rematch / replay option

## Phase 7: Profile & Leaderboards
- [x] Profile/stats page (lifetime score, rank tier, games played, wins)
- [x] Rank tier progression display with progress bar
- [x] Recent game history
- [x] Leaderboards page (solo, multiplayer, team filters)
- [x] Genre-specific and decade-specific leaderboard views
- [x] Weekly and all-time timeframe filters

## Phase 8: Content & Delivery
- [x] Seed song content database (46 songs across R&B, Hip Hop, Pop, Rock, Country, Gospel, Soul, Jazz)
- [x] Artist metadata (16 artists with social/streaming/news links)
- [x] All routes wired in App.tsx
- [x] Vitest unit tests for scoring engine and fuzzy matching (33 tests passing)
- [x] Final checkpoint

## Scoring & Celebration Upgrades
- [x] Lyric partial credit: near-miss (missing 1-2 words) = 5 pts, full match = 10 pts
- [x] Featured artist handling: primary-only answer on "Artist ft. X" = 8 pts
- [x] First-name-only artist match: "Kanye" matches "Kanye West" = full 10 pts
- [x] 3-level celebration component (particles/confetti/fireworks)
- [x] Level 1 celebration: subtle floating particles + chime sound
- [x] Level 2 celebration: confetti shower + applause sound
- [x] Level 3 celebration: full-screen fireworks + fanfare sound
- [x] Mute toggle for celebration audio (persisted in localStorage)
- [x] Celebration triggers after answer reveal in Gameplay
- [x] Update scoring tests to cover new partial credit and artist matching rules

## Future Enhancements
- [ ] Admin dashboard for content management
- [ ] More song content (500+ songs target)
- [ ] Team alternation logic (advanced)
- [ ] Favorite genre and strongest decade auto-detection
- [ ] Streak history chart
- [ ] Premium subscription tier

## Song Library Expansion
- [ ] Generate 500+ R&B songs with lyric prompts (1970s-2020s)
- [ ] Generate 500+ Hip Hop songs with lyric prompts (1980s-2020s)
- [ ] Seed expanded library into database
- [ ] Verify 500+ total songs in DB
- [ ] Update artist metadata for new artists

## Celebration UX Fix
- [x] Click/tap anywhere on celebration to dismiss it immediately
- [x] Show "Tap anywhere to continue" prompt on celebration overlay
- [x] Wire Next Round button visible during/after celebration
- [x] Auto-dismiss celebration after fixed duration (level 1: 3s, level 2: 4s, level 3: 5s)

## Navigation / Exit Fix
- [x] Add quit button to Gameplay header (X or menu icon)
- [x] Add confirmation dialog before quitting mid-game
- [x] Add quit/exit button to RoundResults screen header
- [x] Navigate to home screen on confirmed quit

## Batch 6 Changes (Apr 3 2026)
- [x] Low difficulty: show full lyric, player guesses Artist (25pts) + Title (25pts) + Year (50pts)
- [x] Medium difficulty: show full lyric, player guesses Artist (50pts) + Title (50pts) + Year (100pts)
- [x] High difficulty: show partial lyric, player guesses Lyric (50pts) + Artist (100pts) + Title (100pts) + Year (200pts)
- [x] Update point system display on home page and scoring breakdown
- [x] Update scoring engine and server router for new point values
- [x] Fix second player lobby join: show nickname entry before joining room
- [x] Add Sign In / Sign Up buttons to nav
- [x] Add Logout button to nav when authenticated
- [x] Add password reset capability
- [x] Fix decade filtering: SQL query must filter by decadeRange column correctly
- [x] Update home page song count to reflect actual library size (396 songs)

## Batch 7 Changes (Apr 3 2026)
- [x] Skip round results screen when player passes — go directly to next round
- [x] Award 75% of artist points when primary artist is correct but featured artist is wrong

## Batch 8 Bug Fixes (Apr 5 2026)
- [x] Fix screen refresh loop during gameplay
- [x] Fix Google 403 error on Sign In / OAuth login

## Batch 9 Bug Fixes (Apr 5 2026)
- [x] Add Sign In link to top-right nav (visible when not logged in)
- [x] Add auth gate on Play Now: prompt sign up or log in before playing
- [x] Sign-up form should collect First Name, Last Name, Email
- [x] Display first name in top-right nav when logged in
- [x] Fix decade filtering: lyrics shown must match selected decade(s)
- [x] Show correct selected decade(s) during the round
- [x] Award full artist points when primary artist is correct (not just 75%)
- [x] Fix incorrect answer detection (fuzzy matching too strict — marks correct answers as wrong)

## Batch 10 (Apr 5 2026)
- [x] Remove guest mode entirely (no guest play, no nickname dialog, no guest session)
- [x] Fix OAuth sign-in/sign-up Google 403 error

## Batch 11 (Apr 5 2026)
- [x] Fix artist matching: strip apostrophes/punctuation before comparison so "Ol dirty bastard" matches "Ol' Dirty Bastard"
- [x] Fix Mariah Carey ft. ODB case: "Ol dirty bastard and Mariah Carey" should match
- [x] Redesign Game Summary to show all options with icons (Mode, Ranking, Genres, Decades, Difficulty, Timer, Rounds, Clean Mode)

## Batch 12 (Apr 11 2026)
- [x] Add artist social media links (YouTube, Spotify, Instagram, Apple Music) to Round Results answer section
- [x] Add official music video link (YouTube search) to Round Results answer section

## Batch 13 (Apr 13 2026)
- [ ] Multiple choice for Song Title, Artist, Release Year on Low/Medium difficulty (3 options, randomized position)
- [ ] Change music video button highlight from red to green
- [ ] Add countdown ticking sound for last 10 seconds (using provided audio file)
- [ ] Add social media sharing for homepage (Twitter/X, Facebook, Instagram, TikTok, LinkedIn, WhatsApp)
- [ ] Add social media sharing for individual player scores (Twitter/X, Facebook, Instagram, TikTok, LinkedIn, WhatsApp)
- [ ] Set up Stripe integration for prize pool funding
- [ ] Implement prize pool infrastructure and leaderboard tracking for cash prizes

## Batch 14: Monetization Implementation (Apr 13 2026)
- [ ] Free game counter: Track 2 × 5-round games per free user before requiring payment
- [ ] Entry fee selection UI: Display $5-$1,000 entry fee tiers on game setup screen
- [ ] Stripe Checkout integration: Create checkout session for entry fees
- [ ] Prize pool aggregation logic: Calculate 30% prize pool from total entry fees
- [ ] Prize distribution system: Top 3 split (60%/30%/10%) or winner-take-all
- [ ] Subscription tier management: Stripe Billing for $4.99, $9.99, $19.99 plans
- [ ] Subscription enforcement: Limit games based on tier (free: 2/month, paid: unlimited)
- [ ] Payout system: Stripe Connect for paying winners
- [ ] Leaderboard for entry fee games: Track rankings by entry fee tier
- [ ] User dashboard: Show subscription status, available balance, payout history
- [ ] Admin dashboard: Manage prize pools, view payouts, monitor fraud

## Batch 14: Monetization Implementation (Apr 13 2026)
- [x] Database schema for subscriptions, daily game tracking, entry fees, wallets
- [x] Backend monetization helpers (db-monetization.ts)
- [x] tRPC monetization router with subscription and entry fee procedures
- [x] Subscription tier selector component
- [x] Entry fee selector component
- [x] User dashboard with subscription status and wallet
- [x] Admin dashboard with analytics and player metrics
- [x] Route integration for /dashboard and /admin pages
- [ ] Stripe Checkout integration for entry fees and subscriptions
- [ ] Stripe Connect for payout processing
- [ ] Game setup integration with entry fee selection
- [ ] Game completion with prize distribution
- [ ] Add-on game purchase flow
- [ ] Payout request system


## Batch 15 (Apr 14 2026) - Referral, Notifications, Persistent Header
- [x] Referral program database schema
- [x] Referral code generation and tracking
- [x] Referral rewards system (placeholder)
- [x] Referral tRPC procedures
- [x] Referral UI component (ReferralShare.tsx)
- [x] Notification system database schema
- [x] Notification tRPC procedures
- [x] In-app notification component (NotificationToast.tsx)
- [x] Toast notifications for events
- [x] Persistent header with LyricPro Ai logo (PersistentHeader.tsx)
- [x] Logo link to homepage
- [x] Adjust back button navigation (pt-16 padding added to Router)
- [x] Test all features (55 tests passing)


## Bug Fixes (Apr 14 2026)
- [x] Fix social media sharing links (Twitter, Facebook, Instagram, etc.) - Added URL to share content
- [x] Fix copy-to-clipboard functionality for score sharing - Now includes URL when copying
- [x] Investigate and resolve console errors - Added error handling to share functions


## Batch 16 (Apr 14 2026) - Open Graph, Shareable Links, Error Fixes
- [x] Add Open Graph meta tags to index.html (og:title, og:description, og:image, twitter:card)
- [x] Create invite link utilities (inviteUtils.ts) with code generation and parsing
- [x] Implement invite link generation with unique 6-char codes
- [x] Create join invite page (JoinInvite.tsx) with game details and join button
- [x] Add inviteCode and inviteExpiresAt fields to gameRooms schema
- [x] Create game.getGameByInviteCode tRPC procedure
- [x] Create game.joinGameByInvite tRPC procedure
- [x] Add /join route to App.tsx
- [x] Fix monetization.ts syntax errors (typo: protectedProceduree)
- [x] Test all features (55 tests passing)


## Bug Fix (Apr 14 2026) - Nested Anchor Tags
- [x] Fix nested <a> tags in PersistentHeader (Link component wrapping <a> elements)
- [x] Remove redundant <a> tags inside Link components in dropdown menu
- [x] Fix Sign Up button: replace <a> inside Button with onClick handler


## Bug Fix (Apr 14 2026) - Invite Code Generation
- [x] Add generateInviteCode helper function to game router
- [x] Generate unique invite code on room creation
- [x] Set inviteExpiresAt to 7 days from creation
- [x] Store inviteCode and inviteExpiresAt in gameRooms insert


## Batch 17 (Apr 14 2026) - UI/UX Improvements
- [x] Reduce password character requirement to 6 characters (Manus OAuth - not app-configurable)
- [x] Move social sharing icons to top nav on homepage (now displays in navigation bar)
- [x] Add Instagram to social sharing platforms (added with pink color)
- [x] Increase contrast/brightness of step numbers (01, 02, 03) in "How It Works" section
- [x] Update copy: "Free to try." (button now says "Play Now — Free to try")
- [x] Update copy: "Customize your game and start playing!" (in How It Works section)
- [x] Improve WhatsApp/text message share icon visibility (now displays with green color)
- [x] Build floating feedback widget with form submission (floating button in bottom-right)
- [x] Configure feedback form to send via owner notification system
- [x] Add post-submission thank you message ("Thank you for your submission. A member of our team will respond within 24 hours.")
- [x] Change artist panel text from "Discover [Artist Name]" to "Check out [Artist Name]"

---

## New Session (Apr 18 2026) - Fresh Copy
This is an independent copy of the LyricPro AI project. All features from Batch 17 are included in the codebase.

---

## Release-based tracking (from Apr 20 2026 onwards)

Everything above this line is the legacy Manus-era batch log — kept for
history. From v0.2.0 onwards changes are tracked by semantic version in
[CHANGELOG.md](CHANGELOG.md) and by git tags (`v0.1.0`, `v0.2.0`, …).
This file now only lists **open** work.

## Shipped so far

- **v0.1.0** — baseline trivia game on MySQL + Manus platform (initial commit).
- **v0.2.0** — Supabase + Vercel migration. Postgres schema, 834 songs seeded, serverless functions live at lyricpro-ai.vercel.app, Supabase Auth (magic link + Google/Apple scaffolding), Manus OAuth retired, dev-bypass gate for local iteration.
- **v0.3.0** — Golden Notes virtual currency (schema, server, Shop UI, Stripe webhook wired); Reggae genre added; Hip Hop 30+/decade hit for 1980s-2020s; privacy policy + terms of service drafts; brand logo SVG. Security pass: TOCTOU fix on spend, Stripe redirect allowlist.
- **v0.4.0** — Mobile app scaffolding via Capacitor. `ios/` + `android/` projects committed and buildable. Paid features gated off on native. Deep-link auth callback via `lyricpro://` scheme. CORS updated for Capacitor origins.

## Open — user-facing actions

These need your hands / accounts to proceed. I can't do them from here.

- [ ] **Stripe test-mode key** — drop `STRIPE_SECRET_KEY=sk_test_...` and `STRIPE_WEBHOOK_SECRET=whsec_...` into `.env` (local) or Vercel env (prod). Once in, I verify the Golden Notes purchase → webhook → balance-credit round-trip.
- [ ] **Apple Developer membership** ($99/yr) — required before first iOS submission. ~24h for activation.
- [ ] **Play Console** ($25 one-time) — required for Android submission.
- [ ] **Final bundle ID** — currently `ai.intentionai.lyricpro` as placeholder. Confirm or change before first App Store Connect entry.
- [ ] **Apple Sign In external config** — runbook at [docs/oauth-setup-apple.md](docs/oauth-setup-apple.md). Required by Apple §4.8 if Google sign-in is offered on iOS.
- [ ] **Google OAuth external config** — runbook at [docs/oauth-setup-google.md](docs/oauth-setup-google.md). Optional but recommended.
- [ ] **Custom SMTP for auth emails** — Supabase default is `noreply@mail.app.supabase.io`. Swap to `deric@intentionai.ai` (or similar) via Supabase Dashboard → Authentication → SMTP Settings.
- [ ] **Privacy policy + Terms of Service legal review** — templates in [docs/legal/](docs/legal/). Attorney review required before public launch.
- [ ] **Regenerate app icons** on Node 18–22 — current native builds use Capacitor's placeholder icon. Follow [docs/mobile-app-icons.md](docs/mobile-app-icons.md).
- [ ] **Xcode archive → TestFlight** — run `npx cap open ios` on your Mac, Archive, distribute via TestFlight.
- [ ] **Android Studio signed bundle → Play Internal Testing** — run `npx cap open android`, generate signed `.aab`, upload to Play Console.

## Open — engineering backlog (I can do these)

### Priority 1: security hardening
- [ ] **RLS policies** for every user-owned table (`users`, `game_rooms`, `subscriptions`, `golden_note_balances`, `golden_note_transactions`, etc.). Read/write scoped to `auth.uid()`.
- [ ] **Drizzle transaction wrapper** that sets `role authenticated` + JWT claims per query, so every tRPC DB call is RLS-enforced at the database level. (Option B from the earlier auth discussion.)
- [ ] Refactor existing tRPC procedures to use the RLS-enforced wrapper.

### Priority 2: mobile polish
- [ ] **Universal Links / App Links** so `https://lyricpro-ai.vercel.app/auth/callback` opens the app directly (no custom scheme needed). Requires `apple-app-site-association` + `assetlinks.json` on the Vercel domain.
- [ ] **Native speech-recognition plugin** (`@capacitor-community/speech-recognition`) for more reliable voice-answer input on native.
- [ ] **Haptics wired into Gameplay** — `haptic.success()` on correct answer, `.warning()` on near-miss, `.error()` on timer expiry.

### Priority 3: content
- [ ] Fill every genre/decade cell to ≥20 songs. Current thinnest: Pop 70s (6), Country 70s (8), Gospel 70s (9), Pop 90s (9), R&B 80s (9), Soul 10s (9), Jazz 90s (1 — needs most attention).

### Priority 4: Golden Notes completeness
- [ ] **Gifting UI** — schema already exists (`golden_note_gifts` table). Sender form + recipient accept/decline + notification + 7-day expiry cron.
- [ ] **Daily-limit modal** — when a user is out of free games, show a modal with "Spend 1 Golden Note to keep playing" + "Visit the shop" (web) buttons. Wire `goldenNotes.spend({ kind: "spend_extra_game" })` on click.
- [ ] **Tournament + advanced-mode integration** — actually invoke `goldenNotes.spend` when entering a paid tournament or unlocking advanced mode.
- [ ] **18-month expiry cron** — nightly job that expires unused Golden Notes 30 days after notifying the user.

### Priority 5: Stripe gap closure
- [ ] **Stripe Connect payouts** — when a prize-pool game completes, call `createPayout` to send winnings to the user's connected Stripe account. Plumbing exists, not invoked.
- [ ] **Entry-fee selector wired into GameSetup** — the component exists but isn't rendered on the setup screen yet.
- [ ] **Payout request UI** — users request a cashout of their wallet balance.

### Priority 6: content management
- [ ] **Admin page to add songs** — currently song seeding is a Node script; a web admin UI would let you add songs without a code change + deploy.
- [ ] **Preview / approval workflow** — `approvalStatus` field already exists on `songs` but no UI.

### Priority 7: UX polish
- [ ] **Daily streak visualization** on profile.
- [ ] **Favorite genre / strongest decade** auto-detection from play history.
- [ ] **Social share for individual scores** — already exists on homepage; not yet on round results.
- [ ] **Countdown ticking sound** already added; verify works on native webview.

### Priority 8: ops
- [ ] **Custom domain** (e.g. `lyricpro.intentionai.ai` or client's preferred name) → CNAME to Vercel + update Supabase redirect allowlist + update mobile `apiBase.ts`.
- [ ] **GitHub Releases** tied to each git tag with release notes drawn from CHANGELOG.
- [ ] **CI / pre-commit** — `pnpm check && pnpm test` on every push, optional but worth it before team grows.
- [ ] **Monitoring / error tracking** — Vercel logs are fine for MVP; Sentry or similar when traffic grows.

