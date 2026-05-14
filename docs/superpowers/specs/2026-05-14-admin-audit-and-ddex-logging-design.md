# Admin Audit Log + DDEX-Ready Song Usage Logging + Admin Lyric Management — Design

**Date**: 2026-05-14
**Status**: Drafted, awaiting review
**Goal**: Land the cross-cutting logging infrastructure that every later admin sub-project depends on. Capture every admin action in an immutable forensics log; upgrade song impression capture to DDEX-publisher-grade so the data we're collecting today is reportable to publishers/aggregators tomorrow; ship the admin lyric add/edit surface and the exports that feed the people who need to know how many times a lyric has been displayed.

This is the first of six admin-dashboard sub-projects. Sequenced first because it is cross-cutting: every later sub-project (user management, content moderation, active-room monitoring, dashboard wire-up) writes to the audit log defined here. Building it later would mean retrofitting audit writes into 4+ places.

---

## 1. Goals & non-goals

### In scope

1. **Immutable admin audit log** — every admin action writes to a dedicated `audit.admin_actions` Postgres table that is hard-immutable at the DB level via `REVOKE UPDATE/DELETE` plus a deny-change trigger (required because Supabase `service_role` bypasses RLS).
2. **DDEX-ready song impression log** — extend `song_displays` with the 12 columns (11 stored + 1 generated) needed to feed DDEX DSR Basic Audio Profile flat-file exports to music publishers and aggregators (LyricFind / Musixmatch).
3. **PRO-grade song metadata** — extend `songs` with 6 columns (`iswc`, `isrc`, `songwriters`, `publishers`, `lyric_source_provider`, `provider_track_id`) so each row is license-reportable.
4. **Admin lyric add/edit UI** — `/admin/songs` list page plus `/admin/songs/:id` edit page with sections for Identity, Licensing & PRO metadata, Lyric variants, and Curator notes.
5. **Per-variant lyric editing** — admins can edit individual entries in the `lyricVariants` jsonb array (prompt, answer, distractors, section type). Each edit emits its own audit row.
6. **Admin Log tab** — table of recent admin actions inside `/admin`, with three-filter pinned bar (Date / Actor / Action), right-side detail drawer with before/after diff, cursor pagination, no live tail.
7. **Internal CSV export** — Usage tab dumps per-song and per-lyric-variant display counts plus duration and territory rollups for a given month.
8. **DDEX DSR Basic Audio Profile flat-file export** — full implementation, packaged per DDEX file-naming convention, with built-in lint of the obvious shape errors.
9. **Audit row on every export** — `export.usage_csv`, `export.usage_ddex`, `export.admin_actions_csv` all log who exported what with which parameters.
10. **Fix existing admin-procedure inconsistency** — `monetization.getAdminMetrics` uses `protectedProcedure` with a manual role check; convert to `adminProcedure` for parity with the rest of the admin surface.

### Out of scope (explicit non-goals)

