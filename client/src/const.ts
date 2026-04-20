export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Supabase Auth flow — these just point at the in-app sign-in route; the
// actual auth handoff happens on that page. Kept as functions (vs constants)
// for API compatibility with the old Manus OAuth helpers.
export const getLoginUrl = (_returnPath?: string) => "/signin";
export const getSignUpUrl = (_returnPath?: string) => "/signin";
export const getPasswordResetUrl = () => "/signin";
