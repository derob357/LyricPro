# Mobile App Plan — iOS + Android via Capacitor

**Goal:** Ship LyricPro Ai as a native iOS and Android app, openable in Xcode and Android Studio, submittable to the App Store and Google Play.

**Approach:** Wrap the existing React + Vite web app in a **Capacitor** native shell. 95% of the existing code reuses as-is. Alternative (React Native rewrite) would take weeks; Capacitor takes days.

**Monetization posture:** *Path 1* — mobile is free-play only (no IAP, no entry fees, no subscriptions in the mobile build). Paid features stay on the web app at lyricpro-ai.vercel.app. This avoids Apple's 30% IAP cut and the much-stricter §5.3 "Gaming, Gambling, and Lotteries" review rules that real-money contests trigger.

---

## Scope summary

| Phase | What | Owner | Time |
|-------|------|-------|------|
| 1 | Install & configure Capacitor | Claude | 30 min |
| 2 | Feature-gate paid flows off on mobile | Claude | 45 min |
| 3 | API + CORS: point mobile at Vercel prod | Claude | 20 min |
| 4 | Deep-link auth callback (magic-link back into app) | Claude | 1 hour |
| 5 | Native plugins (haptics, splash, status bar, keyboard, speech) | Claude | 45 min |
| 6 | Generate ios/ and android/ projects | Claude | 15 min |
| 7 | App icons + splash screens | Claude (given 1024×1024 master) | 15 min |
| 8 | Bundle ID, Info.plist, AndroidManifest | Claude | 20 min |
| 9 | **Apple Developer + Play Console setup** | **You** | 1–2 hours |
| 10 | First Xcode build + TestFlight upload | You (on your Mac) | 1–2 hours |
| 11 | First Android Studio build + Internal Testing upload | You | 1 hour |
| 12 | App Store + Play review + revisions | Both | 1–7 days (Apple review queue) |

**Total Claude time to "openable in Xcode / Android Studio":** ~4 hours of focused work — phases 1–8.

**Total wall-clock to "live in App Store + Play Store":** 1–2 weeks including Apple's review queue.

---

## Phase-by-phase

### Phase 1 — Install + configure Capacitor

```bash
pnpm add @capacitor/core @capacitor/cli
pnpm add @capacitor/ios @capacitor/android
npx cap init "LyricPro Ai" "ai.intentionai.lyricpro" \
  --web-dir=dist/public
```

Creates `capacitor.config.ts` at the root. Key settings:

```ts
{
  appId: "ai.intentionai.lyricpro",
  appName: "LyricPro Ai",
  webDir: "dist/public",
  server: { androidScheme: "https" },
  ios: { contentInset: "automatic", backgroundColor: "#0a0015" },
  android: { backgroundColor: "#0a0015" },
}
```

**Decision point — bundled vs remote web assets:**
- **Bundled (recommended for launch):** web assets ship inside the app binary. Pros: fast load, works offline, can't be kicked by a Vercel outage. Cons: content updates require an app resubmission.
- **Remote:** Capacitor loads `https://lyricpro-ai.vercel.app` live. Pros: instant updates without resubmission. Cons: dependent on Vercel uptime, App Store sometimes rejects "hybrid apps that are just a web view".

Going with bundled. We can swap later if needed.

### Phase 2 — Feature-gate paid flows

Create `client/src/lib/platform.ts`:

```ts
import { Capacitor } from "@capacitor/core";
export const IS_NATIVE = Capacitor.isNativePlatform();
export const IS_IOS = Capacitor.getPlatform() === "ios";
export const IS_ANDROID = Capacitor.getPlatform() === "android";
```

Hide / stub on native:

| Component / page | Behavior on native |
|---|---|
| `SubscriptionTierSelector` | Doesn't render |
| `EntryFeeSelector`, `EntryFeeModal` | Doesn't render |
| `StripeCheckoutButton` | Doesn't render |
| `UserDashboard` | Subscription + wallet sections hidden |
| `GameSetup` | Entry-fee tier row hidden |
| `AdminDashboard` | Still renders (dashboard is free) |
| Prize-pool copy on Home | Replaced with neutral "Play free" messaging |

