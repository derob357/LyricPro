// Shared password validation rules + Have-I-Been-Pwned k-anonymity check.
// Used by both /account/security (set/change password while signed in)
// and /auth/reset-password (post-recovery-link reset flow).
//
// Policy:
//   - 12 chars min, 128 max
//   - Must contain at least one of: uppercase letter, digit, symbol
//   - Rejected if HIBP reports it in a known breach (k-anonymity, fail-open)
//
// Server-side is enforced by Supabase's password policy + the auth flow's
// own checks. Client validation here is for fast UX feedback only.

export type PasswordIssue =
  | "too_short"
  | "too_long"
  | "no_uppercase"
  | "no_digit"
  | "no_symbol"
  | "pwned";

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export function checkPasswordRules(password: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (password.length < PASSWORD_MIN) issues.push("too_short");
  if (password.length > PASSWORD_MAX) issues.push("too_long");
  if (!/[A-Z]/.test(password)) issues.push("no_uppercase");
  if (!/[0-9]/.test(password)) issues.push("no_digit");
  if (!/[^A-Za-z0-9]/.test(password)) issues.push("no_symbol");
  return issues;
}

export function describeIssue(issue: PasswordIssue): string {
  switch (issue) {
    case "too_short": return `At least ${PASSWORD_MIN} characters`;
    case "too_long": return `At most ${PASSWORD_MAX} characters`;
    case "no_uppercase": return "At least one uppercase letter";
    case "no_digit": return "At least one digit";
    case "no_symbol": return "At least one symbol";
    case "pwned": return "This password appears in a known data breach — choose a different one";
  }
}

// SHA-1 hex of a UTF-8 string using the platform Web Crypto API.
async function sha1Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

// HIBP Pwned Passwords range API uses k-anonymity: we send only the first
// 5 hex chars of the SHA-1 hash; the API returns all matching suffixes
// with breach counts. The full password is never transmitted.
//
// Fail-open by design: if the call errors / times out, we let the caller
// proceed. Treating an HIBP outage as a hard block would make password
// changes silently fail when the API has issues.
export async function isPasswordPwned(password: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: ctrl.signal,
      headers: { "Add-Padding": "true" },
    });
    clearTimeout(t);

    if (!res.ok) return false;
    const body = await res.text();
    for (const line of body.split("\n")) {
      const [hashSuffix] = line.trim().split(":");
      if (hashSuffix === suffix) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Convenience: combined validation. Returns empty array on pass.
export async function validateNewPassword(password: string): Promise<PasswordIssue[]> {
  const ruleIssues = checkPasswordRules(password);
  if (ruleIssues.length > 0) return ruleIssues;
  const pwned = await isPasswordPwned(password);
  return pwned ? ["pwned"] : [];
}
