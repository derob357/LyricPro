# DDEX DSR Basic Audio Profile — Flat-File Format Research

**Date:** 2026-05-15
**Purpose:** Reference spec for implementing `generateDdexDsr()` — a generator that produces DDEX DSR Basic Audio Profile flat-files to report LyricPro lyric-display usage to publishers/aggregators.
**Confidence:** Medium-high. Most content is from the official DDEX dedicated spec sites (`dsr1.ddex.net`, `dsr3.ddex.net`, `dsr8.ddex.net`) and the DDEX Knowledge Base. Several record-detail pages 404'd on direct fetch and were reconstructed from search-result extracts of those same official pages. Cell *ordering* for HEAD, SU01.03, SU02.03, SY01.03, RE01.03, AS01.03, AS02.04, MW01.03 is from official Part 8 pages. **Anything marked `[INFERENCE]` is not directly quoted from a source — verify against the official PDF before go-live.**

> **IMPORTANT — version note.** DDEX publishes DSR profiles as numbered *Parts* (Part 1 Architecture, Part 3 Basic Audio Profile, Part 8 Record Type Definitions). Record type codes carry a two-digit version suffix (e.g. `AS01.03`, `SU02.03`). The profile version current at research time is **Basic Audio Profile v1.4**, which binds the specific record-type versions listed in §2. Always confirm you are emitting the record versions that match the `ProfileVersion` you declare in HEAD.

---

## 1. File-level structure

### 1.1 File naming convention

Every file that makes up a Sales/Usage Report is named with this pattern (source: DSR Part 1, §8.1):

```
DSR_<MessageRecipient>_<MessageSender>_<ServiceDescription>_<MessageNotificationPeriod>_<TerritoryOfUseOrSale>_<xofy>_<MessageCreatedDateTime>.<ext>
```

| Token | Meaning | Format / constraints |
|---|---|---|
| `DSR` | Fixed literal prefix for all DSR sales/usage report files. | Always `DSR`. |
| `MessageRecipient` | Party name **or** DDEX Party ID (DPID) of the **licensor** (the publisher/aggregator receiving the report). Must match the `RecipientPartyId` (or `RepresentedRepertoire`) cell in the HEAD record. Optional when sending to multiple licensors. | No special characters (no spaces, slashes, etc.). |
| `MessageSender` | Party name or DPID of the **licensee** (LyricPro) — or the entity on whose behalf the report is sent. Must match `SenderPartyId` (or `DistributionChannelDpid`) in the relevant records. | No special characters. |
| `ServiceDescription` | Name of the service / tier being reported (e.g. `LyricProApp`). Multiple tiers joined with hyphen `U+2010`. | No spaces or underscores. |
| `MessageNotificationPeriod` | The reporting period. ISO 8601 forms: `yyyy`, `yyyy-mm`, `yyyy-mm-dd`, `yyyy-Qq` (quarter), `yyyy-Www` (ISO week, Monday start), or a range `yyyy-mm-dd--yyyy-mm-dd`. | Pick one form; for monthly publisher reporting `yyyy-mm` is typical. |
| `TerritoryOfUseOrSale` | ISO territory code for a single-territory report; a mutually-agreed value for a multi-territory report. | ISO 3166-1 alpha-2 (see §3.3). `Worldwide` is a defined value for global. |
| `xofy` | File counter, e.g. `7of9`. **Omitted entirely** (including surrounding underscore) for single-file reports. | `<n>of<m>`. |
| `MessageCreatedDateTime` | When the file was created. Only allowed form: full **basic** zero-padded ISO 8601 with no timezone designator, optional milliseconds: `yyyymmddThhmmss[mmm]`. | e.g. `20260515T031500`. |
| `ext` | File extension. | `.tsv` for plain; `.tsv.gz` for gzip-compressed. |

Example (single file, monthly, US):
```
DSR_PADPIDA2021010101A_PADPIDA2026051501B_LyricProApp_2026-04_US_20260515T031500.tsv
```

### 1.2 File packaging & encoding

| Aspect | Value (source: DSR Part 1) |
|---|---|
| Encoding | **UTF-8, big-endian byte ordering.** |
| Field (cell) separator | **TAB** — Unicode `U+0009`. |
| Secondary delimiter (multi-value cell) | **Pipe** `\|` — Unicode `U+007C`. Used when one cell carries 2+ data elements (e.g. multiple ISRCs, multiple artist names). |
| Line terminator | LF (`U+000A`) **or** CR+LF (`U+000D U+000A`). One record per line. |
| Compression | Optional gzip; signalled by `.tsv.gz` extension. A report may also be split across multiple files (`xofy`). The flat file is **not** a zip archive itself — it is a bare TSV (optionally gzip-streamed). |
| Escaping | DDEX flat files do **not** use quoting/escaping the way RFC-4180 CSV does. Data values must not themselves contain a TAB, pipe, or line break. Strip/normalise such characters from titles/artist names before writing. `[INFERENCE]` — confirmed behaviourally; the spec relies on producers sanitising input rather than escaping. |

### 1.3 Blocks per file

A report has **exactly one HEAD record** (first line of each file), **one or more Summary records**, **zero or more Blocks** of detail records, and **exactly one FOOT record** (last line). A single physical file may contain many Blocks. When a report is split across multiple files, HEAD repeats in each file but the report-level totals in FOOT are only mandatory in the **last** file.

