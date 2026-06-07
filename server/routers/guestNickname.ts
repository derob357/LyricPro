// Derives a guest display nickname. Prefers an explicit nickname; otherwise
// uses the email local-part; otherwise "Guest". Always <= 64 chars to fit the
// guest_sessions.nickname column.
export function deriveGuestNickname(nickname?: string, email?: string): string {
  const explicit = (nickname ?? "").trim();
  if (explicit) return truncate64(explicit);
  const local = (email ?? "").split("@")[0]?.trim() ?? "";
  if (local) return truncate64(local);
  return "Guest";
}

// Truncates to 64 *code points* (not UTF-16 code units) so we never split a
// surrogate pair and hand Postgres an invalid UTF-8 sequence for the
// varchar(64) nickname column.
function truncate64(s: string): string {
  return [...s].slice(0, 64).join("");
}
