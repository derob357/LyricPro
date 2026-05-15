/**
 * DDEX DSR Basic Audio Profile flat-file generator.
 *
 * Produces DDEX Digital Sales Report (DSR) Basic Audio Profile v1.4 flat-files
 * (Multi Record Block Variant) reporting LyricPro lyric-display usage to music
 * publishers/aggregators.
 *
 * Reference: docs/superpowers/research/2026-05-15-ddex-dsr-basic-audio-profile.md
 *
 * This is a PURE function module — no database access, no drizzle imports. It
 * receives already-fetched `SongDisplayWithSong[]` rows. Task 3.4 wires it to a
 * tRPC route that supplies real `song_displays` rows.
 *
 * NOTE ON `DDEX-UNVERIFIED:` COMMENTS — several record details could not be
 * pinned down from public DDEX sources (notably the exact FOOT cell layout and
 * the HEAD MessageVersion string). Those are implemented to the research doc's
 * best guess and flagged inline. They must be confirmed against the official
 * Part 8 v1.4 PDF before go-live.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Public API contract — a later task (3.4) depends on these exact shapes.
// ─────────────────────────────────────────────────────────────────────────────

export interface ExportContext {
  /** Our DDEX party name/id; until registered with DDEX use 'LYRICPRO-UNREGISTERED'. */
  messageSender: string;
  /** Publisher/aggregator party id for this export (the licensor receiving the report). */
  messageRecipient: string;
  reportingPeriodStart: Date;
  reportingPeriodEnd: Date;
  /** Optional ISO-3166-1 alpha-2 territory filter. When set, only matching rows are reported. */
  territoryFilter?: string[];
  /**
   * DDEX message-version string for the HEAD record (cell 2).
   * Placeholder (e.g. '2025-current') until a real DDEX sample pins the exact
   * `dsrf/.../...` value. See DDEX-UNVERIFIED note on HEAD below.
   */
  messageVersion: string;
  /**
   * Injectable clock for deterministic output (used by snapshot tests). When
   * omitted, the current wall-clock time is used for MessageCreatedDateTime and
   * the filename timestamp.
   */
  now?: Date;
}

export interface SongDisplayWithSong {
  songId: number;
  variantIndex: number;
  /** ISO timestamp of when the lyric was shown. */
  shownAt: string;
  /** ISO-3166-1 alpha-2 territory code, or null when unknown. */
  territoryCode: string | null;
  durationOfUseSeconds: number | null;
  /** LyricPro commercial model: 'free' | 'subscription' | 'ad_supported' | 'entry_fee'. */
  commercialModelType: string;
  serviceDescription: string;
  grossRevenuePerEventMicros: number;
  /** ISO 4217 currency code. */
  currencyCode: string;
  attributionServed: string | null;
  title: string;
  artistName: string;
  /** ISO 15707 ISWC, or null. */
  iswc: string | null;
  /** ISO 3901 ISRC, or null. Rows with null ISRC are routed to the no-match file. */
  isrc: string | null;
}

