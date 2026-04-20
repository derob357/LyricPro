# Apple Sign-In — Setup Runbook

Goal: light up the "Continue with Apple" button on the sign-in page. Also a **hard requirement** for App Store submission if the app offers any social login (App Store Guideline 4.8).

Estimated time: **~45 minutes** (Apple's UI is slower than Google's).

## Prerequisites

- Paid **Apple Developer Program** membership ($99/yr). Deric already has one if the Mobile App project exists.
- Access to [developer.apple.com](https://developer.apple.com/account/).

## 1. Create an App ID

1. Apple Developer → **Certificates, Identifiers & Profiles → Identifiers → + (new)**.
2. Select **App IDs → App**.
3. Description: `LyricPro Ai`. Bundle ID: explicit, suggest `ai.intentionai.lyricpro` (must match the iOS Bundle ID used when we ship Capacitor).
4. Scroll to **Capabilities**. Enable **Sign in with Apple**.
5. **Continue → Register**.

## 2. Create a Services ID (this is what Supabase uses)

1. Identifiers → + → **Services IDs**.
2. Description: `LyricPro Web Auth`. Identifier: `ai.intentionai.lyricpro.web`. **Continue → Register**.
3. Click into the Services ID you just created and click **Configure** next to "Sign in with Apple".
4. Primary App ID: pick the one from step 1.
5. **Domains and subdomains** — enter your Supabase project domain: `<project-ref>.supabase.co` (no protocol).
6. **Return URLs** — copy from Supabase dashboard → **Authentication → Providers → Apple** → "Callback URL": `https://<project-ref>.supabase.co/auth/v1/callback`.
7. **Save**.

## 3. Create a Sign-in-with-Apple Key

1. Apple Developer → **Keys → + (new)**.
2. Key Name: `LyricPro SIWA Key`.
3. Check **Sign in with Apple → Configure** → select the App ID from step 1 → Save.
4. **Continue → Register**.
5. **Download the .p8 file immediately** (you can't download it again). Save it to your password manager or secure vault.
6. Note the **Key ID** (10 characters, shown on the key detail page).
7. Note your **Team ID** (top-right of the Apple Developer account page).

## 4. Paste into Supabase

1. Supabase → **Authentication → Providers → Apple**.
2. Toggle **Enable Sign in with Apple** on.
3. Fill in:
   - **Client ID (Services ID)**: `ai.intentionai.lyricpro.web` (the Services ID from step 2, **not** the App ID).
   - **Team ID**: from step 3.7.
   - **Key ID**: from step 3.6.
   - **Private Key**: paste the **contents** of the `.p8` file (entire text including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines).
4. **Save**.

## 5. Test

1. Reload your app.
2. Click **Continue with Apple** on the sign-in page.
3. Apple's auth popup appears → sign in → optionally choose "Hide My Email" → redirect to `/auth/callback`.
4. If Apple issues a private relay email (`…@privaterelay.appleid.com`), that's what lands in `public.users.email`. That's fine — Supabase tracks the stable Apple subject in `auth.users.id`.

## 6. iOS App Store caveats

For Capacitor / native iOS wrapper:

- Use Apple's **native Sign in with Apple** flow via [`@capacitor-community/apple-sign-in`](https://github.com/capacitor-community/apple-sign-in) or similar. The web flow won't be accepted by Apple review on iOS.
- The native SDK returns an ID token, which you pass to Supabase via `supabase.auth.signInWithIdToken({ provider: 'apple', token })`. We'll wire that up in the Capacitor work (step 8 of the overall port).

## Troubleshooting

- **"invalid_client"** after signing in on Apple's page — wrong Services ID, wrong Team ID, expired Key, or the Return URL doesn't exactly match. Double-check all four.
- **Key rejected** — make sure you pasted the entire `.p8` file including the BEGIN/END markers. Line endings must be preserved.
- **Private relay email rotates** — if the user signs in twice and gets a different `…@privaterelay.appleid.com`, that's a different Apple-side identity and will create a new `auth.users` row. Our code keys on the stable `auth.users.id` so this shouldn't cause duplicate `public.users` rows.