---

## 2. Record types — Basic Audio Profile (Multi Record Block Variant)

The Basic Audio Profile has two variants:

- **MRBV — Multi Record Block Variant** (DDEX-recommended; profile name `BasicAudioProfile`). Detail data is split across several record types organised into Blocks. **Use this.**
- **SRBV — Single Record Block Variant** (profile name `BasicAudioProfileSRB`). Each transaction is one fat row (`SR01.02` for downloads, `SR02.02` for streaming). Simpler to emit but less expressive. Footer is `SRFO`, not `FOOT`.

This section documents **MRBV** record types for Basic Audio Profile v1.4. The version suffixes below are the ones bound by Profile v1.4 (source: DSR Part 3 version table).

### 2.1 Record types and order

Overall file structure (MRBV):

```
HEAD                              ← exactly 1, first line
SY01.03 (or SY02.04/SY03.02/...)  ← 1..n summary records
[ Block ]                          ← 0..n blocks, each:
    RE01.03                        ← 1  head-release record
    AS02.04  (or AS01.03 + MW01.03)← 1..n resource records
    RE02                           ← 0..n sub-release records
    SU01.03 / SU02.03              ← 1..n sales/usage records
FOOT                              ← exactly 1, last line
```

Record-type versions bound by Basic Audio Profile v1.4: `SY01.03 SY02.04 SY03.02 SY04.03 SY05.04 SY12.01 RE01.03 RE02 AS01.03 AS02.04 MW01.03 SU01.03 SU02.03` (download SU is sometimes shown as `SU01.04` in the Part 3 structure text — **verify the exact SU download version against the Part 3 PDF; Part 8 documents `SU01.03`**).

The choice of **Summary** record depends on the commercial model:
- `SY01.03` — Basic summary (generic; works for most cases incl. ad-supported PAYG-style).
- `SY02.04` — ad-supported and interactive streaming services.
- `SY03.02` — subscription services.
- `SY04.03` / `SY05.04` — per-subscriber minima / licensor usage & revenue for subscription.
- `SY12.01` — basic summary for The Mechanical Licensing Collective.

The choice of **SU** record depends on use type: `SU01.03` for downloads, **`SU02.03` for streaming/webcasts** (this is the one a lyric-display event maps to — see §6).

---

### 2.2 HEAD — Header Record

- **Category:** Header. **Cardinality:** exactly 1, first line of every file.
- Source: DSR Part 8 §5.1.1 (HEAD — Header Record for all variants of all profiles).

| Pos | Cell | Type | M/C/O | Format / values |
|---|---|---|---|---|
| 1 | RecordType | Fixed string | M | `HEAD` |
| 2 | MessageVersion | Fixed string | M | `dsrf/xxx/yyy/zzz`-style message-version string. Use the value mandated by the profile/version you target. |
| 3 | Profile | String | M | `BasicAudioProfile` (MRBV) — or `BasicAudioProfileSRB` for SRBV. |
| 4 | ProfileVersion | String | M | Profile version, e.g. `1.4`. |
| 5 | MessageId | String | M | Unique message id; globally unique in combination with `SenderPartyId`. |
| 6 | MessageCreatedDateTime | DateTime | M | RFC 3339: `YYYY-MM-DDThh:mm:ssTZD`. (Note: this is RFC-3339 *inside* the file — distinct from the basic-format timestamp in the filename.) |
| 7 | FileNumber | Integer | M | This file's number, `1`-based, ≤ NumberOfFiles. |
| 8 | NumberOfFiles | Integer | M | Total files in the DSR message. `1` for a single-file report. |
| 9 | UsageStartDate | Date | M | ISO 8601 `YYYY[-MM[-DD]]` — start of the reporting period. |
| 10 | UsageEndDate | Date | M | ISO 8601 `YYYY[-MM[-DD]]` — end of the reporting period. |
| 11 | SenderPartyId | DDEX Party Identifier (DPID) | M | Licensee DPID. |
| 12 | SenderName | String | M | Licensee full name. |
| 13 | ServiceDescription | String | M | Human-readable service name; no spaces/underscores. |
| 14 | RecipientPartyId | DDEX Party Identifier (DPID) | C | Required when there is a single licensor recipient. |
| 15 | RecipientName | String | C | Required when there is a single licensor recipient. |
| 16 | RepresentedRepertoire | Multiple Strings | O | Pipe-separated rights-controller identifiers when the report covers a defined repertoire. |

---

### 2.3 SY01.03 — Basic Summary Record

- **Category:** Summary. **Cardinality:** 1..n per file — one per distinct sales context (commercial-model × use-type × territory × service combination).
- Source: DSR Part 8 §5.2.1.

