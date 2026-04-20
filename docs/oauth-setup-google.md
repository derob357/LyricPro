# Google Sign-In — Setup Runbook

Goal: light up the "Continue with Google" button on the sign-in page.
Estimated time: **~15 minutes**.

## 1. Create an OAuth 2.0 Client ID in Google Cloud

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or pick an existing one). Name suggestion: `LyricPro Ai`.
3. Navigate to **APIs & Services → OAuth consent screen**.
   - User Type: **External**.
   - App name: `LyricPro Ai`.
   - User support email: `deric@intentionai.ai`.
   - Developer contact email: same.
   - Scopes: leave defaults. Save and continue through the screens.
   - While in "Testing" mode, add both your users as test users (deric@intentionai.ai, derob357@yahoo.com). You can publish later.
4. Navigate to **APIs & Services → Credentials → + Create Credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Name: `LyricPro Supabase Auth`.
   - **Authorized redirect URIs** — copy from your Supabase dashboard:
     - Supabase → **Authentication → Providers → Google** → the box shows `https://<project-ref>.supabase.co/auth/v1/callback`. Paste that exact URL here.
   - Click **Create**.
5. Copy the two values Google gives you:
   - **Client ID** (e.g. `123456...apps.googleusercontent.com`)
   - **Client Secret**

## 2. Paste into Supabase

1. Supabase → **Authentication → Providers → Google**.
2. Toggle **Enable Sign in with Google** on.
3. Paste the **Client ID** and **Client Secret** from step 1.5.
4. **Save**.

## 3. Test

1. Reload your app (dev or prod).
2. Click **Continue with Google** on the sign-in page.
3. You'll be redirected to Google's consent screen, then back to `/auth/callback`, then to `/`.
4. A new row appears in your Supabase `auth.users` table and a matching row in `public.users` (created by the server-side supabase-auth module on first call).

## 4. Publishing out of Testing mode (before public launch)

While the OAuth consent screen is in Testing mode, only the test users you added can sign in. Before sharing the app broadly:

- Complete the **App verification** steps Google prompts for (domain verification, app logo, privacy policy URL, terms of service URL).
- Click **Publish App**.
- If using sensitive scopes (we aren't — only basic profile + email), Google will require a more thorough review. Plain email/profile scopes auto-publish.

## Troubleshooting

- **"redirect_uri_mismatch"** — the URL in Google Cloud doesn't exactly match the one Supabase shows. Double-check for trailing slashes, `http` vs `https`, and the project-ref.
- **Login succeeds but `public.users` row isn't created** — check your server logs. The `authenticateRequest` function in `server/_core/supabase-auth.ts` logs a warning if `VITE_SUPABASE_PROJECT_URL` or `SUPABASE_SECRET_KEY` are missing in the runtime environment.
- **"Access blocked: This app's request is invalid"** — usually OAuth consent screen isn't configured or the user isn't in the test-users list.
