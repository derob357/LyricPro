// server/vendor/kpiQueries.ts
// Shared KPI read layer — consumed by BOTH the vendor REST API and (Phase 3)
// the tRPC vendorRouter, so dashboard and API numbers cannot drift.
import { sql } from "drizzle-orm";
import type { getDb } from "../db";
import {
  applyBreakdownSuppression,
  bucketKey,
  minCohort,
  suppressCell,
  type Granularity,
} from "./kpiSuppress";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type Cell = { value: number | null; suppressed: boolean };
export type Range = { from: string; to: string; granularity: Granularity };

export type GrowthRow = {
  bucket: string;
  dau: Cell;
  wau: Cell;
  mau: Cell;
  newUsers: Cell;
  newGuests: Cell;
  guestConversions: Cell;
  stickiness: Cell;
};

export type EngagementRow = {
  bucket: string;
  sessions: Cell;
  avgSessionSeconds: Cell;
  rounds: Cell;
  roundsPerSession: Cell;
};

export type RetentionRow = {
  cohortDate: string;
  dayOffset: number;
  cohortSize: Cell;
  retainedRate: Cell;
};

export type ContentRow = {
  key: string;
  displays: Cell;
  roundsPlayed: Cell;
  correctRate: Cell;
  avgResponseSeconds: Cell;
};

export type MonetizationRow = {
  bucket: string;
  gnPurchased: Cell;
  gnSpentByKind: Record<string, Cell>;
  addonRevenueUsd: Cell;
  entryFeeRevenueUsd: Cell;
  prizesPaidUsd: Cell;
  subscriptionsByTier: Record<string, Cell>;
  arpdau: Cell;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type MetricRow = {
  date: string;
  metric: string;
  dimension: string;
  dimension_value: string;
  value: number;
  user_count: number;
};

function toRows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result)
    ? (result as Record<string, unknown>[])
    : Array.from(result as Iterable<Record<string, unknown>>);
}

async function fetchMetrics(
  db: Db,
  metrics: string[],
  from: string,
  to: string,
): Promise<MetricRow[]> {
  const rows = toRows(
    await db.execute(sql`
      SELECT date::text AS date, metric, dimension, dimension_value, value, user_count
      FROM kpi_daily_metrics
      WHERE metric = ANY(${metrics}) AND date >= ${from}::date AND date <= ${to}::date
      ORDER BY date
    `),
  );
  return rows.map((r) => ({
    date: String(r.date),
    metric: String(r.metric),
    dimension: String(r.dimension),
    dimension_value: String(r.dimension_value),
    value: Number(r.value),
    user_count: Number(r.user_count),
  }));
}

type Agg = "sum" | "avg" | "last";

// Aggregate a single (metric, dimension, dimension_value) slice into per-bucket values.
function aggregateMetric(
  rows: MetricRow[],
  metric: string,
  g: Granularity,
  mode: Agg,
  dimension = "all",
  dimensionValue = "all",
): Map<string, { value: number; userCount: number }> {
  const filtered = rows.filter(
    (r) =>
      r.metric === metric &&
      r.dimension === dimension &&
      r.dimension_value === dimensionValue,
  );
  const buckets = new Map<string, { values: number[]; userCounts: number[] }>();
  for (const r of filtered) {
    const b = bucketKey(r.date, g);
    const cur = buckets.get(b) ?? { values: [], userCounts: [] };
    cur.values.push(r.value);
    cur.userCounts.push(r.user_count);
    buckets.set(b, cur);
  }
  const out = new Map<string, { value: number; userCount: number }>();
  for (const [b, { values, userCounts }] of Array.from(buckets)) {
    if (mode === "sum") {
      out.set(b, {
        value: values.reduce((a: number, v: number) => a + v, 0),
        userCount: Math.max(...userCounts),
      });
    } else if (mode === "avg") {
      out.set(b, {
        value: values.reduce((a: number, v: number) => a + v, 0) / values.length,
        userCount: Math.min(...userCounts),
      });
    } else {
      // last
      out.set(b, {
        value: values[values.length - 1]!,
        userCount: userCounts[userCounts.length - 1]!,
      });
    }
  }
  return out;
}

