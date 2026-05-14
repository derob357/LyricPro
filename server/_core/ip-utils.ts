// server/_core/ip-utils.ts
// Truncates IPs to a privacy-respecting prefix for the audit log per GDPR
// guidance: IPv4 → /24 (drops last octet), IPv6 → /48 (keeps first 3 hextets).

export function truncateIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (trimmed.includes(".")) {
    // IPv4
    const parts = trimmed.split(".");
    if (parts.length !== 4) return null;
    const nums = parts.map((p) => {
      const n = Number(p);
      if (!Number.isInteger(n) || n < 0 || n > 255) return NaN;
      return n;
    });
    if (nums.some(Number.isNaN)) return null;
    return `${nums[0]}.${nums[1]}.${nums[2]}.0/24`;
  }
  if (trimmed.includes(":")) {
    // IPv6 — keep first 3 hextets, drop the rest.
    const parts = trimmed.split(":");
    const valid = parts.every((p) => p === "" || /^[0-9a-fA-F]{1,4}$/.test(p));
    if (!valid) return null;
    const head = parts.slice(0, 3).map((p) => p || "0").join(":");
    return `${head}::/48`;
  }
  return null;
}