| Pos | Cell | Type | M/C/O | Format / values |
|---|---|---|---|---|
| 1 | RecordType | Fixed string | M | `SY01.03` |
| 2 | SummaryRecordId | String | M | Licensee-assigned id; SU detail records reference this. |
| 3 | DistributionChannel | String | C | Party name of the distribution channel. |
| 4 | DistributionChannelDPID | DPID | C | DDEX Party ID of the distribution channel. |
| 5 | CommercialModelType | AVS | M | Commercial model / charging mechanism — see §3.2. |
| 6 | UseType | AVS (`UseType` AVS) | C | Use type — see §3.1. |
| 7 | Territory | AVS (`CurrentTerritoryCode`) | M | ISO territory code — see §3.3. |
| 8 | ServiceDescription | String | C | Service offering / tier name. |
| 9 | TotalUsages | Decimal | M | Aggregate usage count across all detail rows referencing this summary. |
| 10 | Subscribers | Decimal | C | Subscriber count (subscription models). |
| 11 | CurrencyOfReporting | AVS (`CurrencyCode`) | M | ISO 4217 currency of the reported revenue. |
| 12 | NetRevenue | Decimal | M | Net revenue attributable to this context. |
| 13 | IndirectValue | Decimal | O | Non-direct revenue attribution. |
| 14 | CurrencyOfTransaction | AVS (`CurrencyCode`) | O | ISO 4217 currency of the underlying transactions, if different. |
| 15 | ExchangeRate | Decimal | C | Conversion ratio when reporting & transaction currency differ. |
| 16 | ExchangeRateSource | String | C | Source identifier / URL for the exchange rate. |
| 17 | DateOfCurrencyExchange | DateTime | C | ISO 8601 timestamp of the exchange rate. |
| 18 | TotalPlaybackDuration | Duration | O | ISO 8601 `PT…` aggregate playback duration. |

---

### 2.4 RE01.03 — Basic Audio Release Record

- **Category:** Body (Block — head-release description). **Cardinality:** exactly 1 per Block (the head release of that Block).
- Source: DSR Part 8 §5.3.1.

| Pos | Cell | Type | M/C/O | Format / values |
|---|---|---|---|---|
| 1 | RecordType | Fixed string | M | `RE01.03` |
| 2 | BlockId | String | M | Identifies the Block this record belongs to. |
| 3 | ReleaseReference | String | M | Unique within the Block; conventionally short (`1`, `2`, …). |
| 4 | DspReleaseId | String | M | Licensee's proprietary release identifier. |
| 5 | ProprietaryReleaseId | Multiple `String::String` | O | Namespace-prefixed proprietary ids, `ns::id`. |
| 6 | ReleaseCatalogNumber | String | O | Record-company catalog number. |
| 7 | ReleaseIcpn | String | C | ICPN (UPC/EAN), 12–14 digits; mandatory if available. |
| 8 | ReleaseDisplayArtistName | String | C | Principal artist; mandatory if available. |
| 9 | ReleaseDisplayArtistPartyId | Multiple Party Identifiers | O | Order matches cell 17. |
| 10 | ReleaseTitle | String | C | Display title; mandatory if distributed in release context. |
| 11 | ReleaseSubTitle | String | O | Supplementary to title. |
| 12 | ReleaseType | String | O | Per `ReleaseType_DSR` AVS. |
| 13 | ReleaseLabelName | String | O | Record company / distributor name. |
| 14 | ReleasePLine | String | O | P-line / rights-owner identifier. |
| 15 | ReleaseDataProviderName | String | O | Licensee name if data is self-generated. |
| 16 | ReleaseDate | Date | O | First-availability date. |
| 17 | ReleaseDisplayArtist | Multiple Strings | O | Individual artist names; corresponds to cell 9. |

> For LyricPro, releases are not really the unit of interest (lyric display is recording/work-centric). A Block still needs **one** RE01.03; if you don't have real release metadata you can emit a synthetic single-track "release" wrapping the recording (mandatory cells: RecordType, BlockId, ReleaseReference, DspReleaseId — the title is conditional-on-availability).

---

### 2.5 AS02.04 — Basic Sound Recording Record *with* Musical Work Details (recommended)

- **Category:** Body (Block — resource). **Cardinality:** 1..n per Block. Use AS02.04 **instead of** AS01.03 + MW01.03 — it carries both the recording and the work data in one row, which is exactly what a publisher needs.
- Source: DSR Part 8 §5.4.2.

