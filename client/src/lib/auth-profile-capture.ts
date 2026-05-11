import type { Session, SupabaseClient } from "@supabase/supabase-js";

// Apple returns the user's name only on first authorization. We capture
// it once into auth.users.user_metadata.full_name so subsequent sign-ins
// (which omit the name claim) don't lose it. Idempotent via a localStorage
// flag — best-effort UX, not security.
export async function handleFirstSignInProfile(
  session: Session,
  supabase: SupabaseClient
): Promise<void> {
  const provider = session.user.app_metadata?.provider;
  if (provider !== "apple") return;

  const flagKey = `profile-captured-${session.user.id}`;
  if (typeof localStorage !== "undefined" && localStorage.getItem(flagKey)) return;

  const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName =
    (typeof meta.full_name === "string" && meta.full_name) ||
    [meta.given_name, meta.family_name]
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .join(" ")
      .trim();

  if (!fullName) return;

  await supabase.auth.updateUser({ data: { full_name: fullName } });
  if (typeof localStorage !== "undefined") localStorage.setItem(flagKey, "1");
}