- **Hash-chained tamper-evidence on the audit log.** Overkill at <1000 events/day per the research; revoke+trigger is the chosen integrity story.
- **S3 Object Lock / external WORM storage.** Defer until a SOC 2 / FINRA / HIPAA mandate.
- **Live PRO or publisher contract signing.** We are building infra ready for when contracts get signed.
- **Outbound submission to LyricFind / Musixmatch / publisher APIs.** Exports generate downloadable files; submission stays a manual upload step until a publisher conversation forces automation.
- **DDEX validator-compliance certification.** Our lint catches shape errors; field-level DDEX validation is the recipient's job until rejection feedback teaches us otherwise.
- **User management UI** (sub-project #2 — separate spec).
- **Moderation / user-reported-flag queue** (sub-project #4 — separate spec).
- **Active room monitor** (sub-project #5 — separate spec).
- **Existing dashboard wire-up of mock revenue chart** (sub-project #1 — separate spec).
- **Live tail / auto-refresh of the Log tab.** Stripe, Vercel, Linear, GitHub don't auto-refresh; we follow.
- **Admin role granularity** (super-admin vs content-admin vs support). All admins are equal until we have more than one.
- **GDPR PII overlay UI.** Table created in this migration so the shape is locked; no UI to populate it until a real GDPR request arrives.
- **Real-time streaming of audit events to an external SIEM / Axiom / Datadog.** In-Postgres only until volume demands otherwise.

---

## 2. Architecture

```
                       ┌──────────────────────────────────────┐
                       │   Admin Browser (/admin/* pages)     │
                       │                                       │
                       │   • Dashboard         (existing)      │
                       │   • Songs admin       (NEW)           │
                       │   • Log tab           (NEW)           │
                       │   • Usage tab         (NEW)           │
                       └──────────────────────────────────────┘
                                       │ tRPC
                                       ▼
        ┌──────────────────────────────────────────────────────────┐
        │            server/routers/admin.ts (extended)             │
        │                                                            │
        │   songs.list / get / create / update / disable / enable   │
        │   variants.update                                          │
        │   actions.list / detail / exportCsv                       │
        │   usage.byLyric / byDateRange / exportCsv / exportDdex    │
        └──────────────────────────────────────────────────────────┘
                                       │
                  ┌────────────────────┼────────────────────┐
                  ▼                    ▼                    ▼
        ┌──────────────────┐  ┌─────────────────┐  ┌────────────────┐
        │  audit-helper.ts │  │  songs (table)  │  │ song_displays  │
        │  (NEW)           │  │   + new cols    │  │  + new cols    │
        │                  │  │                  │  │                │
        │ recordAdminAction│  │ iswc, isrc,     │  │ territory,     │
        │   ({action,      │  │ songwriters,    │  │ duration,      │
        │    target,       │  │ publishers,     │  │ fragment_len,  │
        │    payload,      │  │ lyric_source,   │  │ commercial_mdl,│
        │    actor})       │  │ provider_id     │  │ revenue,       │
        │                  │  │                  │  │ attribution,   │
        │  →INSERT into    │  │                  │  │ user_hash,     │
        │  audit.admin_    │  │                  │  │ session_id     │
        │  actions         │  │                  │  │                │
        └──────────────────┘  └─────────────────┘  └────────────────┘
                  │
                  ▼
        ┌──────────────────────────────┐
        │  audit.admin_actions (NEW)   │
        │  dedicated schema            │
        │  REVOKE UPDATE/DELETE        │
        │  deny-change trigger         │
        │  UUID PK (uuidv7 when PG18)  │
        └──────────────────────────────┘
```

**Key architectural decisions:**

- **Three storage units, two ownership philosophies.** `audit.admin_actions` is hard immutable (DB-enforced via revoke+trigger). `song_displays` is soft append-only by convention — already insert-only in app code; we don't add the trigger pattern because we may need to GDPR-redact specific rows later, and `durationOfUseSeconds` is the one column updated post-insert (on round end). `songs` is normal mutable (admins edit it).
- **Single audit helper.** Every admin-procedure tRPC route calls `recordAdminAction(...)` inside the same transaction as its side effect. No DB triggers on `songs` for audit, because triggers can't see `request_id` / `ip` / `actor_email` from inside Postgres — app-level inserts trade exhaustiveness for context.
- **Ingest hook for `song_displays`.** `getNextSong` already inserts one row per impression; we extend the existing insert site to populate the new DDEX fields. No new write paths.
- **Export is a query, not a job.** At current volumes, exports run inline at request time and stream CSV / TSV. Move to a background job only if any export ever doesn't fit in a tRPC response timeout.
- **No new top-level client routes for tabs.** New admin sections slot into the existing `/admin` Tabs component as new tabs. Songs add/edit uses dedicated routes `/admin/songs` and `/admin/songs/:id`. The existing standalone `/admin/usage` route stays as a redirect to `/admin?tab=usage`.

---

## 3. Data model

### 3.1 `audit.admin_actions` (NEW)

```sql
CREATE SCHEMA IF NOT EXISTS audit;
REVOKE ALL ON SCHEMA audit FROM PUBLIC;

CREATE TABLE audit.admin_actions (
  id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at           timestamptz  NOT NULL DEFAULT now(),
  actor_type            text         NOT NULL CHECK (actor_type IN ('admin','system','support')),
  actor_id              integer,
  actor_email           varchar(320),
  action                text         NOT NULL,
  target_type           text         NOT NULL,
  target_id             text         NOT NULL,
  target_variant_index  integer,
  payload               jsonb        NOT NULL DEFAULT '{}'::jsonb,
  request_id            text,
  ip_truncated          inet,
  user_agent            text
);

CREATE INDEX idx_admin_actions_actor   ON audit.admin_actions (actor_id, occurred_at DESC);
CREATE INDEX idx_admin_actions_target  ON audit.admin_actions (target_type, target_id, occurred_at DESC);
CREATE INDEX idx_admin_actions_action  ON audit.admin_actions (action, occurred_at DESC);

REVOKE ALL ON audit.admin_actions FROM PUBLIC;
GRANT  INSERT, SELECT ON audit.admin_actions TO authenticated;

CREATE OR REPLACE FUNCTION audit.deny_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit.admin_actions is append-only (%)', TG_OP;
END $$;

CREATE TRIGGER admin_actions_no_update    BEFORE UPDATE   ON audit.admin_actions FOR EACH ROW       EXECUTE FUNCTION audit.deny_change();
CREATE TRIGGER admin_actions_no_delete    BEFORE DELETE   ON audit.admin_actions FOR EACH ROW       EXECUTE FUNCTION audit.deny_change();
CREATE TRIGGER admin_actions_no_truncate  BEFORE TRUNCATE ON audit.admin_actions FOR EACH STATEMENT EXECUTE FUNCTION audit.deny_change();
```

**Enumerated values:**
- `action` text values: `song.create`, `song.update`, `song.disable`, `song.enable`, `lyric_variant.create`, `lyric_variant.update`, `lyric_variant.delete`, `admin_pause.toggle`, `export.usage_csv`, `export.usage_ddex`, `export.admin_actions_csv`.
- `target_type` values: `song`, `lyric_variant`, `system`, `export`.

**Sibling redaction overlay (DDL only — no UI in this spec):**

```sql
CREATE TABLE audit.admin_actions_redactions (
  action_id    uuid        PRIMARY KEY REFERENCES audit.admin_actions(id),
  redacted_at  timestamptz NOT NULL DEFAULT now(),
  reason       text        NOT NULL,
  fields       text[]      NOT NULL
);
```

### 3.2 `songs` — 6 new columns

Added via `ALTER TABLE` in the Phase 0 migration:

```ts
iswc                   varchar(15)
isrc                   varchar(15)
songwriters            jsonb<Array<{ name: string; share?: number; ipiNumber?: string }>> default []
publishers             jsonb<Array<{ name: string; share?: number; territory?: string }>> default []
lyricSourceProvider    pgEnum('lyric_source_provider', ['internal','lyricfind','musixmatch','direct_publisher']) default 'internal' notnull
providerTrackId        varchar(64)
```

`licensingStatus` enum already exists in `drizzle/schema.ts` — keep as is.

Songs without an `iswc` are exportable as a "no-match" supplemental tranche, per the DDEX research — we accept that mismatch >10–20% will cause rejection and surface that as a warning in the export UI.

### 3.3 `song_displays` — 12 new columns (11 stored + 1 generated)

```ts
territoryCode               varchar(2)
durationOfUseSeconds        integer                   -- nullable on insert, updated once on round end
lyricFragmentLengthChars    integer
lyricFragmentLengthLines    integer
commercialModelType         pgEnum('commercial_model', ['free','subscription','ad_supported','entry_fee']) default 'free' notnull
serviceDescription          varchar(64) default 'lyricpro-web' notnull
grossRevenuePerEventMicros  bigint default 0 notnull
currencyCode                varchar(3) default 'USD' notnull
attributionServed           varchar(64)
userIdHashed                varchar(64)               -- sha256(userId || PEPPER), null for guests
sessionId                   varchar(64)
reportingPeriodYyyymm       varchar(6) GENERATED ALWAYS AS (to_char(shownAt, 'YYYYMM')) STORED
```

Existing columns (`id`, `songId`, `userId`, `guestToken`, `roomCode`, `variantIndex`, `shownAt`) stay.

`durationOfUseSeconds` is the **one column we update post-insert** — necessary because `song_displays` is insert-on-show but duration isn't known until round-end. This is the reason we don't put the revoke+trigger pattern on `song_displays`; it would block this single legitimate update path.

**New indexes:**
- `(reportingPeriodYyyymm, songId)` — fast monthly rollup
- `(songId, variantIndex)` — per-lyric counts

### 3.4 Phase 0 migration sequence

One Drizzle migration runs:

1. Create `audit` schema, `admin_actions` table, indexes, revoke, trigger.
2. Create `audit.admin_actions_redactions` overlay table (DDL only).
3. Create new enums (`lyric_source_provider`, `commercial_model`).
4. `ALTER TABLE songs` adding 6 new columns.
5. `ALTER TABLE song_displays` adding 11 stored columns + 1 generated column (`reportingPeriodYyyymm`) + 2 new indexes.
6. Best-effort backfill of historical `song_displays` rows:
   - `userIdHashed` = `encode(digest(userId::text || current_setting('app.user_hash_pepper'), 'sha256'), 'hex')` where `userId IS NOT NULL`.
   - `lyricFragmentLengthChars` / `lyricFragmentLengthLines` recomputed from `songs.lyricVariants[variantIndex].prompt` (fallback to `songs.lyricPrompt` if `variantIndex >= length(lyricVariants)`).
   - `territoryCode`: derived from any IP-history we have on `users` or related session tables. If no history exists, stays NULL — acceptable for historical rows (Open Question 1 in §8).
   - Defaults handle the rest automatically for new rows; existing rows get explicit `commercialModelType='free'`, `serviceDescription='lyricpro-web'`, `currencyCode='USD'`, `grossRevenuePerEventMicros=0` if NULL after the column adds.
7. Smoke test: migration runs cleanly against staging snapshot. Target: full migration including backfill completes in under 30 seconds on the current ≈5.5k `song_displays` rows. If it exceeds that, split the backfill into a separate DO block executed in batches of 1000.

After Phase 0 lands, Track A and Track B fork.

---

## 4. Audit helper API

**File**: `server/_core/audit.ts` (new)

```ts
import { type Context } from "./context";
import { type Tx } from "../db";
import { adminActions } from "../../drizzle/schema";

export type AdminAction =
  | "song.create"
  | "song.update"
  | "song.disable"
  | "song.enable"
  | "lyric_variant.create"
  | "lyric_variant.update"
  | "lyric_variant.delete"
  | "admin_pause.toggle"
  | "export.usage_csv"
  | "export.usage_ddex"
  | "export.admin_actions_csv";

export type AdminTargetType = "song" | "lyric_variant" | "system" | "export";

interface RecordParams {
  ctx: Context;
  tx: Tx;
  action: AdminAction;
  targetType: AdminTargetType;
  targetId: string;
  targetVariantIndex?: number;
  payload?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    params?: Record<string, unknown>;
    reason?: string;
  };
}

export async function recordAdminAction(p: RecordParams): Promise<void> {
  if (p.ctx.user?.role !== "admin") {
    throw new Error("recordAdminAction called with non-admin actor");
  }
  await p.tx.insert(adminActions).values({
    actorType: "admin",
    actorId: p.ctx.user.id,
    actorEmail: p.ctx.user.email,
    action: p.action,
    targetType: p.targetType,
    targetId: p.targetId,
    targetVariantIndex: p.targetVariantIndex ?? null,
    payload: p.payload ?? {},
    requestId: p.ctx.requestId ?? null,
    ipTruncated: truncateIp(p.ctx.ip),
    userAgent: p.ctx.userAgent ?? null,
  });
}

function truncateIp(ip: string | undefined): string | null {
  // IPv4 'a.b.c.d' → 'a.b.c.0/24'
  // IPv6 → '/48' prefix
  // null → null
}
```

**Usage contract (enforced by code review, not types):**

```ts
songUpdate: adminProcedure
  .input(z.object({ id: z.number(), patch: songPatchSchema }))
  .mutation(async ({ ctx, input }) => {
    const db = await getDb();
    return await db.transaction(async (tx) => {
      const before = await tx.select().from(songs).where(eq(songs.id, input.id)).limit(1);
      if (!before[0]) throw new TRPCError({ code: "NOT_FOUND" });
      const [after] = await tx.update(songs)
        .set({ ...input.patch, updatedAt: new Date() })
        .where(eq(songs.id, input.id))
        .returning();
      await recordAdminAction({
        ctx, tx,
        action: "song.update",
        targetType: "song",
        targetId: String(input.id),
        payload: { before: before[0], after, params: input.patch },
      });
      return after;
    });
  }),
```

**Why same-tx:** if the audit insert fails, the mutation rolls back. If the mutation fails, the audit row never exists. No "wrote without auditing" and no "audited a no-op" states.

**Write-time redaction rules:**
- `payload.before` / `payload.after` for `songs`: keep everything (no PII in the songs table).
- `payload.params` for future admin-edit-user routes (sub-project #2): redact `passwordHash`; `stripeCustomerId` keeps last 4 only.
- `ipTruncated`: always truncated, never full.

**Three things we explicitly DON'T do:**
- No DB trigger on `songs` for audit (can't get `ctx.user.email` / `ctx.requestId` from Postgres context).
- No retry / no DLQ for audit inserts (same-tx — failure means the action didn't happen).
- No async write to an external log sink in this phase.

---

## 5. Admin UIs

### 5.1 Routing

- `/admin?tab=overview` (existing tabs)
- `/admin?tab=songs` — Songs tab content links to `/admin/songs`
- `/admin?tab=log` — Activity log
- `/admin?tab=usage` — Usage report
- `/admin/songs` — full-page list
- `/admin/songs/:id` — full-page edit
- `/admin/songs/new` — full-page add
- `/admin/usage` → redirect to `/admin?tab=usage`

All icons are outline `lucide-react`. No emoji, no filled cartoons (per project memory).

### 5.2 `/admin/songs` — list page

- Table columns: title, artist, genre, year, variant count, total plays (`songs.displayCount`), status chip.
- Status chip values: Active (green outline), Disabled (red outline), Pending review (amber outline).
- Filters: genre (distinct values from DB), decade (`decadeRange`), status (Active / Disabled / Pending), curated (in bank / not).
- Search: server-side ILIKE on `title` + `artistName`, debounced 300ms.
- Cursor-paginated `Load more` at bottom, 50 rows per page.
- Banner at top when the legacy 17 case-B outliers (from project memory) are still on the old split: *"17 songs still on the legacy 2/3:1/3 lyric split. [Review]"* — clicking applies a filter chip.
- Row click navigates to `/admin/songs/:id`.

### 5.3 `/admin/songs/:id` — edit page

Single-page form with collapsible sections:

- **Identity** — title, artist, featured artist, genre, subgenre, year, decade, difficulty, lyric section type, explicit flag.
- **Licensing & PRO metadata** — ISWC, ISRC, lyric source provider, provider track ID, licensing status, approved-for-game toggle, in-curated-bank toggle. Songwriters and publishers each as an editable list of typed rows with name / IPI (songwriter) or territory (publisher) and share %.
- **Lyric variants** (the `lyricVariants` jsonb array) — each variant rendered as an editable card: section type, prompt, answer, distractors. Per-variant per-period play count shown inline. Per-variant actions: Edit, Disable. New variant card via "Add variant" button.
- **Curator notes** — free-text textarea.

On Save: single `song.update` tRPC mutation in one transaction. Variant-level changes emit one audit row per changed variant (so the Log tab shows them as separate entries — easier to scan and revert mentally).

### 5.4 `/admin?tab=log` — Activity Log table

- 5 columns: When (relative, absolute on hover), Actor (email, shortened), Action (color-coded verb chip: green=create, amber=update, red=disable/delete, neutral=export/system), Target (resource type + display name, link to entity), Source (country flag derived from `ip_truncated` + simple platform tag).
- Pinned filter bar above table: Date range chips (24h / 7d / 30d / All + Custom), Actor dropdown (admins who have logged any action), Action multi-select.
- Refresh: manual `[↻ Refresh]` button. Subtle "last loaded Xm ago" label. No auto-refresh.
- Row click opens right-side drawer.
- Cursor pagination, `Load more`, 50 rows per page.
- `[Export CSV]` button at top right of tab.

### 5.5 Activity Log detail drawer

- Full actor email + actor id + role.
- Truncated IP + country + platform.
- Request ID + user agent.
- Target link to the underlying entity (`song`, `lyric_variant` with deep link to song edit page at variant anchor).
- Visible diff section: key-by-key before/after for the columns that changed. Color: green for added/changed-to, red for removed.
- Collapsed raw JSON payload with a Copy button.

### 5.6 `/admin?tab=usage` — Usage Report

- Period picker (month dropdown, populated from distinct values of `reportingPeriodYyyymm`).
- Aggregate-by toggle: Song / Lyric variant.
- Table columns adapt to aggregation choice. Per-variant rows include the variant prompt for human readability.
- Totals row at bottom (plays, duration, distinct territories, revenue).
- Two export buttons: `[Internal CSV]` and `[DDEX]`.
- A collapsible "Summary" section above the table contains the existing `/admin/usage` summary stats (totals, top/bottom, by genre, by decade, last 7 days) so the legacy page's content survives the move.

---

## 6. Export formats

### 6.1 Internal CSV (Phase 2)

Plain CSV of whatever the user has on screen in the Usage tab. Columns mirror the rendered table. Filename: `lyricpro-usage-{YYYY-MM}-{songOrVariant}.csv`. Streamed via tRPC response with `Content-Disposition: attachment`. Emits one `export.usage_csv` audit row with `params: { period, aggregation, rowCount, filters }`.

### 6.2 Admin actions CSV (Phase 2)

Log tab `[Export CSV]` button dumps the current filtered query. Columns: `occurred_at, actor_email, action, target_type, target_id, target_variant_index, ip_truncated, payload_json`. Emits `export.admin_actions_csv`.

### 6.3 DDEX DSR Basic Audio Profile flat-file (Phase 3)

**Authority:**
- [DDEX DSR Knowledge Base](https://kb.ddex.net/implementing-each-standard/digital-sales-reporting-message-suite-(dsr)/)
- [DSR Basic Audio Profile Part 3](https://kb.ddex.net/implementing-each-standard/digital-sales-reporting-message-suite-(dsr)/dsr-profiles/part-3:-basic-audio-profile/)
- [DSR Flat File Architecture v1.2](https://kb.ddex.net/pages/viewpage.action?pageId=9505073)

XML variant retired industry-wide March 2025; flat-file is the only supported form.

**Implementation note — Phase 3 starts with a focused research subagent** that extracts the exact line-record schema (record codes, field widths, separator, header/footer fields, file-naming convention) from the DDEX KB. The KB is too detailed to hand-roll from memory; we treat it as the source of truth and build to it.

**Public exporter signature:**

```ts
export function generateDdexDsr(
  rows: SongDisplayWithSong[],
  context: ExportContext,
): { mainFile: string; noMatchFile: string | null; filename: string };

interface ExportContext {
  messageSender: string;           // 'LYRICPRO-UNREGISTERED' until DDEX party ID issued
  messageRecipient: string;        // publisher party ID for this export
  reportingPeriodStart: Date;
  reportingPeriodEnd: Date;
  territoryFilter?: string[];
  messageVersion: string;
}
```

**Behaviors we commit to (independent of the KB lookup):**

1. **ISRC fallback** — rows where `songs.isrc IS NULL` are written to the no-match supplemental file, not the main file. Per the format research, >10–20% unmatched in the main file triggers recipient rejection.
2. **Conglomeration** — DDEX requires pre-aggregation of identical `(territory, useType, period)` tuples. The exporter aggregates at write time; the underlying `song_displays` table stays unaggregated.
3. **Attribution log inclusion** — `attributionServed` column maps to a DDEX comment / extension field on the line-record. Events where attribution was contractually required and no attribution was served are flagged in the no-match file for review.

**Format**: TSV (tab-separated). One record per line. Line-record codes per DDEX dictionary. Output as `.tsv` inside a `.zip` envelope per DDEX file packaging convention.

**Filename pattern** (per DDEX naming):
`DSR_LyricPro_<RecipientPartyId>_LyricProTrivia_<YYYYMM>_2025-current_<ISO8601timestamp>_<MessageControlType>.tsv`

**Built-in lint**: catches missing required record types, malformed ISRC, inverted period bounds, empty main file (only no-match rows). DOES NOT claim DDEX-validator compliance.

Emits one `export.usage_ddex` audit row with `params: { recipient, period, mainRowCount, noMatchRowCount }`.

---

## 7. Phasing — parallel-tracks execution

```
PHASE 0  (sequential — must finish before Phase 1)
─────────────────────────────────────────────────────
  Single Drizzle migration:
   - audit schema + admin_actions + indexes + revoke + trigger
   - audit.admin_actions_redactions overlay (DDL only)
   - lyric_source_provider + commercial_model enums
   - songs: +6 columns
   - song_displays: +10 columns + generated reportingPeriodYyyymm + 2 indexes
   - Best-effort backfill for song_displays historical rows
   - Smoke: migration runs cleanly against staging Supabase clone, then prod

PHASE 1  (parallel — two subagents)
─────────────────────────────────────────────────────
  TRACK A (subagent 1)                  TRACK B (subagent 2)
  ───────────────────────               ───────────────────────
  • audit-helper module                  • getNextSong: populate new
  • adminProcedure consistency fix         song_displays columns at insert
    (getAdminMetrics)                    • round-end hook updates
  • admin.songs.* tRPC routes              durationOfUseSeconds
    (list/get/create/update/disable)     • admin.usage.* tRPC routes
  • admin.variants.* tRPC routes           (byLyric / byDateRange)
  • admin.actions.* tRPC routes          • Internal CSV export
    (list/detail/exportCsv)                (admin.usage.exportCsv)

PHASE 2  (sequential — wires Track A + Track B into UI)
─────────────────────────────────────────────────────
  • /admin/songs list page + filters + banner
  • /admin/songs/:id edit page (Identity + Licensing + Variants + Notes)
  • /admin/songs/new add page
  • Log tab UI inside /admin (table + drawer + filters)
  • Usage tab UI inside /admin (table + Internal CSV button + summary)
  • Existing /admin/usage → redirect to /admin?tab=usage

PHASE 3  (sequential — DDEX research spike + implementation)
─────────────────────────────────────────────────────
  • Research subagent: extract DDEX DSR Basic Audio Profile flat-file
    line-record schema from kb.ddex.net
  • DDEX exporter module (pure function generateDdexDsr)
  • DDEX lint function
  • [DDEX] export button on Usage tab + audit row emission
  • Snapshot test: generate sample file for 2026-04 reporting period;
    visually diff against DDEX KB sample
```

**Track A / Track B contract — the bit that makes parallel safe:**

- Both tracks import `songs` and `song_displays` schemas from the Phase 0 migration. Phase 0 is the contract.
- Track A does NOT touch `song_displays`. Track B does NOT touch `audit.admin_actions`.
- Track A's audit helper writes to a table Track B doesn't read.
- Track B's ingest changes are isolated to `getNextSong` and round-end. Track A doesn't touch them.
- Phase 2 reads from both tracks' tRPC routes and is sequential. Any contract drift surfaces there with full conflict context.

**Estimated duration:**
- Phase 0 — ≈ 1 day
- Phase 1 — ≈ 3–4 days each track in parallel
- Phase 2 — ≈ 3–4 days
- Phase 3 — ≈ 3–5 days

**Total ≈ 2.5 weeks** with parallel tracks vs ≈ 3.5 weeks fully sequential.

---

## 8. Testing, verification, open questions

### 8.1 Testing per phase

**Phase 0 (migration):**
- Run against fresh test DB → assert all columns / indexes / triggers exist.
- INSERT into `audit.admin_actions`, then UPDATE → expect raised exception.
- DELETE → expect raised exception.
- TRUNCATE → expect raised exception.
- Run against staging snapshot of prod → assert backfill completes in under 30 seconds on ≈5.5k rows; if exceeded, split into 1000-row batches.

**Phase 1 Track A:**
- Unit tests for `recordAdminAction`: rejects non-admin actor, snapshots `actorEmail` at write time, truncates IPv4 to /24 and IPv6 to /48.
- Integration tests for each `admin.songs.*` route: success path writes audit row in same tx; failure path leaves no audit row.
- End-to-end: admin updates a song via tRPC → exactly one `audit.admin_actions` row exists with correct before/after.

**Phase 1 Track B:**
- Unit tests for `getNextSong` column population: territory derived from Vercel geo header, fragment length matches `lyricVariants[idx].prompt.length`.
- Round-end hook test: `durationOfUseSeconds` updated exactly once per `song_displays` row.
- Integration test: `usage.byLyric` query returns correct counts grouped by `(songId, variantIndex)`.

**Phase 2:**
- Manual browser test of all four surfaces (Songs list, Song edit, Log tab, Usage tab). Per project rule: dev server up; golden path + edge cases exercised in browser before declaring done.
- Accessibility: tab order through edit form, keyboard navigation in log drawer, screen-reader labels on filter chips.

**Phase 3:**
- Snapshot test: generate DDEX file for a fixed `song_displays` seed; diff against committed expected output.
- Lint function catches: missing required record types, malformed ISRC, inverted period bounds, empty main file.

### 8.2 Verification before phase completion

Per `superpowers:verification-before-completion`: every phase ends with explicit Bash verification (drizzle migration succeeds, tests pass, build passes, manual browser confirmation for UI phases). No phase is marked complete on assertion alone.

### 8.3 Open questions (deferred to implementation, not blocking)

1. **Per-user IP capture today.** Phase 0 backfill of `territoryCode` depends on whether any historical IP exists on `users` or sessions. Verify at start of Phase 0; if no history exists, territory stays NULL for historical rows — acceptable.
2. **`USER_HASH_PEPPER` secret.** `userIdHashed` = `sha256(userId || PEPPER)`. Add variable name `USER_HASH_PEPPER` to `.env` (local) and Vercel Production environment as a new secret. Generate locally with `openssl rand -hex 32`. **Never rotate** — rotation would break userId continuity across the log. Per global secret-handling rule: do not paste or echo the value anywhere in chat or commit history.
3. **DDEX MessageSender / Party ID.** Issued by DDEX when a member registers. We do not have one. Phase 3 uses a placeholder `LYRICPRO-UNREGISTERED` and the spec notes a real party ID is required before first external send.
4. **Vercel geo header in tRPC context.** Need to confirm `x-vercel-ip-country` is passed through to the tRPC context. If not, Phase 0 adds it to context plumbing.
5. **`provider_track_id` granularity.** Currently designed at the `songs` level. If LyricFind / Musixmatch require per-lyric-variant matching, this may move to the `lyricVariants` jsonb entries. Phase 3 research spike answers this.
6. **`getAdminMetrics` security inconsistency.** Uses `protectedProcedure` plus manual role check today. Track A fixes this to `adminProcedure` (one-line change inside Phase 1 scope).

### 8.4 What is explicitly NOT in this spec

- Sub-projects #1 (dashboard wire-up of mock revenue), #2 (user management), #4 (moderation queue), #5 (active room monitor).
- Outbound submission to LyricFind / Musixmatch / publisher APIs.
- Real DDEX validator (deferred to recipient feedback).
- Hash chain / WORM / signed audit log.
- Admin role granularity (super-admin vs content-admin vs support).
- GDPR overlay UI for the redaction table.

---

## 9. Research deltas (captured for posterity)

Folded from four parallel research subagents dispatched 2026-05-14:

- **D1**: ASCAP / BMI / SESAC / GMR license public performance of compositions, not text display. Lyric display (no audio) triggers reproduction / display rights held by publishers, accessed practically via LyricFind or Musixmatch as aggregators. ASCAP reframed as a non-primary target.
- **D2**: DDEX DSR Basic Audio Profile flat-file is the target export format. XML variant retired March 2025. MLC explicitly out of scope (statutorily prohibited from licensing lyrics).
- **D3**: Two distinct event streams — admin audit log (internal forensics) and song usage log (external publisher reporting). Bundled into one spec, internally implementable as parallel tracks.
- **D4**: `songs` needs `iswc`, `isrc`, `songwriters`, `publishers`, `lyric_source_provider`, `provider_track_id`. Currently has none.
- **D5**: `song_displays` needs 12 additional fields (11 stored + 1 generated) to feed DDEX exports.
- **D6**: Postgres immutability pattern is dedicated schema + REVOKE UPDATE/DELETE + deny-change trigger. Supabase `service_role` bypasses RLS, so this is required, not optional. Skip hash chains, partitioning, S3 WORM at our scale. `temporal_tables` extension not available on Supabase managed.
- **D7**: UI follows the Notion / Linear / Vercel / Stripe pattern: 5-column dense table, right-side drawer, three-filter pinned bar, cursor pagination, no live tail, CSV export, color-coded verb chips, country flag from IP but never raw IP in the table.
- **D8**: LyricFind / Musixmatch contractually require visible attribution per lyric display. Event log must record which attribution was served — defensive evidence.