| Pos | Cell | Type | M/C/O | Format / values |
|---|---|---|---|---|
| 1 | RecordType | Fixed string | M | `AS02.04` |
| 2 | BlockId | String | M | Block this record belongs to. |
| 3 | ResourceReference | String | M | Unique within the Block. |
| 4 | DspResourceId | String | M | Licensee's proprietary resource identifier. |
| 5 | ResourceISRC | Multiple Strings | C | ISO 3901 ISRC; mandatory if available. Format: 2 letters + 3 alphanumeric + 2 digits (year) + 5 digits. |
| 6 | ResourceTitle | String | M | Display title. |
| 7 | ResourceSubTitle | String | O | Supplementary to title. |
| 8 | ResourceDisplayArtistName | String | C | Principal artist; mandatory if available. |
| 9 | ResourceDisplayArtistPartyId | Multiple Party Identifiers | O | Links to artist names. |
| 10 | ResourceDuration | Duration | C | ISO 8601 `PT[hhH][mmM]ssS`; mandatory if available. |
| 11 | ResourceType | AVS (`ResourceType`) | M | `SoundRecording`. |
| 12 | MusicalWorkISWC | String | C | ISO 15707 ISWC; mandatory if available. Format `T` + 9 digits + check digit. |
| 13 | MusicalWorkComposerAuthorName | Multiple Strings | C | Composer(s)/author(s); mandatory if available. |
| 14 | MusicalWorkComposerAuthorPartyId | Multiple Party Identifiers | O | One per composer/author. |
| 15 | MusicalWorkArrangerName | Multiple Strings | C | Arranger(s); mandatory if available. |
| 16 | MusicalWorkArrangerPartyId | Multiple Party Identifiers | O | One per arranger. |
| 17 | MusicalWorkPublisherName | Multiple Strings | C | Publisher(s); mandatory if available. |
| 18 | MusicalWorkPublisherPartyId | Multiple Party Identifiers | O | One per publisher. |
| 19 | MusicalWorkContributorName | Multiple Strings | C | Other contributors; mandatory if available. |
| 20 | MusicalWorkContributorPartyId | Multiple Party Identifiers | C | One per contributor. |
| 21 | ProprietaryMusicalWorkId | Multiple `String::String` | O | `ns::id`. |
| 22 | IsMasterRecording | Boolean | C | `true` master / `false` user-uploaded. |
| 23 | IsSubjectToOwnershipConflict | Boolean | C | `true`/`false`. |
| 24 | LastConflictCheck | Date | C | Mandatory if conflict flag is `true`. |
| 25 | ResourceDisplayArtist | Multiple Strings | O | Individual artist names. |

### 2.5b AS01.03 — Basic Sound Recording Record (alternative)

If you instead use `AS01.03`, you pair it with `MW01.03` per work. AS01.03 cells (source: DSR Part 8 §5.4.1): `1 RecordType="AS01.03"`, `2 BlockId`, `3 ResourceReference`, `4 DspResourceId`, `5 ResourceISRC (C)`, `6 ResourceTitle (M)`, `7 ResourceSubTitle (O)`, `8 ResourceDisplayArtistName (C)`, `9 ResourceDisplayArtistPartyId (O)`, `10 ResourceDuration (C)`, `11 ResourceType="SoundRecording" (M)`, `12 IsMasterRecording (C)`, `13 IsSubjectToOwnershipConflict (C)`, `14 LastConflictCheck (C)`, `15 ResourceDisplayArtist (O)`. **Recommendation: prefer AS02.04** — fewer records, work data inline.

### 2.5c MW01.03 — Basic Musical Work Record (only when using AS01.03)

Source: DSR Part 8 §5.5.1. Cells: `1 RecordType="MW01.03"`, `2 BlockId`, `3 DspMusicalWorkId (M)`, `4 MusicalWorkISWC (C)`, `5 MusicalWorkTitle (M)`, `6 MusicalWorkSubTitle (O)`, `7 ComposerAuthorName (C)`, `8 ComposerAuthorPartyId (O)`, `9 ArrangerName (C)`, `10 ArrangerPartyId (O)`, `11 PublisherName (C)`, `12 PublisherPartyId (O)`, `13 ContributorName (O)`, `14 ContributorPartyId (O)`, `15 MusicalWorkDataProviderName (O)`, `16 ProprietaryMusicalWorkId (O)`, `17 ResourceReference (M)` — links the work to its resource in the Block, `18 ParentLicensorDataRecordId (C)`, `19 ParentMasterlistId (C)`.

---

### 2.6 SU02.03 — Sales and/or Usage Record for Streaming Services and Webcasts

- **Category:** Body (Block — sales/usage). **Cardinality:** 1..n per Block. **This is the record a LyricPro lyric-display event maps onto** (see §6).
- Source: DSR Part 8 §5.6.3. Used by Basic Audio, Audio-visual, and Basic Audio for MLC profiles.

| Pos | Cell | Type | M/C/O | Format / values |
|---|---|---|---|---|
| 1 | RecordType | Fixed string | M | `SU02.03` |
| 2 | BlockId | String | M | Block this record belongs to. |
| 3 | SummaryRecordId | String | M | References the `SummaryRecordId` of the governing SY record. |
| 4 | SalesTransactionId | String | M | Licensee-allocated id; globally unique with `MessageId`. |
| 5 | TransactedReleaseReference | String | C | Head/sub-release reference within the Block. |
| 6 | TransactedResourceReference | String | C | Resource reference within the Block. **One of cell 5 / cell 6 must be populated.** |
| 7 | IsRoyaltyBearing | Boolean | M | `true`/`false` — whether this usage is royalty-bearing. |
| 8 | NumberOfStreams | Decimal | M | Count of streams delivered to end users. (For lyric display, see §6 — this is the count of lyric-view events.) |
| 9 | PriceEndUserPaidExcSalesTax | Decimal | C | Required for `PayAsYouGoModel`; otherwise omit. |
| 10 | PromotionalActivity | String | O | Values defined by bilateral agreement. |
| 11 | UseType | String (AVS) | C | Use type — see §3.1. |
| 12 | PlaybackDuration | Duration | O | ISO 8601 `PT…` total playback duration for the usage. |

> **There is no Territory / CommercialModelType / Currency cell on SU02.03.** Those are carried once on the **Summary** record (SY01.03 cells 5/7/11). Each SU detail row inherits the commercial model, territory and currency of the SY record it points to via `SummaryRecordId`. This is the key to the aggregation model — see §4.

