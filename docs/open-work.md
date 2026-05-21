# LyricPro — Open Work

> Snapshot generated 2026-05-19. Updated 2026-05-21 after Remote Live ship + audits. Source of truth: [todo.md](../todo.md) (open items only; legacy batch history lives above the Apr 20 line there).
> Current shipped state: **v0.4.0** + Remote Live Phase 1 (LiveKit) live in production at `ae3c7dd`.

---

## 🚨 Just-surfaced follow-ups (2026-05-21 — post-Remote-Live)

- [ ] **Rotate LiveKit Cloud API key + secret.** During the Remote Live ship audit, a tool-output grep of `.env` echoed the real `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` into the chat transcript. Treat as exposed. Rotate at LiveKit Cloud → Project Settings → Keys → "Roll keys", then update local `.env` AND Vercel Production env (Settings → Environment Variables) with the new values. Trigger a redeploy. Do not echo new values in chat.
- [ ] **Drizzle journal drift cleanup.** Audit found that migrations `0008_player_profiles`, `0009_suggestion_rules_commentary`, `0010_genres`, `0011_banners`, and `0012_remote-live-mode` are physically applied to prod but not recorded in `__drizzle_migrations` or in `drizzle/meta/_journal.json`. No runtime impact; pure ledger drift. Fix plan: (1) delete orphan files `drizzle/0006_song_displays.sql` and `drizzle/0007_lyric_variants.sql` (content already applied); (2) regenerate `_journal.json` entries + `_snapshot.json` files for idx 8–12; (3) backfill `__drizzle_migrations` rows with the SHA-256 hashes from `/tmp/lyricpro-audit-db.md`. Single maintenance-window transaction. Sequence and hashes documented in `/tmp/lyricpro-audit-db.md` (Steps 1-3a).
- [ ] **Resolve PR #1 (`refactor/drop-build-api`).** Rebase attempt 2026-05-21 hit modify/delete conflicts on `api/stripe/webhook.mjs` and `api/trpc/[trpc].mjs` — the branch's intent is to delete them, but main has been modifying them for 247 commits. Needs a dedicated session: either redo the architectural change cleanly off current main, or close PR #1 + delete the branch.
- [ ] **Lazy-load `livekit-client`.** Audit 3 noted the dependency adds ~510 kB raw / +134 kB gzip to the main bundle. Dynamic-import it from `VideoLobby` + `GameSetup` (only loaded when entering Remote Live) to spare the ~99% of users who never touch the mode.
- [ ] **Mobile camera/mic permission strings (separate ship from web go-live).** iOS `Info.plist` missing `NSCameraUsageDescription`; Android `AndroidManifest.xml` missing `CAMERA` (and probably `MODIFY_AUDIO_SETTINGS`). Add both, then `npx cap sync ios android`, then iOS rebuild → TestFlight + Android signed bundle → Play Internal Testing.

---

## 🙋 Needs you (accounts / manual)

These need your hands or accounts to proceed.

- [ ] **Stripe test-mode keys** — add `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` to `.env` (local) or Vercel env (prod). Once in, the Golden Notes purchase → webhook → balance-credit round-trip can be verified.
- [ ] **Apple Developer membership** ($99/yr) — required before first iOS submission (~24h activation).
- [ ] **Play Console** ($25 one-time) — required for Android submission.
- [ ] **Final bundle ID** — currently `ai.intentionai.lyricpro` placeholder. Confirm or change before first App Store Connect entry.
- [ ] **Apple Sign In external config** — runbook at [docs/oauth-setup-apple.md](oauth-setup-apple.md).
- [ ] **Google OAuth external config** — runbook at [docs/oauth-setup-google.md](oauth-setup-google.md).
- [ ] **Custom SMTP for auth emails** — swap Supabase default (`noreply@mail.app.supabase.io`) via Supabase Dashboard → Authentication → SMTP Settings.
- [ ] **Privacy policy + Terms of Service legal review** — templates in [docs/legal/](legal/). Attorney review required before public launch.
- [ ] **Regenerate app icons** on Node 18–22 — see [docs/mobile-app-icons.md](mobile-app-icons.md).
- [ ] **Xcode archive → TestFlight** — `npx cap open ios`, Archive, distribute.
- [ ] **Android Studio signed bundle → Play Internal Testing** — `npx cap open android`, generate signed `.aab`, upload.

---

## 🛠️ Engineering backlog

### Priority 1 — Security hardening
- [ ] **RLS policies** for every user-owned table (`users`, `game_rooms`, `subscriptions`, `golden_note_balances`, `golden_note_transactions`, etc.) — read/write scoped to `auth.uid()`.
- [ ] **Drizzle transaction wrapper** that sets `role authenticated` + JWT claims per query, so every tRPC DB call is RLS-enforced at the database level.
- [ ] Refactor existing tRPC procedures to use the RLS-enforced wrapper.

### Priority 2 — Mobile polish
- [ ] **Universal Links / App Links** so `https://lyricpro-ai.vercel.app/auth/callback` opens the app directly. Requires `apple-app-site-association` + `assetlinks.json` on the Vercel domain.
- [ ] **Native speech-recognition plugin** (`@capacitor-community/speech-recognition`) for reliable voice-answer input on native.
- [ ] **Haptics wired into Gameplay** — `haptic.success()` on correct, `.warning()` on near-miss, `.error()` on timer expiry.

