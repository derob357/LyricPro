// k-anonymity suppression + granularity bucketing for vendor-visible KPIs.

export function minCohort(): number {
  const raw = Number(process.env.VENDOR_KPI_MIN_COHORT || "10");
  return Number.isInteger(raw) && raw >= 0 ? raw : 10;
}

export function suppressCell(
  value: number,
  userCount: number,
  k: number,
): { value: number | null; suppressed: boolean } {
  if (k > 0 && userCount < k) return { value: null, suppressed: true };
  return { value, suppressed: false };
}

// Complementary suppression: after primary suppression, if EXACTLY ONE cell in
// a breakdown is suppressed, its value could be derived by subtracting the
// visible cells from the (visible) total — so also suppress the next-smallest
// visible cell (by userCount).
export function applyBreakdownSuppression<
  T extends { value: number | null; userCount: number; suppressed: boolean },
>(cells: T[], k: number): T[] {
  const out = cells.map((c) => {
    if (c.value === null || c.suppressed) return { ...c, value: null, suppressed: true };
    const s = suppressCell(c.value, c.userCount, k);
    return { ...c, value: s.value, suppressed: s.suppressed };
  });
  if (out.filter((c) => c.suppressed).length === 1) {
    const visible = out.filter((c) => !c.suppressed).sort((a, b) => a.userCount - b.userCount);
    const target = visible[0];
    if (target) {
      const i = out.indexOf(target);
      out[i] = { ...out[i]!, value: null, suppressed: true };
    }
  }
  return out;
}

export type Granularity = "day" | "week" | "month";

export function bucketKey(isoDate: string, g: Granularity): string {
  if (g === "day") return isoDate;
  if (g === "month") return isoDate.slice(0, 7);
  // week → Monday of the ISO week (UTC-safe: date-only math)
  const d = new Date(`${isoDate}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const back = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