### 2.6b SU01.03 — Sales and/or Usage Record for Download Services

For completeness (downloads — *not* the LyricPro path). Source: DSR Part 8 §5.6.2. Cells: `1 RecordType="SU01.03"`, `2 BlockId`, `3 SummaryRecordId`, `4 SalesTransactionId`, `5 TransactedReleaseReference (C)`, `6 TransactedResourceReference (C)`, `7 IsRoyaltyBearing (M)`, `8 SalesUpgrade (M, bool)`, `9 Usages (M, decimal)`, `10 Returns (M, decimal ≥0)`, `11 PriceEndUserPaidExcSalesTax (C — required if PayAsYouGoModel)`, `12 PromotionalActivity (O)`, `13 UseType (C)`. One of cell 5 / cell 6 must be populated.

---

### 2.7 FOOT — Footer Record

- **Category:** Footer. **Cardinality:** exactly 1, last line of the file (MRBV). (SRBV uses `SRFO` instead.)
- Source: DSR Part 8 §5.1.2 / DSR Part 1 §8.3. The FOOT record for Part 8 v1.4 has **6 cells**.

| Pos | Cell | Type | M/C/O | Format / values |
|---|---|---|---|---|
| 1 | RecordType | Fixed string | M | `FOOT` |
| 2 | NumberOfLinesInFile | Integer | M | `[INFERENCE]` Total record lines in *this file* (including HEAD and FOOT). Check data. |
| 3 | NumberOfLinesInReport | Integer | C | Total record lines across *all files* of the report. **Mandatory only in the last file** of a multi-file report. |
| 4 | NumberOfBlocksInReport | Integer | C | Total Blocks across all files. **Mandatory only in the last file.** |
| 5 | NumberOfLinesInFile / check cell | Integer | C | `[INFERENCE]` Additional check-data cell. |
| 6 | NumberOfLinesInFile / check cell | Integer | C | `[INFERENCE]` Additional check-data cell. |

> **GAP — exact FOOT cell list not confirmed.** The official Part 8 §5.1.2 page 404'd on direct fetch. Sources confirm: FOOT is the last MRBV record, it carries *check data including a count of records*, and the Part 8 v1.4 FOOT record length is **6 cells**, of which `NumberOfLinesInReport` and `NumberOfBlocksInReport` are mandatory only in the last file. The exact names/order of all 6 cells must be confirmed against the Part 8 PDF before go-live. Cells 2–6 above are a best-effort reconstruction.

---

## 3. Key controlled vocabularies (AVS — Allowed Value Sets)

DSR shares its AVS ("code lists") with all DDEX standards. The authoritative list lives in the DDEX Data Dictionary: <https://kb.ddex.net/reference-material/current-allowed-value-sets/>.

### 3.1 UseType

UseType = *how the consumer obtains/experiences the content*. Relevant values:

| Value | Meaning |
|---|---|
| `Stream` | Generic parent term covering all streaming sub-types. |
| `OnDemandStream` | User has full control over what is played. |
| `NonInteractiveStream` | Radio-style, minimal user control. |
| `ContentInfluencedStream` | Algorithmically programmed stream. |
| `TimeInfluencedStream` | Time-based access stream. |
| `PermanentDownload` | Download retained indefinitely after purchase. |
| `ConditionalDownload` | Download tied to a paid-for time period (e.g. offline cache on a subscription). |
| `Dub` / `MobileUse` | Dubbing / mobile-specific use parents. |
| `UseForIdentification` | Fingerprinting / identification use. |
| `UserMakeAvailableUserProvided` / `UserMakeAvailableLabelProvided` | UGC use types. |

**Lyric-display value:** None of the standard UseType values is specifically "on-screen lyric display." See §6 for the recommended mapping (`OnDemandStream`, with a bilateral note). DDEX does permit **user-defined values** in AVS cells when prefixed by a defined namespace — see §6 for the option of a bilaterally-agreed `UseType` such as a `ns::LyricDisplay`-style proprietary value if the recipient agrees.

### 3.2 CommercialModelType

CommercialModelType = *how the consumer pays*:

| Value | Meaning |
|---|---|
| `PayAsYouGoModel` | One-time purchase of a specific release/resource. |
| `SubscriptionModel` | Recurring fee for time-limited access. |
| `AdvertisementSupportedModel` | No consumer fee; consumer is served advertisements. |
| `FreeOfChargeModel` | No consumer fee and no advertising obligation. |
| `RightsClaimModel` | Fingerprinting/UGC matching with no consumer-facing availability. |

