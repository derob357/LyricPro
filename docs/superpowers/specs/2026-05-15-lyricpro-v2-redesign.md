# LyricPro v2 — Full Redesign + Partner Banner System + AI Monetization

## Overview

Major branch of LyricPro with a new design language ("Dual Accent + Cinematic Depth"), an admin-managed news/partner banner system on the home page, and AI behavioral intelligence retooled around monetization and customer enjoyment. Designed to support the iHeartMedia partnership and future marketing partners.

---

## 1. Design Language: Dual Accent + Cinematic Depth

### Color System

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-deep` | `#08080E` | Page background |
| `--bg-surface` | `#0D0D14` | Elevated surfaces |
| `--bg-card` | `#12102A` | Card interiors |
| `--purple` | `#8B5CF6` | Primary brand accent |
| `--amber` | `#F59E0B` | Secondary warm accent, CTAs, Golden Notes |
| `--red` | `#C6002B` | Partner accent (iHeart), live indicators |
| `--text-primary` | `#F0F0F5` | Headings, primary content (off-white, not #FFF) |
| `--text-muted` | `#6A6A7E` | Secondary text |
| `--text-dim` | `#4A4A5E` | Tertiary text, labels |
| `--border` | `rgba(255,255,255,0.06)` | Default card/divider borders |
| `--glass` | `rgba(18,16,42,0.6)` | Glass panel backgrounds |

### Ambient Lighting

Every page has 2-3 absolutely-positioned radial gradient orbs that create a concert-venue stage-lighting effect:
- **Purple center spotlight**: `radial-gradient(ellipse, rgba(139,92,246,0.08), transparent 65%)` — centered above hero
- **Red ambient bleed**: `radial-gradient(circle, rgba(198,0,43,0.05), transparent 60%)` — right edge, appears when partner content is on screen
- **Amber warm glow**: `radial-gradient(circle, rgba(245,158,11,0.04), transparent 60%)` — left/bottom, subtle warmth

All orbs: `position:absolute; pointer-events:none; border-radius:50%`. Opacity is low (4-8%) — ambient, not neon.

### Glass Panels (2026 Refined)

- `backdrop-filter: blur(16px)`
- `background: rgba(18,16,42,0.6)` (tinted dark, not white glass)
- `border: 1px solid rgba(255,255,255,0.06)` (ultra-thin)
- Optional `box-shadow: inset 0 1px 0 rgba(255,255,255,0.05)` for subtle inner highlight
- Glow accent line on featured cards: 1px gradient line at top — `linear-gradient(90deg, transparent, purple, amber, red, transparent)`

### Typography

- **Display**: Space Grotesk (keep) — headings, hero, brand
- **Body**: Inter (keep) — UI text, labels, descriptions
- **Logo**: `font-size:18px; font-weight:800; background:linear-gradient(90deg,#8B5CF6,#F59E0B); -webkit-background-clip:text;` — purple-to-amber gradient wordmark "LyricPro"
- **Hero headline**: 36-42px, weight 900, letter-spacing -1px. Second line uses the purple→amber gradient fill.

### Glow Rules (Controlled Energy)

- Primary CTA button: `box-shadow: 0 0 24px rgba(139,92,246,0.2)` — one button per view gets the glow
- Featured card top-line: 1px gradient (see above)
- Partner content badge (iHeart red icon): `box-shadow: 0 0 30px rgba(198,0,43,0.15)`
- Mode cards: small radial gradient orb (60px) in corner at 10% opacity for depth
- Everything else: no glow. Ambient orbs handle the atmosphere.

### Motion

- **Page load**: Framer Motion `fadeUp` with staggerChildren (keep existing pattern)
- **Cards**: `translateY(-2px)` on hover with 200ms ease
- **Progress bars**: Gradient fill `linear-gradient(90deg, var(--purple), var(--amber))`
- **Score flashes**: Existing `score-pop` animation (keep)
- **No new kinetic typography** for v2 — evaluate after launch

---

## 2. Page Designs

### 2a. Home Page (Visitor)

Top to bottom:
1. **Nav bar** — Logo (gradient wordmark), links (Events, Leaderboards, Shop), Play Now CTA button with purple glow
2. **Hero headline** — Centered. "Finish the Lyric. / Win the Night." (second line gradient). Subtitle: "AI-powered music trivia • 834 songs • 9 genres • 7 decades"
3. **Partner Banner** — Full-width cinematic card. See section 3 for details.
4. **Mode cards** — 2-column grid. Solo (purple-tinted) and Challenge (amber-tinted). Each has a small ambient orb in the corner.
5. **AI Suggestion card** — Only for authenticated users. Dismissible. Lightbulb icon + text + "Let's go →" link.
6. **Stats strip** — Horizontal row: Songs (purple gradient number), Genres, Modes, Decades (amber number). Separated by thin border lines top/bottom.
7. **How It Works** — 3 steps (keep existing content, apply new card style)
8. **CTA section** — "Ready to play?" with primary button
9. **Footer** — Logo, links, legal

### 2b. Home Page (Returning Authenticated User)

Same structure, but:
- Banner content is **personalized** based on player profile (see section 4)
- AI Suggestion card shows game mode / upsell suggestion
- Weakness Pack card appears (existing, restyled)
- Nav shows user's Golden Notes balance + dropdown menu

### 2c. Gameplay Page

- **Header**: Close button, round/total indicator, genre/decade tag, score (amber), timer ring (amber ring on dark)
- **Progress bar**: Purple→amber gradient fill
- **Streak badge**: Centered above lyric display when active
- **Lyric display**: Deep card (`#12082A → #0C1424` gradient) with spotlight orb above. "Complete the Lyric" label. Lyric text with blanked section (purple underline).
- **Answer inputs**: Dark input fields with purple focus ring. Lyric, Artist, Year, Title in a logical layout.
- **Submit row**: Primary gradient button + secondary Pass button
- **Commentary**: Italic text in a subtle purple-tinted card after submission

### 2d. Shop Page

- **Header**: Logo + back link + Golden Notes balance
- **Balance card**: Large number with amber→pink gradient, glow line
- **Buy section**: 2x2 grid of purchase tiers (10/25/60/150 notes). "Best Value" badge on 25-pack with amber border highlight.
- **Spend section**: List of purchasable items (Practice Pack, Streak Insurance, Event Entry) as horizontal cards with icon, description, and cost in Golden Notes
- **Partner promo**: iHeart co-branded strip at bottom ("Premium members get 5 free Golden Notes monthly")

### 2e. Admin Dashboard

- **Stat cards**: 3-column grid (Users, Songs, Revenue) with change indicators
- **Tab navigation**: Overview, Songs, Genres, Log, Usage, Suggestions, Commentary, **Banners** (new)
- **Banners tab**: List of active/scheduled banners with partner name, title, expiry, CTR, and live/scheduled toggle. Create/edit banner form.
- **All existing admin tabs** restyled to match new design tokens (dark glass cards, purple/amber accents, thin borders)

---

## 3. Partner Banner System

### Data Model

New table: `banners`

```sql
CREATE TABLE banners (
  id            SERIAL PRIMARY KEY,
  title         VARCHAR(256) NOT NULL,
  subtitle      TEXT,
  cta_text      VARCHAR(64) NOT NULL DEFAULT 'Learn More',
  cta_action    VARCHAR(512) NOT NULL,          -- URL or internal route
  partner_name  VARCHAR(128),                    -- e.g. "iHeartRadio"
  partner_logo_url VARCHAR(512),                 -- optional logo image URL
  badge_text    VARCHAR(32) DEFAULT 'Featured',  -- "Live Event", "Sponsored", "New"
  badge_color   VARCHAR(7) DEFAULT '#EF4444',    -- hex color for badge dot
  image_emoji   VARCHAR(8),                      -- fallback if no image (e.g. "🎄")
  image_url     VARCHAR(512),                    -- optional banner image
  audience      VARCHAR(32) DEFAULT 'all',       -- 'all', 'authenticated', 'visitor', 'targeted'
  target_json   JSONB DEFAULT '{}',              -- targeting rules when audience='targeted'
  priority      INTEGER DEFAULT 100 NOT NULL,
  is_active     BOOLEAN DEFAULT true NOT NULL,
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT now() NOT NULL
);
```

### Targeting Rules (`target_json`)

When `audience = 'targeted'`, the banner resolves against the player's profile:

```json
{
  "minGames": 5,
  "maxGames": null,
  "genres": ["R&B", "Hip Hop"],
  "minDaysInactive": 0,
  "maxDaysInactive": 3,
  "preferredDifficulty": "medium"
}
```

All fields optional. Null/missing = no constraint. Multiple fields are AND-ed.

### Resolution Logic

`resolveBanner(userId | null)`:
1. Fetch all active banners where `now() BETWEEN starts_at AND ends_at` (or nulls = always)
2. Filter by `audience`: 'all' passes everyone; 'visitor' = no session; 'authenticated' = has session; 'targeted' = evaluate `target_json` against player profile
3. Sort by `priority` (lower = higher priority)
4. Return the first match, or null

### Admin UI (Banners Tab)

- List view: title, partner, badge, audience, date range, CTR (computed from `banner_impressions`), active toggle
- Create/edit form: all fields from the schema + visual preview
- Optional: `banner_impressions` table for tracking (id, banner_id, user_id, shown_at, clicked_at) — enables CTR reporting

### Client Rendering

The `HeroBanner` component:
- Fetches from a new `banners.getActive` tRPC route (public, returns resolved banner for the current user or null)
- Renders the cinematic depth card: gradient background, ambient red bleed, top gradient line, badge, title, subtitle, CTA button, partner logo/emoji
- Falls back to a default "Play Now" promotional banner if no partner banner is active
- Tracks impressions via a `banners.trackImpression` mutation (fire-and-forget on mount)

---

## 4. AI Monetization Intelligence

The existing Player Intelligence system (Phases 1-6) is enhanced with monetization-focused signals:

### New Profile Fields

Add to `PlayerProfileData`:
- `bannerClickRate`: ratio of banner clicks to impressions
- `shopVisitCount`: times visited the shop page
- `lastPurchaseDate`: when they last bought Golden Notes
- `spendVelocity`: Golden Notes spent per week average
- `eventParticipation`: count of partner event entries

### New Suggestion Rules (seeded)

| triggerKey | category | text |
|-----------|----------|------|
| `event-entry-nudge` | upsell | "The {eventName} draw closes in {hoursLeft}h. 8 Golden Notes to enter." |
| `post-game-shop` | upsell | "Nice game! You're {notesShort} Golden Notes from a practice pack." |
| `partner-concert` | mode | "iHeartRadio has {concertName} tickets in tonight's prize pool. Play to win." |
| `streak-protection-upsell` | upsell | "Your {streakCount}x streak is at risk. Streak Insurance = 2 Golden Notes." |
| `returning-bonus` | mode | "Welcome back! Play a game today and earn 2x Golden Notes." |

### Commentary Enhancement for Monetization

New commentary trigger keys tied to monetization moments:
- `shop_nudge_low_balance`: "Running low on Golden Notes — the shop has your back."
- `event_reminder`: "Don't forget — the {eventName} draw is live. Enter from the shop."
- `perfect_game_reward`: "Perfect game! You earned a bonus Golden Note. Check your balance."

These are inserted into `commentary_templates` and manageable from the admin Commentary tab.

---

## 5. Branch Strategy

- Create a new git branch: `v2-redesign`
- All work happens on this branch
- The existing `main` branch stays deployable as the current production site
- Merge to main when the redesign is ready for launch

---

## 6. Implementation Scope

### Sub-project 1: Design System + Home Page (this spec)
- New CSS design tokens (colors, glass, glow, ambient orbs)
- Home page rebuild with new layout
- Partner banner system (schema, resolver, admin CRUD, client component)
- Nav bar + persistent header restyled

### Sub-project 2: Game Pages Restyle
- Gameplay, RoundResults, FinalResults restyled to new design tokens
- Commentary display updated

### Sub-project 3: Shop + Dashboard Restyle
- Shop page rebuilt with new design
- User dashboard restyled
- Profile page restyled

### Sub-project 4: Admin Restyle + Banners Tab
- Admin dashboard restyled
- Banners tab (CRUD for partner banners)
- Banner impression tracking + CTR reporting

### Sub-project 5: AI Monetization Enhancements
- New profile fields
- New suggestion rules
- New commentary templates
- Banner targeting based on player profile

**This spec covers Sub-project 1.** Subsequent sub-projects get their own specs after Sub-project 1 ships.

---

## 7. Files Changed (Sub-project 1)

| File | Action |
|------|--------|
| `client/src/index.css` | Rewrite design tokens, add ambient/glow utilities |
| `client/src/pages/Home.tsx` | Full rebuild |
| `client/src/components/PersistentHeader.tsx` | Restyle to new design language |
| `client/src/components/HeroBanner.tsx` | New component — partner banner renderer |
| `client/src/components/SuggestionCard.tsx` | Restyle |
| `drizzle/schema.ts` | Add `banners` table |
| `drizzle/0011_banners.sql` | Migration |
| `server/routers/banners.ts` | New router — getActive, trackImpression |
| `server/app-router.ts` | Register banners router |

Gameplay, Shop, Admin, and other pages are **not touched** in Sub-project 1 — they inherit the new CSS tokens automatically for colors/borders but keep their current layouts until Sub-projects 2-4.