Does **not** hide: profile, game play, leaderboards, referrals, notifications.

### Phase 3 — API + CORS

- Hardcode the API base URL on native builds: tRPC client points at `https://lyricpro-ai.vercel.app/api/trpc` instead of a relative path.
- Add mobile origins (`capacitor://localhost`, `https://localhost`, custom scheme) to Vercel's `ALLOWED_ORIGINS` env var.
- Verify the CORS preflight allowlist middleware in [server/_core/index.ts](server/_core/index.ts) accepts them.

### Phase 4 — Deep-link auth callback

Magic links currently redirect to `https://lyricpro-ai.vercel.app/auth/callback`. On mobile, that would open Safari/Chrome instead of returning to the app. Two options:

- **Universal Links / App Links** (preferred, App Store friendly): the `lyricpro-ai.vercel.app/auth/callback` URL is registered with iOS/Android so clicking it opens the app directly. Requires an `apple-app-site-association` file and Android `assetlinks.json` served from the Vercel domain.
- **Custom URL scheme** (simpler fallback): `lyricpro://auth/callback`. Capacitor's `@capacitor/app` plugin listens for the scheme; on receiving the URL, we pass the token fragment to `supabase.auth.setSession`.

**Plan:** implement the custom URL scheme first (works immediately), add Universal Links in a follow-up pass. Supabase's Redirect URLs allowlist can carry both.

### Phase 5 — Native plugins

```bash
pnpm add @capacitor/app              # URL open listener, lifecycle
pnpm add @capacitor/haptics          # tactile feedback on correct/wrong
pnpm add @capacitor/splash-screen    # branded launch
pnpm add @capacitor/status-bar       # match our dark purple theme
pnpm add @capacitor/keyboard         # smooth keyboard appearance
pnpm add @capacitor/preferences      # secure storage wrapper (optional)
pnpm add @capacitor-community/speech-recognition  # native voice input
```

Wire into the existing screens. Haptics on correct answer is a nice polish; speech-recognition replaces the Web Speech API on native where that's spottier.

### Phase 6 — Generate ios/ and android/ projects

```bash
pnpm build                # produces dist/public with bundled web assets
npx cap add ios           # creates ios/ with Xcode workspace
npx cap add android       # creates android/ with Gradle project
npx cap sync              # copies web assets + plugins into both
```

After this step:

```bash
npx cap open ios          # opens Xcode
npx cap open android      # opens Android Studio
```

Both projects are committed to git (no more regeneration from scratch).

### Phase 7 — App icons + splash

Given a **1024×1024 PNG master** (PNG with no transparency for iOS, transparent OK for Android), use the `@capacitor/assets` CLI to generate every size + platform-specific format:

```bash
pnpm add -D @capacitor/assets
npx capacitor-assets generate \
  --iconBackgroundColor "#0a0015" \
  --splashBackgroundColor "#0a0015"
```

If you don't have an icon ready, I'll produce a placeholder from the Music+gradient logo the web app uses today — you can replace it before submission.

### Phase 8 — Bundle metadata

**iOS (`ios/App/App/Info.plist`):**
- Bundle display name: `LyricPro Ai`
- Bundle ID: `ai.intentionai.lyricpro`
- Usage descriptions:
  - `NSMicrophoneUsageDescription` — "LyricPro uses your microphone for voice-answer input."
- URL schemes: register `lyricpro://` for auth callback
- App Transport Security: allow HTTPS to `lyricpro-ai.vercel.app` (default is fine)

**Android (`android/app/src/main/AndroidManifest.xml`):**
- Application label: `LyricPro Ai`
- Package: `ai.intentionai.lyricpro`
- Permissions: `INTERNET`, `RECORD_AUDIO`
- Intent filter for the custom scheme

### Phase 9 — Apple Developer + Play Console setup (your hands required)

**Apple:**