For LyricPro, pick the model that matches how the lyric feature is monetised (e.g. `SubscriptionModel` if it's part of a paid plan, `AdvertisementSupportedModel` or `FreeOfChargeModel` if free). This drives the SY record choice (§2.1) and whether `PriceEndUserPaidExcSalesTax` is required.

### 3.3 Territory codes

`Territory` cells use the **DDEX `CurrentTerritoryCode` AVS**, which is **ISO 3166-1 alpha-2** (e.g. `US`, `GB`, `DE`), plus DDEX-defined aggregate codes (notably `Worldwide`). Not alpha-3.

### 3.4 Currency codes

`CurrencyOfReporting` / `CurrencyOfTransaction` use the **DDEX `CurrencyCode` AVS = ISO 4217** three-letter codes (`USD`, `EUR`, `GBP`).

### 3.5 Identifiers — how DSP / Release / Resource / Work IDs work

| Identifier | Where used | Format |
|---|---|---|
| **DPID** (DDEX Party ID) | `SenderPartyId`, `RecipientPartyId`, `DistributionChannelDPID`, all `*PartyId` cells | DDEX-issued party id, e.g. `PADPIDA…`. Both sender (LyricPro) and recipient (publisher/aggregator) need DPIDs — register with DDEX. |
| **ISRC** (ISO 3901) | `ResourceISRC` | Recording identifier — 12 chars: CC + XXX + YY + NNNNN. Conditional, "mandatory if available." |
| **ISWC** (ISO 15707) | `MusicalWorkISWC` | Work identifier — `T` + 9 digits + check digit. Conditional, "mandatory if available." This is the identifier publishers care about most for a lyric report. |
| **ICPN / UPC / EAN** | `ReleaseIcpn` | 12–14 digit release barcode. |
| **DspResourceId / DspReleaseId / DspMusicalWorkId** | `AS*`, `RE*`, `MW01.03` | LyricPro's *own* proprietary ids — always mandatory; these are how detail rows are wired to summary/usage rows internally. |
| **Proprietary ids** | `ProprietaryReleaseId`, `ProprietaryMusicalWorkId` | `namespace::id` form, pipe-separated for multiples. |
| **ReleaseReference / ResourceReference / BlockId / SummaryRecordId / SalesTransactionId** | wiring cells | Producer-assigned strings, unique within their scope, used to link records (Block → release → resource → usage → summary). |

---

## 4. Conglomeration / aggregation rules

**DSR is an aggregated-reporting format, not a raw-event-log format.** The model is:

- A **Summary (SY) record** declares one *sales context* = the tuple **(CommercialModelType, UseType, Territory, Service[, DistributionChannel])** plus the reporting currency, and carries the **aggregate** `TotalUsages` / `NetRevenue` for that context.
- Each **SU detail record** references its SY via `SummaryRecordId` and reports usage **per resource/release** within that context. SU02.03 has **no** territory/model/currency cells — those are inherited from the SY record.

**Grouping key for SU rows.** Within a single sales context (one SY record), you produce **one SU02.03 row per `(TransactedResourceReference [+ TransactedReleaseReference], UseType, IsRoyaltyBearing)`** — i.e. one row per recording per use-type per royalty-bearing flag, with `NumberOfStreams` being the **summed** count of all events for that combination over the reporting period. You do **not** emit one SU row per individual playback/transaction.

`SalesTransactionId` is a per-SU-row identifier, **not** a per-end-user-transaction identifier — it identifies the aggregated reporting row.

Consistency requirement: `SY.TotalUsages` must equal the sum of `NumberOfStreams` across the SU rows that reference it (and `SY.NetRevenue` must reconcile to the revenue those rows represent). The FOOT check counts (`NumberOfLines…`, `NumberOfBlocks…`) must match the actual file content.

**Practical grouping algorithm for `generateDdexDsr()`:**
1. Bucket all LyricPro lyric-display events for the reporting period by **(CommercialModelType, UseType, Territory, ServiceTier)** → one SY01.03 per bucket.
2. Within each bucket, group by **recording (ISRC / DspResourceId)** → one Block (RE01.03 + AS02.04) per recording, and one SU02.03 per recording with `NumberOfStreams` = count of lyric-display events.
3. Sum each bucket's SU `NumberOfStreams` into the SY's `TotalUsages`; sum revenue into `NetRevenue`.

---

## 5. Concrete minimal example

A complete single-file MRBV Basic Audio Profile report. Comment lines (prefixed `# `) are **explanatory only — they are NOT part of a real DSR file** and must be removed; a real file is bare TSV with no comments. Fields shown space-aligned here for readability are **TAB-separated** in reality.

```
# --- HEAD: one per file, first line. Profile=BasicAudioProfile v1.4, single file, April 2026 period ---
HEAD	dsrf/3.0/standard/basic-audio	BasicAudioProfile	1.4	MSG-2026-04-0001	2026-05-15T03:15:00Z	1	1	2026-04-01	2026-04-30	PADPIDA2026051501B	LyricPro Inc	LyricProApp	PADPIDA2021010101A	BigPublisher Ltd

# --- SY01.03: sales context #1 = SubscriptionModel / OnDemandStream / US / paid tier. TotalUsages=300, NetRevenue=4.20 USD ---
SY01.03	SUM-1	LyricProApp	PADPIDA2026051501B	SubscriptionModel	OnDemandStream	US	LyricProApp-Premium	300	1200	USD	4.20

# --- Block 1, RE01.03: synthetic single-track release wrapping the recording ---
RE01.03	BLK-1	1	REL-LP-0001		LP-CAT-0001	0888888000019	Aurora Skies	Aurora Skies			Single		BigPublisher Ltd

# --- Block 1, AS02.04: the sound recording + its musical-work (ISWC + publisher) data ---
AS02.04	BLK-1	1	RES-LP-0001	USRC12400001	Aurora Skies		Nadia Vale		PT3M42S	SoundRecording	T1234567890	Nadia Vale|Tom Reed			BigPublisher Ltd

# --- Block 1, SU02.03: aggregated lyric-display usage for this recording in context SUM-1 (200 lyric-view events) ---
SU02.03	BLK-1	SUM-1	TXN-1	1	1	true	200			OnDemandStream

# --- Block 2, RE01.03: second recording ---
RE01.03	BLK-2	1	REL-LP-0002		LP-CAT-0002	0888888000026	Midnight Train	Midnight Train			Single		BigPublisher Ltd

# --- Block 2, AS02.04: second recording's recording + work data ---
AS02.04	BLK-2	1	RES-LP-0002	USRC12400002	Midnight Train		Jae Park		PT4M05S	SoundRecording	T0987654321	Jae Park			OtherPub Music

# --- Block 2, SU02.03: aggregated lyric-display usage for recording 2 (100 events) ---
SU02.03	BLK-2	SUM-1	TXN-2	1	1	true	100			OnDemandStream

# --- FOOT: one per file, last line. Check data: line/block counts (exact cell layout: verify, see §2.7) ---
FOOT	10	10	2
```

Notes on the example:
- Empty cells are still delimited — consecutive TABs represent optional cells left blank. Every record must have the full cell count for its type.
- `SU02.03` rows both point to `SUM-1`; their `NumberOfStreams` (200 + 100 = 300) reconciles with `SY01.03.TotalUsages = 300`.
- `MusicalWorkISWC` and `MusicalWorkPublisherName` on the AS02.04 rows are what makes this useful to a publisher.
- The example uses `OnDemandStream` as the UseType for lyric display — see §6 for the reasoning and caveats.

---

## 6. Gaps & cautions

### 6.1 The lyric-display problem (most important)

DSR Basic Audio Profile is **recording-centric and audio-playback-centric**: it expects an ISRC, an audio resource, and "streams." A LyricPro lyric-display event has **no audio playback**. There is **no UseType value that means "on-screen lyric display."** Options, in order of preference:

1. **`OnDemandStream` (recommended default).** A lyric view is a user-initiated, fully-interactive on-demand consumption event of a specific work. It is the closest standard value, and `SU02.03` (the streaming SU record) is the only SU type that fits a non-download interaction. Treat each lyric-display event as one "stream": `NumberOfStreams` = count of lyric views.
2. **A bilaterally-agreed user-defined UseType.** DDEX AVS cells allow namespace-prefixed user-defined values. If the recipient publisher/aggregator agrees, emit something like `ns::LyricDisplay` in the `UseType` cell (and the matching SY UseType). This is the most *honest* representation but requires the recipient to accept it — get it in the data-exchange agreement.
3. Document the choice in the bilateral agreement either way — the recipient must know that "streams" in this report means lyric-display events, not audio plays.

**Stream/playback duration.** A lyric display has no inherent audio duration:
- `PlaybackDuration` (SU02.03 cell 12) is **Optional** — **omit it** for lyric-display events. Do not fabricate a duration. (Optionally, by bilateral agreement, you could report dwell-time — the seconds the lyric was on screen — but this is non-standard; prefer omission.)
- `ResourceDuration` (AS02.04 cell 10) is the *recording's* duration. It is conditional ("mandatory if available"). If you know the canonical recording length, populate it; if not, it may be left blank.
- `TotalPlaybackDuration` on SY01.03 is Optional — omit.

**`IsRoyaltyBearing`.** Set per the licensing agreement. If the lyric-display feature is licensed and royalty-bearing, `true`.

**`NetRevenue` / `PriceEndUserPaidExcSalesTax`.** For a free or subscription-bundled lyric feature there is no per-view price — leave `PriceEndUserPaidExcSalesTax` blank (it is only *required* for `PayAsYouGoModel`). `SY01.03.NetRevenue` is mandatory: report the revenue allocated to the lyric feature for that context, even if `0` for a free model (confirm `0` is acceptable with the recipient; some expect an allocated share of subscription revenue).

### 6.2 Things the public sources do not pin down

- **Exact FOOT cell list/order** — Part 8 §5.1.2 page was unreachable; §2.7 cells 2–6 are reconstructed. Confirm against the Part 8 PDF.
- **Exact `MessageVersion` (HEAD cell 2) string** — the precise `dsrf/.../...` value is profile/version-specific; take it verbatim from the Part 3 / Part 8 v1.4 spec or a DDEX sample file.
- **Download SU version** — Part 3 structure text references `SU01.04` while Part 8 documents `SU01.03`. Not on the LyricPro path (we use SU02.03), but confirm if downloads are ever needed.
- **`PromotionalActivity` values** — entirely bilateral-agreement-defined; no standard list.
- **Whether `NetRevenue = 0` is accepted** for free features — recipient-dependent.
- **Exact AVS membership** — the live Data Dictionary (<https://kb.ddex.net/reference-material/current-allowed-value-sets/>) is authoritative; UseType/CommercialModelType lists in §3 are representative, not guaranteed exhaustive for v1.4.
- **The official DDEX sample files** (ZIPs linked in §7) were not downloaded/parsed in this research — download and diff against §5 before relying on exact cell counts.

### 6.3 Implementer judgment calls

- Choice of CommercialModelType / SY record type — depends on how LyricPro monetises lyric display (§3.2).
- Whether to use a synthetic single-track "release" (RE01.03) per recording (recommended — simplest) or group recordings into real releases.
- AS02.04 vs AS01.03+MW01.03 — use **AS02.04** (recommended).
- UseType for lyric display (§6.1) — `OnDemandStream` vs a negotiated user-defined value.
- Reporting period granularity and territory split (monthly per-territory is typical).

---

## 7. Source URLs

| URL | What it provided |
|---|---|
| <https://kb.ddex.net/implementing-each-standard/digital-sales-reporting-message-suite-(dsr)/> | DSR suite overview; list of Parts (1–11) and profile/version numbers. |
| <https://dsr3.ddex.net/digital-sales-report-message-suite:-part-3-basic-audio-profile/> | Basic Audio Profile structure; MRBV vs SRBV; record-type version table for v1.4. |
| <https://dsr3.ddex.net/digital-sales-report-message-suite:-part-3-basic-audio-profile/5-multi-record-block-variant-of-this-profile/5.3-definition-of-the-salesusage-report-structure-where-release-data-is-available/> | MRBV Block structure and record order (HEAD → SY → Blocks[RE01.03 → AS → SU] → FOOT). |
| <https://dsr1.ddex.net/digital-sales-report-message-suite:-part-1-architecture/8-transfer-of-salesusage-reports/8.1-file-naming-convention/> | Full file-naming convention with every token defined; `.tsv` / `.tsv.gz` extensions. |
| <https://dsr8.ddex.net/digital-sales-report-message-suite:-part-8-record-type-definitions/> | Complete catalog of all record-type codes (HEAD, FOOT, SRFO, SY01–SY12, RE01–RE04, AS01–AS06, MW01–MW02, SU01–SU06, SR01–SR08, etc.). |
| <https://dsr8.ddex.net/.../5.1-header-and-footer-records/5.1.1-head-%E2%80%94-header-record-for-all-variants-of-all-profiles/> | HEAD record cell table (16 cells, in order). |
| <https://dsr8.ddex.net/.../5.2-summary-record-types/5.2.1-sy01.03-%E2%80%94-basic-summary-record/> | SY01.03 Basic Summary record cell table (18 cells). |
| <https://dsr8.ddex.net/.../5.3-release-records/5.3.1-re01.03-%E2%80%94-basic-audio-release-record/> | RE01.03 Basic Audio Release record cell table (17 cells). |
| <https://dsr8.ddex.net/.../5.4-resource-records/5.4.1-as01.03-%E2%80%94-basic-sound-recording-record/> | AS01.03 Basic Sound Recording record cell table (15 cells). |
| <https://dsr8.ddex.net/.../5.4-resource-records/5.4.2-as02.04-%E2%80%94-basic-sound-recording-record-with-musical-work-details/> | AS02.04 record cell table (25 cells, recording + work data). |
| <https://dsr8.ddex.net/.../5.5-work-and-cue-records/5.5.1-mw01.03-%E2%80%94-basic-musical-work-record/> | MW01.03 Basic Musical Work record cell table (19 cells). |
| <https://dsr8.ddex.net/.../5.6-sales-andor-usage-records/5.6.2-su01.03-%E2%80%94-sales-andor-usage-record-for-download-services/> | SU01.03 download sales/usage record cell table (13 cells). |
| <https://dsr8.ddex.net/.../5.6-sales-andor-usage-records/5.6.3-su02.03-%E2%80%94-sales-andor-usage-record-for-streaming-services-and-webcasts/> | SU02.03 streaming sales/usage record cell table (12 cells) — the LyricPro target record. |
| <https://kb.ddex.net/implementing-each-standard/best-practices-for-all-ddex-standards/deals-and-commercial-aspects/recommended-use-of-commercialmodeltype-and-usetype-in-ern-4/> | CommercialModelType and UseType allowed values with definitions. |
| <https://kb.ddex.net/about-ddex-standards/what's-new/> | Confirmation of the March 1, 2025 retirement of the DSR XML variant (XML text, schemas, and advice removed from DDEX sites; flat-file is the only supported form). |
| <https://kb.ddex.net/implementing-each-standard/digital-sales-reporting-message-suite-(dsr)/dsr-samples/> | Pointers to official DSR sample ZIPs: `https://service.ddex.net/doc/Standards/DSR1V13/DSR-2305%20-%20Draft%20DSR%20Samples%20for%202020%20versions.zip` and `https://service.ddex.net/doc/Standards/DSR/FourSimpleSamples.zip` (Basic Audio MRBV + SRBV samples, plus colour-coded XLSX). Not downloaded in this research — recommended next step. |
| <https://kb.ddex.net/reference-material/current-allowed-value-sets/> | Authoritative DDEX Data Dictionary / AVS code lists (UseType, CommercialModelType, TerritoryCode, CurrencyCode). |
| <https://kb.ddex.net/implementing-each-standard/best-practices-for-all-ddex-standards/guidance-for-flat-file-issues/mrbv-vs-srbv/> | MRBV vs SRBV variant guidance and profile-name strings. |