// Aggregate a metric broken down by dimension_value into per-bucket × per-value maps.
function aggregateByDimValue(
  rows: MetricRow[],
  metric: string,
  dimensionName: string,
  g: Granularity,
  mode: Agg,
): Map<string, Map<string, { value: number; userCount: number }>> {
  // bucket → dimensionValue → {value, userCount}
  const bmap = new Map<string, Map<string, { values: number[]; userCounts: number[] }>>();
  for (const r of rows) {
    if (r.metric !== metric || r.dimension !== dimensionName) continue;
    const b = bucketKey(r.date, g);
    if (!bmap.has(b)) bmap.set(b, new Map());
    const vmap = bmap.get(b)!;
    const cur = vmap.get(r.dimension_value) ?? { values: [], userCounts: [] };
    cur.values.push(r.value);
    cur.userCounts.push(r.user_count);
    vmap.set(r.dimension_value, cur);
  }
  const out = new Map<string, Map<string, { value: number; userCount: number }>>();
  for (const [b, vmap] of Array.from(bmap)) {
    const resolved = new Map<string, { value: number; userCount: number }>();
    for (const [dv, { values, userCounts }] of Array.from(vmap)) {
      if (mode === "sum") {
        resolved.set(dv, {
          value: values.reduce((a: number, v: number) => a + v, 0),
          userCount: Math.max(...userCounts),
        });
      } else if (mode === "avg") {
        resolved.set(dv, {
          value: values.reduce((a: number, v: number) => a + v, 0) / values.length,
          userCount: Math.min(...userCounts),
        });
      } else {
        resolved.set(dv, {
          value: values[values.length - 1]!,
          userCount: userCounts[userCounts.length - 1]!,
        });
      }
    }
    out.set(b, resolved);
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

function cellAt(
  m: Map<string, { value: number; userCount: number }>,
  bucket: string,
  k: number,
): Cell {
  const e = m.get(bucket);
  if (!e) return { value: 0, suppressed: false };
  return suppressCell(round2(e.value), e.userCount, k);
}

function sortedBuckets(...maps: Map<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const m of maps) {
    for (const k of Array.from(m.keys())) seen.add(k);
  }
  return Array.from(seen).sort();
}

// Build a Record<string, Cell> breakdown applying complementary suppression.
function breakdownCells(
  vmap: Map<string, { value: number; userCount: number }> | undefined,
  k: number,
): Record<string, Cell> {
  if (!vmap || vmap.size === 0) return {};
  const entries = Array.from(vmap.entries()).map(([key, { value, userCount }]) => ({
    key,
    value: value as number | null,
    userCount,
    suppressed: false,
  }));
  const suppressed = applyBreakdownSuppression(entries, k);
  const result: Record<string, Cell> = {};
  for (const c of suppressed) {
    result[c.key] = { value: c.value, suppressed: c.suppressed };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getDateRange(
  db: Db,
): Promise<{ min: string | null; max: string | null }> {
  const rows = toRows(
    await db.execute(
      sql`SELECT min(date)::text AS min, max(date)::text AS max FROM kpi_daily_metrics`,
    ),
  );
  const r = rows[0];
  return {
    min: r?.min != null ? String(r.min) : null,
    max: r?.max != null ? String(r.max) : null,
  };
}

export async function getGrowth(db: Db, r: Range): Promise<GrowthRow[]> {
  const k = minCohort();
  const { from, to, granularity: g } = r;

  const rawRows = await fetchMetrics(
    db,
    ["dau", "wau", "mau", "new_users", "new_guests", "guest_conversions"],
    from,
    to,
  );

  const dauMap = aggregateMetric(rawRows, "dau", g, "avg");
  const wauMap = aggregateMetric(rawRows, "wau", g, "last");
  const mauMap = aggregateMetric(rawRows, "mau", g, "last");
  const newUsersMap = aggregateMetric(rawRows, "new_users", g, "sum");
  const newGuestsMap = aggregateMetric(rawRows, "new_guests", g, "sum");
  const guestConvMap = aggregateMetric(rawRows, "guest_conversions", g, "sum");

  const buckets = sortedBuckets(dauMap, wauMap, mauMap, newUsersMap, newGuestsMap, guestConvMap);

  return buckets.map((bucket) => {
    const dau = cellAt(dauMap, bucket, k);
    const mau = cellAt(mauMap, bucket, k);

    // stickiness = avg(dau) / mau_last; inherit suppression from dau or mau.
    let stickiness: Cell;
    const dauEntry = dauMap.get(bucket);
    const mauEntry = mauMap.get(bucket);
    if (!dauEntry || !mauEntry || dau.suppressed || mau.suppressed || mauEntry.value === 0) {
      stickiness = { value: null, suppressed: true };
    } else {
      stickiness = suppressCell(
        round3(dauEntry.value / mauEntry.value),
        Math.min(dauEntry.userCount, mauEntry.userCount),
        k,
      );
    }

    return {
      bucket,
      dau,
      wau: cellAt(wauMap, bucket, k),
      mau,
      newUsers: cellAt(newUsersMap, bucket, k),
      newGuests: cellAt(newGuestsMap, bucket, k),
      guestConversions: cellAt(guestConvMap, bucket, k),
      stickiness,
    };
  });
}

export async function getEngagement(
  db: Db,
  r: Range,
): Promise<{ series: EngagementRow[]; retention: RetentionRow[] }> {
  const k = minCohort();
  const { from, to, granularity: g } = r;

  // Series: one SQL call for all session/round metrics.
  // NOTE: the rollup writes session_seconds_sum and sessions_with_end components
  // (not avg_session_seconds). avgSessionSeconds is derived per-bucket as
  // sum(session_seconds_sum) / sum(sessions_with_end).
  const rawRows = await fetchMetrics(
    db,
    ["sessions", "session_seconds_sum", "sessions_with_end", "rounds"],
    from,
    to,
  );

  const sessionsMap = aggregateMetric(rawRows, "sessions", g, "sum");
  const secsSumMap = aggregateMetric(rawRows, "session_seconds_sum", g, "sum");
  const withEndMap = aggregateMetric(rawRows, "sessions_with_end", g, "sum");
  const roundsMap = aggregateMetric(rawRows, "rounds", g, "sum");

  const buckets = sortedBuckets(sessionsMap, secsSumMap, withEndMap, roundsMap);

  const series: EngagementRow[] = buckets.map((bucket) => {
    const sessions = cellAt(sessionsMap, bucket, k);
    const rounds = cellAt(roundsMap, bucket, k);

    // avgSessionSeconds: sum(session_seconds_sum) / sum(sessions_with_end).
    // Privacy uses the sessions bucket userCount. When sessions_with_end = 0
    // the duration is unknown — suppress rather than emit 0.
    let avgSessionSeconds: Cell;
    const sessEntry = sessionsMap.get(bucket);
    const secsSumEntry = secsSumMap.get(bucket);
    const withEndEntry = withEndMap.get(bucket);
    const withEndTotal = withEndEntry?.value ?? 0;
    if (sessions.suppressed || !sessEntry) {
      avgSessionSeconds = { value: null, suppressed: true };
    } else if (withEndTotal === 0) {
      avgSessionSeconds = { value: null, suppressed: true };
    } else {
      const secsSum = secsSumEntry?.value ?? 0;
      avgSessionSeconds = suppressCell(round2(secsSum / withEndTotal), sessEntry.userCount, k);
    }

    // roundsPerSession derived after bucketing. Sessions = 0 means undefined ratio.
    let roundsPerSession: Cell;
    const se = sessionsMap.get(bucket);
    const re = roundsMap.get(bucket);
    if (!se || !re || se.value === 0 || sessions.suppressed || rounds.suppressed) {
      roundsPerSession = { value: null, suppressed: true };
    } else {
      roundsPerSession = suppressCell(
        round2(re.value / se.value),
        Math.min(se.userCount, re.userCount),
        k,
      );
    }

    return {
      bucket,
      sessions,
      avgSessionSeconds,
      rounds,
      roundsPerSession,
    };
  });

  // Retention: separate query on kpi_retention_cohorts.
  const retRows = toRows(
    await db.execute(sql`
      SELECT cohort_date::text AS cohort_date, day_offset, cohort_size, retained_count
      FROM kpi_retention_cohorts
      WHERE cohort_date >= ${from}::date AND cohort_date <= ${to}::date
      ORDER BY cohort_date, day_offset
    `),
  );

  const retention: RetentionRow[] = retRows.map((row) => {
    const cohortSize = Number(row.cohort_size);
    const retainedCount = Number(row.retained_count);
    const cohortSizeCell = suppressCell(cohortSize, cohortSize, k);
    const retainedRate: Cell = cohortSizeCell.suppressed
      ? { value: null, suppressed: true }
      : suppressCell(round2(retainedCount / cohortSize), cohortSize, k);
    return {
      cohortDate: String(row.cohort_date),
      dayOffset: Number(row.day_offset),
      cohortSize: cohortSizeCell,
      retainedRate,
    };
  });

  return { series, retention };
}

export async function getContent(
  db: Db,
  r: Range & {
    dimension: "song" | "genre" | "decade";
    limit: number;
    catalogFilter: { songIds?: number[]; artists?: string[] } | null;
  },
): Promise<ContentRow[]> {
  const k = minCohort();
  const { from, to, dimension, limit, catalogFilter } = r;

  // A filtered vendor sees only song-level stats for their catalog; aggregate
  // dimensions (genre/decade) are not catalog-filterable.
  if (dimension !== "song" && catalogFilter !== null) {
    return [];
  }

  if (dimension === "song") {
    const songIds = catalogFilter?.songIds ?? [];
    const artistsLower = (catalogFilter?.artists ?? []).map((a) => a.toLowerCase());

    // Build the optional catalog filter predicate.
    // user_count uses max of daily counts: a user active 2 days isn't 2 users;
    // max of daily per-song user counts is an honest lower bound on reach.
    let catalogPredicate = sql``;
    if (songIds.length > 0 && artistsLower.length > 0) {
      catalogPredicate = sql` AND (st.song_id = ANY(${songIds}) OR lower(s."artistName") = ANY(${artistsLower}))`;
    } else if (songIds.length > 0) {
      catalogPredicate = sql` AND st.song_id = ANY(${songIds})`;
    } else if (artistsLower.length > 0) {
      catalogPredicate = sql` AND lower(s."artistName") = ANY(${artistsLower})`;
    }

    const rawSongRows = toRows(
      await db.execute(sql`
        SELECT s.title || ' — ' || s."artistName" AS key,
               COALESCE(sum(st.displays),0)::int AS displays,
               COALESCE(sum(st.rounds_played),0)::int AS rounds_played,
               COALESCE(sum(st.correct_rounds),0)::int AS correct_rounds,
               COALESCE(sum(st.response_seconds_sum),0) AS response_seconds_sum,
               COALESCE(sum(st.response_count),0)::int AS response_count,
               COALESCE(max(st.user_count),0)::int AS user_count
        FROM kpi_daily_song_stats st JOIN songs s ON s.id = st.song_id
        WHERE st.date >= ${from}::date AND st.date <= ${to}::date
        ${catalogPredicate}
        GROUP BY s.id, s.title, s."artistName"
        ORDER BY 2 DESC
        LIMIT ${limit}
      `),
    );

    return rawSongRows.map((row) => {
      const uc = Number(row.user_count);
      const roundsPlayedVal = Number(row.rounds_played);
      const responseCount = Number(row.response_count);
      const suppressed = uc < k;

      const makeCell = (value: number): Cell =>
        suppressed ? { value: null, suppressed: true } : { value, suppressed: false };

      const correctRate =
        roundsPlayedVal > 0 ? round2(Number(row.correct_rounds) / roundsPlayedVal) : 0;
      const avgResponseSeconds =
        responseCount > 0 ? round2(Number(row.response_seconds_sum) / responseCount) : 0;

      return {
        key: String(row.key),
        displays: makeCell(Number(row.displays)),
        roundsPlayed: makeCell(roundsPlayedVal),
        correctRate: makeCell(correctRate),
        avgResponseSeconds: makeCell(avgResponseSeconds),
      };
    });
  }

  // genre or decade: read kpi_daily_metrics dimension rows, sum per dimension_value.
  // catalogFilter is guaranteed null here (checked above).
  const dimName = dimension; // "genre" | "decade"
  const rawRows = await fetchMetrics(db, ["displays"], from, to);
  const filtered = rawRows.filter((row) => row.dimension === dimName);

  // Aggregate by dimension_value across the date range (no bucketing — return totals).
  const aggMap = new Map<string, { value: number; userCount: number }>();
  for (const row of filtered) {
    const cur = aggMap.get(row.dimension_value) ?? { value: 0, userCount: 0 };
    aggMap.set(row.dimension_value, {
      value: cur.value + row.value,
      userCount: cur.userCount + row.user_count,
    });
  }

  // Build cells for each dimension_value; apply breakdown suppression across all.
  const entries = Array.from(aggMap.entries()).map(([key, { value, userCount }]) => ({
    key,
    value: value as number | null,
    userCount,
    suppressed: false,
  }));
  const suppressed = applyBreakdownSuppression(entries, k);

  return suppressed
    .map((c) => ({
      key: c.key,
      displays: { value: c.value, suppressed: c.suppressed } as Cell,
      // roundsPlayed / correctRate / avgResponseSeconds are not measured at
      // genre/decade grain — emit null = not applicable (not suppressed).
      roundsPlayed: { value: null, suppressed: false } as Cell,
      correctRate: { value: null, suppressed: false } as Cell,
      avgResponseSeconds: { value: null, suppressed: false } as Cell,
    }))
    .sort((a, b) => {
      const av = a.displays.value;
      const bv = b.displays.value;
      if (av === null && bv === null) return 0;
      if (av === null) return 1; // nulls last
      if (bv === null) return -1;
      return bv - av; // descending
    });
}

export async function getMonetization(db: Db, r: Range): Promise<MonetizationRow[]> {
  const k = minCohort();
  const { from, to, granularity: g } = r;

  const rawRows = await fetchMetrics(
    db,
    [
      "dau",
      "gn_purchased",
      "gn_spent",
      "addon_revenue_usd",
      "entry_fee_revenue_usd",
      "prizes_paid_usd",
      "active_subscriptions",
    ],
    from,
    to,
  );

  // Additive metrics (sum + summed userCount).
  const dauMap = aggregateMetric(rawRows, "dau", g, "avg");
  const gnPurchasedMap = aggregateMetric(rawRows, "gn_purchased", g, "sum");
  const addonMap = aggregateMetric(rawRows, "addon_revenue_usd", g, "sum");
  const entryFeeMap = aggregateMetric(rawRows, "entry_fee_revenue_usd", g, "sum");
  const prizesMap = aggregateMetric(rawRows, "prizes_paid_usd", g, "sum");

  // Breakdown by kind/tier.
  const gnSpentKindMap = aggregateByDimValue(rawRows, "gn_spent", "kind", g, "sum");
  const subsTierMap = aggregateByDimValue(rawRows, "active_subscriptions", "tier", g, "last");

  const buckets = sortedBuckets(
    dauMap,
    gnPurchasedMap,
    addonMap,
    entryFeeMap,
    prizesMap,
    gnSpentKindMap,
    subsTierMap,
  );

  return buckets.map((bucket) => {
    const dau = cellAt(dauMap, bucket, k);

    // arpdau = (addon + entry_fee) / dau; suppressed if dau is suppressed or zero.
    const addonEntry = addonMap.get(bucket);
    const entryFeeEntry = entryFeeMap.get(bucket);
    const dauEntry = dauMap.get(bucket);
    let arpdau: Cell;
    if (!dauEntry || dau.suppressed || dau.value === 0 || dau.value === null) {
      arpdau = { value: null, suppressed: true };
    } else {
      const addonVal = addonEntry?.value ?? 0;
      const entryFeeVal = entryFeeEntry?.value ?? 0;
      const arpdauVal = round4((addonVal + entryFeeVal) / dauEntry.value);
      arpdau = { value: arpdauVal, suppressed: false };
    }

    return {
      bucket,
      gnPurchased: cellAt(gnPurchasedMap, bucket, k),
      gnSpentByKind: breakdownCells(gnSpentKindMap.get(bucket), k),
      addonRevenueUsd: cellAt(addonMap, bucket, k),
      entryFeeRevenueUsd: cellAt(entryFeeMap, bucket, k),
      prizesPaidUsd: cellAt(prizesMap, bucket, k),
      subscriptionsByTier: breakdownCells(subsTierMap.get(bucket), k),
      arpdau,
    };
  });
}
