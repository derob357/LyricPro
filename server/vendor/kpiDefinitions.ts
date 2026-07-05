// Machine-readable definition footnotes served in /v1/meta and rendered under
// every dashboard chart. Unlabeled metrics get assumed to be the strictest
// standard definition during diligence — always ship these alongside numbers.
import { minCohort } from "./kpiSuppress";

export const KPI_DEFINITIONS: Record<string, string> = {
  dau: "Unique users+guests with ≥1 game session started or lyric displayed that calendar day (America/New_York). Guests identified by session token.",
  wau: "Unique users+guests active in the trailing 7 calendar days ending that day (inclusive).",
  mau: "Unique users+guests active in the trailing 30 calendar days ending that day (inclusive).",
  stickiness: "Average DAU within the bucket ÷ MAU on the bucket's last day.",
  new_users: "Registered accounts created that day.",
  new_guests: "Guest sessions created that day.",
  guest_conversions: "Registered accounts created that day whose email matches a guest session from the prior 30 days.",
  sessions: "Game sessions started that day. No inactivity-timeout model — a session is one game.",
  avg_session_seconds: "Sum of (ended−started) over sessions with a recorded end ÷ count of those sessions.",
  rounds: "Round results recorded that day.",
  rounds_per_session: "Rounds ÷ sessions for the same period.",
  retention: "Classic bounded N-day retention: % of registered accounts created on the cohort day (day 0) active exactly on day N (N=1/7/30). Registered users only — guests lack stable cross-device identity.",
  displays: "Lyric displays (one per lyric shown).",
  correct_rate: "Rounds with lyric points > 0 ÷ rounds played.",
  avg_response_seconds: "Mean recorded response time over rounds with a response time.",
  gn_purchased: "Golden Notes purchased (GN units — virtual currency, not USD).",
  gn_spent: "Golden Notes spent, by spend kind (GN units).",
  addon_revenue_usd: "Completed add-on game purchases, USD gross (before payment fees).",
  entry_fee_revenue_usd: "Total entry fees collected for games completed that day, USD gross.",
  prizes_paid_usd: "Completed prize payouts, USD.",
  active_subscriptions: "Paid subscriptions (tier ≠ free) active on that day, by tier. CAVEAT: days backfilled on 2026-07-05 (range 2026-04-05..2026-07-04) reflect subscription state at backfill time, not historical state.",
  arpdau: "Day's gross transactional revenue (GN purchase spend excluded — GN is virtual; uses addon + entry-fee USD) ÷ DAU.",
};

export function definitionNotes(): string[] {
  return [
    "Timezone: all days are calendar days in America/New_York.",
    "Identity: user id for registered accounts, session token for guests; multi-device users may count once per identity.",
    "Revenue basis: gross, before store/payment fees. GN metrics are virtual-currency units, not USD.",
    `Privacy: cells derived from fewer than ${minCohort()} users are suppressed (value=null, suppressed=true); complementary cells may also be suppressed to prevent differencing.`,
    "Weekly/monthly granularity: additive metrics are summed; dau is averaged; wau/mau/active_subscriptions use the bucket's last available day. Bucket-level privacy suppression uses the largest single-day contributor count (conservative).",
    "Content genre/decade rows carry displays only; other content metrics are song-level (null = not applicable).",
    "Data freshness: nightly rollup — figures are as of the last closed day.",
  ];
}
