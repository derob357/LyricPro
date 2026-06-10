# Project B — Homepage Revert + Email Opt-in

**Date:** 2026-06-10
**Status:** Approved by Deric (brainstorming session 2026-06-10)
**Worklist items:** 9 (Play Now display), 3 (email required + opt-in language)

## Goal

Make `/` the full welcome page again (as before the 2026-06-07 interstitial), embedding the interstitial's Play Now card in the hero, and add a compliant marketing opt-in to guest email capture and account signup.

## 1. Routing & page structure (item 9)

- `/` renders the welcome page (`Home.tsx`) for everyone. The standalone `Interstitial.tsx` page is retired.
- `/welcome` becomes a redirect to `/` (old links keep working).
- Hero (per Deric's reference screenshot): badge, **Lyric Pro** title, subtitle — unchanged. The two CTA buttons ("Play Now — Free to try", "Host a Game") are **replaced by the Play Now card** lifted from the interstitial:
  - Guests: email field + opt-in checkbox + genre dropdown + decades multi-select + "Start playing".
  - Signed-in: same card minus email/checkbox.
  - Quick-start config preserved: solo, 3 rounds, Low, 90s, explicit filter off.
- A slim outline **"Host a Game"** button sits directly beneath the card (existing `handleHostGame` behavior).
- Everything below the hero is untouched: genre text list, stats row, How It Works, game modes.
- The interstitial's "MyDashboard" card is dropped; dashboard remains reachable from the nav for signed-in users.

## 2. Email requirement + opt-in (item 3)

- Email remains **required** for guests to start (existing `EMAIL_RE` gate, `guest_sessions.email`). This is compliant: service access and marketing consent are separate purposes (GDPR purpose limitation), provided the checkbox is genuinely optional — it is.
- **Unchecked** opt-in checkbox below the email field (research delta D4 wording, passes CAN-SPAM/GDPR/CASL):

  > ☐ Yes, I'd like to receive tips, game updates, and promotions from LyricPro by email. Unsubscribe anytime. [Privacy Policy]

- The same checkbox is added to the account-creation flow (email/password signup on `SignIn.tsx`; OAuth signups see it on `ProfileCompletion`).
- Single opt-in (no confirmation email) — appropriate for US-first traffic; revisit if meaningful German traffic appears.

## 3. Consent audit storage

Hand-written migration `00NN` + `apply-*.mjs` runner (NEVER `db:push` — project convention; single-Supabase topology means the migration applies to prod when run).

New columns on `guest_sessions` AND `users`:

| column | type | notes |
|---|---|---|
| `marketing_opt_in` | boolean not null default false | checkbox state |
| `consented_at` | timestamptz null | set only when opted in |
| `consent_wording_version` | varchar(32) null | e.g. `lp-optin-v1` |
| `consent_source` | varchar(64) null | e.g. `home-play-card`, `signup-form` |
| `consent_ip` | varchar(45) null | from request, only when opted in |

Server: `createGuestSession` input gains `marketingOptIn: boolean`; signup mutation likewise. IP read server-side from the request — never trusted from the client payload.

## Error handling

- Checkbox state failure must never block game start — consent write is best-effort alongside session creation, logged on failure.
- Redirect loop guard: `/welcome` → `/` only (no conditional re-redirects).

## Testing

- Update/replace `Interstitial.test.tsx` with home-page tests: guest must enter valid email; opt-in optional; consent fields persisted correctly (true and false cases); signed-in user sees no email field; quick-start config unchanged; `/welcome` redirects.
- Manual: guest flow end-to-end on mobile viewport; checkbox copy renders with Privacy Policy link.

## Out of scope

Actually sending marketing email (list export only); unsubscribe infrastructure; double opt-in.
