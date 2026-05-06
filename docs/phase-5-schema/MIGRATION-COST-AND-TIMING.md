# Phase 5a — Migration Cost & Timing

Estimates for the work described in `MIGRATION-PLAN.md`.

---

## Lines of code touched

### New code

| File                                           | LoC (new)   | Purpose                                                  |
| ---------------------------------------------- | ----------- | -------------------------------------------------------- |
| `drizzle/schema.ts` (additions)                | ~120        | new tables + new `songs` columns + new enums             |
| `drizzle/0008_three_layer_content.sql` (new)   | ~150        | the migration DDL                                        |
| `scripts/backfill-three-layer.mjs` (new)       | ~220        | backfill jsonb → lyric_moments + gameplay_items          |
| `scripts/verify-three-layer-backfill.mjs` (new)| ~80         | read-only verifier (count comparison + spot diffs)       |
| `scripts/_lib/score-moment.mjs` (new, deferred)| ~120        | option (a)/(c) Claude scoring helper — only if we choose to score later |
| **Subtotal new**                               | **~570 (~690 if we ship the scoring helper now)** | |

### Modified code

| File                                                  | LoC (changed) | Purpose                                                |
| ----------------------------------------------------- | ------------- | ------------------------------------------------------ |
| `server/routers/game.ts`                              | ~120 (delta)  | replace `variantsOf` + `playableVariantIndicesOf` with `pickGameplayItem`; update 4 call sites; add feature-flag branch |
| `server/routers/admin.ts` (additions)                 | ~80           | curator endpoints: list pending moments, approve, reject, score |
| `client/` (admin/curation UI — Phase 5b, deferred)    | ~300+         | not in Phase 5a scope                                  |
| **Subtotal modified (Phase 5a only)**                 | **~200**      |                                                        |

### Deleted code (post-stability window)

| File                                                  | LoC (removed) | When                                                   |
| ----------------------------------------------------- | ------------- | ------------------------------------------------------ |
| `server/routers/game.ts` legacy variant helpers       | ~50           | follow-up PR after 7-day stability                     |
| `scripts/seed-lyric-variants.mjs`                     | ~95           | archive (move to `scripts/_archive/`)                  |
| `scripts/regenerate-failing-variants.mjs`             | ~800          | rewritten OR archived after Phase 3 closes             |

---

## Anthropic API spend

Per `MIGRATION-PLAN.md`, three options for scoring backfill:

| Option | Calls          | Cost (sonnet-4.5 ≈ $3/M in, $15/M out) | Cost (sonnet-4.6) | Recommendation |
| ------ | -------------- | -------------------------------------- | ----------------- | -------------- |
| (a) full | 6,513 moments × 1 call | ≈ $20–25 | ≈ $20–25 | not recommended |
| (b) NULL pending review | 0 calls | **$0** | **$0** | **recommended** |
| (c) curated 400-bank only | ~1,200 moments × 1 call | ≈ $4 | ≈ $4 | acceptable alternative |

Per-call assumption: 800 input tokens (rubric + lyric + context) + 200
output tokens (8 scores + brief reviewer notes) = ~$0.003/call.

**Recommended Phase 5a spend on Anthropic API: $0** (option b).

If the controller picks option (c) later as a Phase 5b task, the marginal
spend is ~$4 plus ~5 minutes of script runtime.

---

## Estimated developer time per phase

| Phase | Work                                                         | Dev hours |
| ----- | ------------------------------------------------------------ | --------- |
| 5a-1  | DDL: write migration SQL + drizzle schema additions; review  | 2         |
| 5a-2  | Backfill script: write + dry-run + checkpoint logic          | 4         |
| 5a-3  | Verifier script: write + run on a clone                      | 2         |
| 5a-4  | Run DDL on prod + run backfill on prod                       | 1         |
| 5a-5  | Read-path code change + feature flag + 4 call site rewrites  | 6         |
| 5a-6  | Smoke tests + targeted unit tests for `pickGameplayItem`     | 3         |
| 5a-7  | Deploy to Vercel; flip flag; watch dashboards                | 2         |
| 5a-8  | (after 7d stability) drop legacy columns; archive old scripts| 2         |
| **Total Phase 5a**                                                   | **22 hours** | |

| Deferred to Phase 5b                                         | Dev hours |
| ------------------------------------------------------------ | --------- |
| Curator UI (list pending, approve/reject, score)             | 16        |
| Distractor regen tool (for the legacy variant 0 moments with no distractors) | 8 |
| Optional: option (c) curated-bank scoring run                | 2         |

These are not in Phase 5a's critical path.

---

## Estimated downtime

**Zero, by design.**

| Step                       | Online? | Why                                                            |
| -------------------------- | ------- | -------------------------------------------------------------- |
| ALTER TABLE ADD COLUMN     | yes     | Postgres ≥ 11 handles NOT NULL DEFAULT in O(1) without rewrite |
| CREATE TABLE               | yes     | New table, no concurrent reads                                 |
| CREATE INDEX               | yes     | Use `CREATE INDEX CONCURRENTLY` (manual SQL, not drizzle migration) |
| Backfill INSERTs           | yes     | New tables aren't read by runtime yet                          |
| Read-path code deploy      | yes     | Feature flag ships disabled; no behavior change                |
| Read-flag flip             | yes     | Vercel env var refresh; no redeploy                            |
| Drop legacy columns        | yes     | Reads have already moved off these columns; no concurrent access |

The only risk to this guarantee is if `CREATE INDEX` is run without
CONCURRENTLY against `lyric_moments` after it has live data — that would
take an exclusive lock briefly. Mitigation: indexes are created at table-
creation time, before any rows exist, so the lock is on an empty table
(microseconds).

---

## Cache + cost notes (Anthropic)

If we DO run option (a) or (c) later, prompt-cache the rubric portion of
the prompt:

- The brief's scoring rubric (the `## Scoring Framework` section, ~700
  tokens) is identical across every call. Caching it cuts input cost by
  ~90% on cached reads.
- 6,513 calls with cache: ~$5 instead of ~$22 (option a). 1,200 calls
  with cache: ~$1 (option c).
- Implementation: pass `cache_control: {type: "ephemeral"}` on the system
  prompt content block per Anthropic SDK docs.

---

## Total Phase 5a budget

- **Dollars**: $0 (no Anthropic spend if we go with option b)
- **Developer hours**: 22 hours (~3 days of focused work)
- **Calendar**: ~2 weeks end-to-end (the 7-day stability window before
  legacy column drop is the long pole)
- **Downtime**: zero
- **Rollback time** (worst case): < 1 minute (env flag flip)
