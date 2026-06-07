// Builds the signup URL for a guest, pre-filling the email captured at the
// interstitial. Mirrors getSignUpUrl() ("/signin?mode=signup") and appends
// the email when present.
export function buildGuestSignupHref(email: string | null): string {
  const base = "/signin?mode=signup";
  if (!email) return base;
  return `${base}&email=${encodeURIComponent(email)}`;
}