export interface DdexExportResult {
  /** The primary DSR file: all rows that carry an ISRC. */
  mainFile: string;
  /** Supplemental no-match tranche: rows lacking an ISRC. null when there are none. */
  noMatchFile: string | null;
  /** DDEX-conformant filename for `mainFile`. */
  filename: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants — record-type codes & DDEX profile identifiers (research doc §1, §2).
// ─────────────────────────────────────────────────────────────────────────────

/** Field (cell) separator — TAB U+0009 (research doc §1.2). */
const TAB = "\t";
/** Secondary delimiter for multi-value cells — pipe U+007C (research doc §1.2). */
const MULTI = "|";
/** Line terminator — LF (research doc §1.2). */
const EOL = "\n";

const PROFILE = "BasicAudioProfile"; // MRBV profile name (research doc §2, HEAD cell 3).
const PROFILE_VERSION = "1.4"; // Basic Audio Profile v1.4 (research doc §2).

/**
 * UseType for an on-screen lyric-display event.
 *
 * Research doc §6.1: there is NO DDEX UseType value meaning "on-screen lyric
 * display." `OnDemandStream` is the doc's recommended default — a lyric view is
 * a user-initiated, fully-interactive on-demand consumption of a specific work,
 * and SU02.03 (the streaming SU record) is the only SU type that fits a
 * non-download interaction. A bilaterally-agreed user-defined value
 * (e.g. `ns::LyricDisplay`) is the more honest alternative if the recipient
 * agrees — see research doc §6.1 option 2.
 */
const LYRIC_DISPLAY_USE_TYPE = "OnDemandStream";

/**
 * LyricPro commercial-model → DDEX CommercialModelType AVS (research doc §3.2).
 *
 * `entry_fee` has no exact DDEX equivalent. It maps to `PayAsYouGoModel` — the
 * DDEX value for a one-time payment to obtain a specific item — because an
 * entry fee is a single up-front consumer payment to access content, which is
 * the closest semantic match among the five AVS values. This choice is flagged
 * DDEX-UNVERIFIED below.
 */
const COMMERCIAL_MODEL_MAP: Record<string, string> = {
  free: "FreeOfChargeModel",
  subscription: "SubscriptionModel",
  ad_supported: "AdvertisementSupportedModel",
  // DDEX-UNVERIFIED: 'entry_fee' has no exact CommercialModelType AVS value.
  // PayAsYouGoModel is the closest fit (single up-front payment for access).
  entry_fee: "PayAsYouGoModel",
};

function mapCommercialModel(lyricProModel: string): string {
  const mapped = COMMERCIAL_MODEL_MAP[lyricProModel];
  if (mapped) return mapped;
  // DDEX-UNVERIFIED: unknown LyricPro model — fall back to FreeOfChargeModel
  // rather than emitting an invalid AVS value. Should not occur in practice.
  return "FreeOfChargeModel";
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregation / conglomeration (research doc §4).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A conglomerated usage group — one aggregated reporting record. The DSR format
 * is aggregated, not a raw event log: many input rows collapse into one group.
 */
interface UsageGroup {
  isrc: string;
  iswc: string | null;
  title: string;
  artistName: string;
  territoryCode: string;
  /** LyricPro commercial-model key (pre-mapping). */
  commercialModelType: string;
  useType: string;
  serviceDescription: string;
  currencyCode: string;
  /** Count of lyric-display events in this group → SU02.03 NumberOfStreams. */
  playCount: number;
  /** Summed gross revenue, in micros (1e-6 currency units). */
  revenueMicros: number;
  /** Summed duration-of-use in seconds (informational only — not emitted; see §6.1). */
  durationSeconds: number;
}

/**
 * Group rows by (isrc, territoryCode, commercialModelType, useType) and sum
 * play counts, revenue and duration into one UsageGroup per key.
 *
 * Rows whose `isrc` is null are skipped here — the caller routes them to the
 * no-match file separately.
 */
function conglomerate(rows: SongDisplayWithSong[]): UsageGroup[] {
  const byKey = new Map<string, UsageGroup>();

  for (const row of rows) {
    if (row.isrc === null) continue; // no-match rows handled by caller.
    // territoryCode may be null in raw data; use 'Worldwide' aggregate code
    // (research doc §3.3) when the row has no territory.
    const territory = row.territoryCode ?? "Worldwide";
    const useType = LYRIC_DISPLAY_USE_TYPE;
    const key = [row.isrc, territory, row.commercialModelType, useType].join(
      " ",
    );

    let group = byKey.get(key);
    if (!group) {
      group = {
        isrc: row.isrc,
        iswc: row.iswc,
        title: row.title,
        artistName: row.artistName,
        territoryCode: territory,
        commercialModelType: row.commercialModelType,
        useType,
        serviceDescription: row.serviceDescription,
        currencyCode: row.currencyCode,
        playCount: 0,
        revenueMicros: 0,
        durationSeconds: 0,
      };
      byKey.set(key, group);
    }
    group.playCount += 1;
    group.revenueMicros += row.grossRevenuePerEventMicros;
    group.durationSeconds += row.durationOfUseSeconds ?? 0;
  }

  // Stable, deterministic ordering for reproducible snapshots.
  return Array.from(byKey.values()).sort((a, b) => {
    if (a.isrc !== b.isrc) return a.isrc < b.isrc ? -1 : 1;
    if (a.territoryCode !== b.territoryCode)
      return a.territoryCode < b.territoryCode ? -1 : 1;
    if (a.commercialModelType !== b.commercialModelType)
      return a.commercialModelType < b.commercialModelType ? -1 : 1;
    return a.useType < b.useType ? -1 : 1;
  });
}

/**
 * A sales context = the tuple (CommercialModelType, UseType, Territory,
 * Service) — one SY01.03 summary record per context (research doc §4).
 */
interface SalesContext {
  summaryRecordId: string;
  commercialModelType: string; // LyricPro key.
  useType: string;
  territoryCode: string;
  serviceDescription: string;
  currencyCode: string;
  groups: UsageGroup[];
}

/** Bucket UsageGroups into sales contexts (one SY record per bucket). */
function buildSalesContexts(groups: UsageGroup[]): SalesContext[] {
  const byKey = new Map<string, SalesContext>();
  let seq = 0;

  for (const group of groups) {
    const key = [
      group.commercialModelType,
      group.useType,
      group.territoryCode,
      group.serviceDescription,
    ].join(" ");

    let ctx = byKey.get(key);
    if (!ctx) {
      seq += 1;
      ctx = {
        summaryRecordId: `SUM-${seq}`,
        commercialModelType: group.commercialModelType,
        useType: group.useType,
        territoryCode: group.territoryCode,
        serviceDescription: group.serviceDescription,
        currencyCode: group.currencyCode,
        groups: [],
      };
      byKey.set(key, ctx);
    }
    ctx.groups.push(group);
  }

  return Array.from(byKey.values());
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip TAB / pipe / line-break characters from a cell value. DDEX flat files
 * do not quote/escape — producers must sanitise input (research doc §1.2).
 */
function sanitizeCell(value: string): string {
  return value.replace(/[\t|\r\n]+/g, " ").trim();
}

/** Join cells into one TSV record line. */
function record(cells: (string | number)[]): string {
  return cells.map((c) => (typeof c === "number" ? String(c) : c)).join(TAB);
}

/** ISO 8601 date-only `YYYY-MM-DD` (HEAD UsageStartDate/UsageEndDate). */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** RFC-3339 timestamp `YYYY-MM-DDThh:mm:ssZ` for HEAD MessageCreatedDateTime. */
function rfc3339(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Basic-format zero-padded ISO 8601 timestamp `yyyymmddThhmmss`, no timezone
 * designator — the only form allowed in the DSR filename (research doc §1.1).
 */
function basicTimestamp(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace(/Z$/, "");
}

/** Convert micros (1e-6 units) to a fixed-2-decimal currency string. */
function microsToDecimal(micros: number): string {
  return (micros / 1_000_000).toFixed(2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Record builders (research doc §2).
// ─────────────────────────────────────────────────────────────────────────────

/** Build the HEAD record — exactly 1, first line of the file (research doc §2.2). */
function buildHead(
  ctx: ExportContext,
  createdAt: Date,
  messageId: string,
): string {
  return record([
    "HEAD",
    // DDEX-UNVERIFIED: HEAD cell 2 (MessageVersion) — the precise `dsrf/.../...`
    // string is profile/version-specific and was not pinned by public sources
    // (research doc §6.2). We emit ctx.messageVersion verbatim as a placeholder.
    ctx.messageVersion,
    PROFILE, // cell 3 Profile.
    PROFILE_VERSION, // cell 4 ProfileVersion.
    messageId, // cell 5 MessageId.
    rfc3339(createdAt), // cell 6 MessageCreatedDateTime (RFC-3339 inside the file).
    1, // cell 7 FileNumber — single-file report.
    1, // cell 8 NumberOfFiles — single-file report.
    isoDate(ctx.reportingPeriodStart), // cell 9 UsageStartDate.
    isoDate(ctx.reportingPeriodEnd), // cell 10 UsageEndDate.
    sanitizeCell(ctx.messageSender), // cell 11 SenderPartyId (DPID).
    sanitizeCell(ctx.messageSender), // cell 12 SenderName — same value until a real DPID/name pair exists.
    "LyricProApp", // cell 13 ServiceDescription — no spaces/underscores.
    sanitizeCell(ctx.messageRecipient), // cell 14 RecipientPartyId (DPID).
    sanitizeCell(ctx.messageRecipient), // cell 15 RecipientName — same value until a real DPID/name pair exists.
    "", // cell 16 RepresentedRepertoire (Optional) — left blank.
  ]);
}

/**
 * Build one SY01.03 Basic Summary record per sales context (research doc §2.3).
 * TotalUsages / NetRevenue are the aggregate across the context's SU rows.
 */
function buildSummary(ctx: SalesContext): string {
  const totalUsages = ctx.groups.reduce((n, g) => n + g.playCount, 0);
  const netRevenueMicros = ctx.groups.reduce(
    (n, g) => n + g.revenueMicros,
    0,
  );
  return record([
    "SY01.03",
    ctx.summaryRecordId, // cell 2 SummaryRecordId.
    "LyricProApp", // cell 3 DistributionChannel.
    "", // cell 4 DistributionChannelDPID — unknown, blank.
    mapCommercialModel(ctx.commercialModelType), // cell 5 CommercialModelType.
    ctx.useType, // cell 6 UseType.
    ctx.territoryCode, // cell 7 Territory.
    sanitizeCell(ctx.serviceDescription), // cell 8 ServiceDescription.
    totalUsages, // cell 9 TotalUsages.
    "", // cell 10 Subscribers — not tracked here, blank.
    ctx.currencyCode, // cell 11 CurrencyOfReporting.
    microsToDecimal(netRevenueMicros), // cell 12 NetRevenue.
    "", // cell 13 IndirectValue (Optional).
    "", // cell 14 CurrencyOfTransaction (Optional).
    "", // cell 15 ExchangeRate.
    "", // cell 16 ExchangeRateSource.
    "", // cell 17 DateOfCurrencyExchange.
    "", // cell 18 TotalPlaybackDuration — omitted for lyric display (research doc §6.1).
  ]);
}

/**
 * Build the RE01.03 head-release record for a Block (research doc §2.4).
 * LyricPro has no real release metadata, so we emit a synthetic single-track
 * "release" wrapping the recording (research doc §2.4 note).
 */
function buildReleaseBlock(
  blockId: string,
  group: UsageGroup,
  releaseRef: string,
): string {
  return record([
    "RE01.03",
    blockId, // cell 2 BlockId.
    releaseRef, // cell 3 ReleaseReference — unique within the Block.
    `REL-${group.isrc}`, // cell 4 DspReleaseId — LyricPro proprietary id.
    "", // cell 5 ProprietaryReleaseId (Optional).
    "", // cell 6 ReleaseCatalogNumber (Optional).
    "", // cell 7 ReleaseIcpn — no barcode for a synthetic release.
    sanitizeCell(group.artistName), // cell 8 ReleaseDisplayArtistName.
    "", // cell 9 ReleaseDisplayArtistPartyId (Optional) — no DPID available.
    sanitizeCell(group.title), // cell 10 ReleaseTitle.
    "", // cell 11 ReleaseSubTitle (Optional).
    "Single", // cell 12 ReleaseType — synthetic single-track release.
    "", // cell 13 ReleaseLabelName (Optional).
    "", // cell 14 ReleasePLine (Optional).
    "LyricPro", // cell 15 ReleaseDataProviderName — self-generated data.
    "", // cell 16 ReleaseDate (Optional).
    sanitizeCell(group.artistName), // cell 17 ReleaseDisplayArtist.
  ]);
}

/**
 * Build the AS02.04 sound-recording + musical-work record for a Block
 * (research doc §2.5). AS02.04 is preferred over AS01.03+MW01.03 — it carries
 * both recording and work data inline, which is what a publisher needs.
 */
function buildResource(
  blockId: string,
  group: UsageGroup,
  resourceRef: string,
): string {
  return record([
    "AS02.04",
    blockId, // cell 2 BlockId.
    resourceRef, // cell 3 ResourceReference.
    `RES-${group.isrc}`, // cell 4 DspResourceId — LyricPro proprietary id.
    group.isrc, // cell 5 ResourceISRC.
    sanitizeCell(group.title), // cell 6 ResourceTitle.
    "", // cell 7 ResourceSubTitle (Optional).
    sanitizeCell(group.artistName), // cell 8 ResourceDisplayArtistName.
    "", // cell 9 ResourceDisplayArtistPartyId (Optional).
    "", // cell 10 ResourceDuration — recording length unknown; blank (research doc §6.1).
    "SoundRecording", // cell 11 ResourceType.
    group.iswc ?? "", // cell 12 MusicalWorkISWC — the identifier publishers care about most.
    "", // cell 13 MusicalWorkComposerAuthorName — not available.
    "", // cell 14 MusicalWorkComposerAuthorPartyId (Optional).
    "", // cell 15 MusicalWorkArrangerName — not available.
    "", // cell 16 MusicalWorkArrangerPartyId (Optional).
    "", // cell 17 MusicalWorkPublisherName — not available.
    "", // cell 18 MusicalWorkPublisherPartyId (Optional).
    "", // cell 19 MusicalWorkContributorName — not available.
    "", // cell 20 MusicalWorkContributorPartyId.
    "", // cell 21 ProprietaryMusicalWorkId (Optional).
    "true", // cell 22 IsMasterRecording — lyric is for a master recording.
    "false", // cell 23 IsSubjectToOwnershipConflict.
    "", // cell 24 LastConflictCheck — not applicable (conflict flag is false).
    sanitizeCell(group.artistName), // cell 25 ResourceDisplayArtist.
  ]);
}

/**
 * Build the SU02.03 streaming sales/usage record for a Block (research doc
 * §2.6). One row per recording per use-type — NumberOfStreams is the SUMMED
 * count of lyric-display events for that group.
 */
function buildUsageRecord(
  blockId: string,
  summaryRecordId: string,
  group: UsageGroup,
  resourceRef: string,
  transactionId: string,
): string {
  // IsRoyaltyBearing: a free-model lyric display carries no royalty; any paid
  // or ad-supported context is treated as royalty-bearing. Final value is
  // governed by the licensing agreement (research doc §6.1).
  const isRoyaltyBearing = group.commercialModelType !== "free";
  return record([
    "SU02.03",
    blockId, // cell 2 BlockId.
    summaryRecordId, // cell 3 SummaryRecordId — links to the governing SY record.
    transactionId, // cell 4 SalesTransactionId — identifies this aggregated row.
    "", // cell 5 TransactedReleaseReference — blank; we populate cell 6 instead.
    resourceRef, // cell 6 TransactedResourceReference — one of 5/6 must be set.
    isRoyaltyBearing ? "true" : "false", // cell 7 IsRoyaltyBearing.
    group.playCount, // cell 8 NumberOfStreams — summed lyric-view events.
    "", // cell 9 PriceEndUserPaidExcSalesTax — only required for PayAsYouGoModel.
    "", // cell 10 PromotionalActivity (Optional).
    group.useType, // cell 11 UseType.
    "", // cell 12 PlaybackDuration — omitted for lyric display (research doc §6.1).
  ]);
}

/**
 * Build the FOOT record — exactly 1, last line of the file (research doc §2.7).
 *
 * DDEX-UNVERIFIED: the exact FOOT cell list/order is NOT confirmed — Part 8
 * §5.1.2 was unreachable during research (research doc §2.7, §6.2). The doc
 * states FOOT is 6 cells carrying check data including record counts, with
 * NumberOfLinesInReport and NumberOfBlocksInReport mandatory in the last file.
 * Cells 2-6 below are a best-effort reconstruction. For a single-file report,
 * lines-in-file == lines-in-report. Cells 5-6 (additional check cells of
 * unconfirmed meaning) are left blank.
 */
function buildFoot(numberOfLines: number, numberOfBlocks: number): string {
  return record([
    "FOOT",
    numberOfLines, // cell 2 NumberOfLinesInFile (incl. HEAD + FOOT).
    numberOfLines, // cell 3 NumberOfLinesInReport — == cell 2 for single-file report.
    numberOfBlocks, // cell 4 NumberOfBlocksInReport.
    "", // cell 5 — DDEX-UNVERIFIED additional check cell, blank.
    "", // cell 6 — DDEX-UNVERIFIED additional check cell, blank.
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// File rendering.
// ─────────────────────────────────────────────────────────────────────────────

type DsrVariant = "main" | "no-match";

/**
 * Render one complete DSR flat-file (HEAD → SY records → Blocks → FOOT).
 *
 * For the `no-match` variant, the rows have no ISRC; we still emit a complete
 * DSR file shape, using DspResourceId as the recording key. The no-match file
 * is a supplemental tranche the recipient processes separately (it cannot be
 * matched to a recording/work without an ISRC).
 */
function renderDsrFile(
  groups: UsageGroup[],
  ctx: ExportContext,
  variant: DsrVariant,
  createdAt: Date,
): string {
  const messageId = `MSG-${variant.toUpperCase()}-${basicTimestamp(createdAt)}`;
  const contexts = buildSalesContexts(groups);

  const lines: string[] = [];
  lines.push(buildHead(ctx, createdAt, messageId));

  // All SY summary records come first (after HEAD, before any Block).
  for (const salesContext of contexts) {
    lines.push(buildSummary(salesContext));
  }

  // Then the Blocks: one Block (RE + AS + SU) per UsageGroup.
  let blockSeq = 0;
  let txnSeq = 0;
  for (const salesContext of contexts) {
    for (const group of salesContext.groups) {
      blockSeq += 1;
      txnSeq += 1;
      const blockId = `BLK-${blockSeq}`;
      const ref = "1"; // ReleaseReference / ResourceReference — unique within the Block.
      lines.push(buildReleaseBlock(blockId, group, ref));
      lines.push(buildResource(blockId, group, ref));
      lines.push(
        buildUsageRecord(
          blockId,
          salesContext.summaryRecordId,
          group,
          ref,
          `TXN-${txnSeq}`,
        ),
      );
    }
  }

  // FOOT: line count includes HEAD + FOOT itself; block count is total Blocks.
  const numberOfLines = lines.length + 1;
  lines.push(buildFoot(numberOfLines, blockSeq));

  return lines.join(EOL) + EOL;
}

/**
 * Build the DDEX-conformant filename (research doc §1.1):
 *   DSR_<recipient>_<sender>_<service>_<period>_<territory>_<created>.tsv
 * `xofy` counter is omitted for single-file reports.
 */
function buildFilename(
  ctx: ExportContext,
  createdAt: Date,
  groups: UsageGroup[],
): string {
  const period = `${isoDate(ctx.reportingPeriodStart)}--${isoDate(
    ctx.reportingPeriodEnd,
  )}`;
  // Territory token: a single shared code when every group is the same
  // territory, otherwise the DDEX-defined `Worldwide` aggregate (research §3.3).
  const territories = Array.from(
    new Set(groups.map((g) => g.territoryCode)),
  );
  const territory = territories.length === 1 ? territories[0] : "Worldwide";
  // Filename tokens must contain no special characters (research doc §1.1) —
  // strip anything outside [A-Za-z0-9-].
  const clean = (s: string) => s.replace(/[^A-Za-z0-9-]/g, "");
  return [
    "DSR",
    clean(ctx.messageRecipient),
    clean(ctx.messageSender),
    "LyricProApp",
    period,
    clean(territory),
    basicTimestamp(createdAt),
  ].join("_") + ".tsv";
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a DDEX DSR Basic Audio Profile flat-file report from LyricPro
 * lyric-display rows.
 *
 * Behaviours (per the task spec):
 *  - ISRC split: rows with `isrc === null` go to `noMatchFile`; rows with an
 *    ISRC go to `mainFile`. `noMatchFile` is null when there are no no-match rows.
 *  - Conglomeration: rows are grouped by (isrc, territory, commercialModel,
 *    useType) and play counts / revenue / duration are summed.
 *  - territoryFilter (when supplied) restricts the input to matching territories.
 */
export function generateDdexDsr(
  rows: SongDisplayWithSong[],
  ctx: ExportContext,
): DdexExportResult {
  const createdAt = ctx.now ?? new Date();

  // Optional territory filter (ISO-3166-1 alpha-2).
  const filtered = ctx.territoryFilter
    ? rows.filter(
        (r) =>
          r.territoryCode !== null &&
          ctx.territoryFilter!.includes(r.territoryCode),
      )
    : rows;

  // ISRC split — matched rows vs no-match rows.
  const matchedRows = filtered.filter((r) => r.isrc !== null);
  const noMatchRows = filtered.filter((r) => r.isrc === null);

  const matchedGroups = conglomerate(matchedRows);
  const mainFile = renderDsrFile(matchedGroups, ctx, "main", createdAt);
  const filename = buildFilename(ctx, createdAt, matchedGroups);

  let noMatchFile: string | null = null;
  if (noMatchRows.length > 0) {
    // No-match rows lack an ISRC, so they cannot be keyed by it. We synthesise
    // a stable per-recording key from songId so conglomerate() still groups
    // repeat displays of the same untracked song. The result is flagged as a
    // no-match supplemental tranche the recipient processes separately.
    const keyed = noMatchRows.map((r) => ({
      ...r,
      isrc: `NOMATCH-SONG-${r.songId}`,
    }));
    const noMatchGroups = conglomerate(keyed);
    noMatchFile = renderDsrFile(noMatchGroups, ctx, "no-match", createdAt);
  }

  return { mainFile, noMatchFile, filename };
}