### Priority 3 — Content
- [ ] Fill every genre/decade cell to ≥20 songs. Thinnest cells: Pop 70s (6), Country 70s (8), Gospel 70s (9), Pop 90s (9), R&B 80s (9), Soul 10s (9), **Jazz 90s (1 — needs most attention)**.

### Priority 4 — Golden Notes completeness
- [ ] **Gifting UI** — `golden_note_gifts` table exists. Sender form + recipient accept/decline + notification + 7-day expiry cron.
- [ ] **Daily-limit modal** — when out of free games, show "Spend 1 Golden Note to keep playing" + "Visit the shop". Wire `goldenNotes.spend({ kind: "spend_extra_game" })`.
- [ ] **Tournament + advanced-mode integration** — actually invoke `goldenNotes.spend` on paid tournament entry / advanced-mode unlock.
- [ ] **18-month expiry cron** — nightly job expiring unused Golden Notes 30 days after notifying the user.

### Priority 5 — Stripe gap closure
- [ ] **Stripe Connect payouts** — call `createPayout` on prize-pool game completion. Plumbing exists, not invoked.
- [ ] **Entry-fee selector wired into GameSetup** — component exists but not rendered on the setup screen.
- [ ] **Payout request UI** — users request a cashout of their wallet balance.

### Priority 6 — Content management
- [x] ~~Admin page to add songs~~ — shipped in admin audit initiative (Phases 0–3).
- [ ] **Preview / approval workflow** — `approvalStatus` field exists on `songs`, no UI yet.

### Phase 5c — Layer-3 data reconciliation
- [ ] **Layer-3 prompt drift** — `contentReadMode.test.ts` fails because `gameplay_items` / `lyric_moments` tables differ from `songs.lyricVariants` jsonb for some songs. `LYRIC_PRO_READ_FROM_LAYER3` is OFF in prod, so users are unaffected. Needs a reconciliation script/migration before the flag can flip on.

### Priority 7 — UX polish
- [ ] **Daily streak visualization** on profile.
- [ ] **Favorite genre / strongest decade** auto-detection from play history.
- [ ] **Social share for individual scores** — exists on homepage; not yet on round results.
- [ ] **Countdown ticking sound** — already added; verify it works on native webview.

### Priority 8 — Ops
- [ ] **Custom domain** (e.g. `lyricpro.intentionai.ai`) → CNAME to Vercel + update Supabase redirect allowlist + mobile `apiBase.ts`.
- [ ] **GitHub Releases** tied to each git tag, notes drawn from CHANGELOG.
- [ ] **CI / pre-commit** — `pnpm check && pnpm test` on every push.
- [ ] **Monitoring / error tracking** — Sentry or similar when traffic grows.

---

## 🔒 Security follow-ups

- [ ] **CSP enforce** — switch from `reportOnly` to enforcing after one production deploy with no violations observed.
- [ ] **CA-16 (HIGH)** — Stripe webhook idempotency rollback can re-process partial successes. Wrap each event-type handler in a `db.transaction` that includes the `processedWebhookEvents` insert, or change rollback policy to "leave marked, surface for replay." [server/_core/stripeWebhook.ts:62-75](../server/_core/stripeWebhook.ts#L62-L75). Architectural — not safe as a mechanical fix.
- [ ] **CA-05 (Medium)** — Add `charge.dispute.created` / `charge.dispute.closed` handlers — pause access on dispute creation, restore on `won`, revoke on `lost`. Defer until first dispute or quarterly review.
- [ ] **D17 / CA-11 (Medium)** — Forward client IP to Supabase admin calls via `Sb-Forwarded-For` so per-IP OAuth rate limits work behind Vercel/Express. Or enable hCaptcha/Turnstile in Supabase.
- [ ] **CA-12 (Medium)** — Account deletion / GDPR erasure flow — no path exists. Schedule as a dedicated initiative.
- [ ] **SE-D04 (Medium)** — Ownership checks on remaining game-room mutations: `setReady` ([game.ts:383](../server/routers/game.ts#L383)), `getNextSong` ([:423](../server/routers/game.ts#L423)), `submitAnswer` ([:888](../server/routers/game.ts#L888)), `assignTeam` ([:1384](../server/routers/game.ts#L1384)). Validate caller identity against the room roster before mutating room state.
- [ ] **SE-D01 (Medium)** — `resolveStripeCustomer` uses `customers.search({ query: ... })` with only single-quote escaping. Prefer `customers.list({ email, limit: 1 })` for exact-match dedup. [server/stripe-integration.ts:19-22](../server/stripe-integration.ts#L19-L22).
- [ ] **SE-D03 (Info)** — CSP shipped as `reportOnly: true` with no `report-uri` / `report-to` — no signal during bake-in. Add a report endpoint, or set a reminder to flip CSP to enforcing after 7 clean days.

---

## 🎨 OAuth branding

- [ ] **Google OAuth consent screen** — app name → "LyricPro", homepage → `https://www.playlyricpro.com`, add logo, add `playlyricpro.com` as authorized domain, set privacy/terms links. Google Cloud Console → APIs & Services → OAuth consent screen. Project number: `970200174349`.
- [ ] **Apple Sign In branding** — Services ID description → "LyricPro" / "PlayLyricPro.com" in Apple Developer → Identifiers → Services IDs.