1. Apple Developer account ($99/yr) — if you don't have one, starts at [developer.apple.com/programs](https://developer.apple.com/programs/). Takes ~24h to activate.
2. Certificates, Identifiers & Profiles → create:
   - **App ID** with bundle identifier `ai.intentionai.lyricpro` and capabilities: Sign in with Apple, Push Notifications (future).
   - **Distribution certificate** (Xcode can do this for you when you first archive).
   - **Provisioning profile** (Xcode-managed automatic signing is fine).
3. App Store Connect:
   - Create a new app entry using the bundle ID.
   - Fill in: name, subtitle, description, keywords, support URL, marketing URL, privacy policy URL.
   - Upload screenshots (6.7" iPhone, 6.1" iPhone — required sizes).
   - Set category: "Games → Word" or "Games → Trivia".
   - Content rating questionnaire.

**Google Play:**

1. Play Console developer account ($25 one-time) — [play.google.com/console](https://play.google.com/console/).
2. Create app with package name `ai.intentionai.lyricpro`.
3. Internal Testing track → upload signed bundle.
4. Same content: description, screenshots, privacy policy, category.

I'll prepare a **pre-submission checklist** you can run through once the native projects are ready.

### Phase 10 — iOS build + TestFlight

On your Mac (this can only happen locally, not via Claude):

```bash
npx cap sync ios
npx cap open ios    # launches Xcode
```

In Xcode:
1. Select the "App" scheme → "Any iOS Device" → Product → Archive.
2. Distribution → App Store Connect → TestFlight.
3. Add internal testers (yourself, deric@intentionai.ai).

### Phase 11 — Android build + Internal Testing

```bash
npx cap sync android
npx cap open android    # launches Android Studio
```

In Android Studio:
1. Build → Generate Signed Bundle (AAB).
2. Create a new keystore the first time; save somewhere safe (lose it = can't publish updates).
3. Upload the `.aab` to Play Console → Internal Testing.

### Phase 12 — Review + revisions

- App Store review: typically 24–72 hours on the first submission. Rejections get a specific reviewer note.
- Play review: typically a few hours to 24h.

**Likely rejection triggers** for us, with the mitigation already baked into the plan:

| Apple guideline | Risk | Mitigation |
|---|---|---|
| 3.1.1 In-App Purchase required for digital goods | ❌ blocked if we show paid UI | No subs / entry fees visible on mobile (Phase 2) |
| 4.2 Minimum Functionality | ❌ blocked if it's "just a website wrapper" | Capacitor with bundled assets + native plugins (haptics, splash, speech) demonstrates native integration |
| 4.8 Sign in with Apple required | ❌ blocked if Google sign-in without Apple | Apple Sign In already planned (docs/oauth-setup-apple.md) — required before first submission |
| 5.3 Gaming / Lotteries | ❌ high-risk if prize-pool UI visible | Stripped out of mobile (Phase 2) |
| 5.1.1 Privacy Policy | ❌ blocked without URL | You'll need a simple policy page; can host on intentionai.ai or generate from a template |

---

## What you need from me before Phase 9

Minimum viable work from my end to hand you a buildable Xcode + Android Studio project:

- Phases 1, 2, 3, 5, 6, 8. ~2.5 hours of my time.
- Phase 4 (deep-link) can happen in parallel — auth works without it (users can complete sign-in in Safari, but better to wire up the return-to-app path before submission).
- Phase 7 (icons) — if you give me a logo/brand asset I'll generate all sizes; otherwise I'll ship a placeholder.

## What I need from you

Before I start executing:

1. **Confirm Path 1** (no paid features on mobile) — already confirmed earlier, want to re-check.
2. **Bundle ID** — propose `ai.intentionai.lyricpro`. Confirm or override.
3. **1024×1024 app icon master** (optional — placeholder works to start).
4. **Privacy policy URL** — we'll need this published somewhere before submission. Can be a stub on `intentionai.ai/privacy` or I can write a simple template.
5. **Apple Developer membership** status (active? needs renewal? need to start it?).
6. **Play Console** status (have an account? $25 paid?).

Once I have 1–3, I start Phases 1–8. When those land, you tackle 9–11.
