# Database migrations & schema

`drizzle/schema.ts` is the source of truth for the schema (and the app's ORM
types). `drizzle/meta/` is drizzle-kit's snapshot of that schema; migrations in
`drizzle/*.sql` are the diffs between snapshots.

## Why this was re-baselined (2026-06-27)

The snapshots had **drifted badly** and it kept recurring. Root cause:

- Migrations `0000`–`0007` were created the managed way: `drizzle-kit generate`
  (which updates the snapshot) → `drizzle-kit migrate` (recorded in the DB's
  `drizzle.__drizzle_migrations` table — it has 8 rows).
- From `0008` onward the team **hand-wrote** SQL migrations and applied them via
  custom `scripts/apply-*.mjs` runners — **without running `drizzle-kit generate`**.
- So the snapshot/journal froze at `0007` while `schema.ts` and the live DB moved
  on to `0020`. Every later `drizzle-kit generate` then diffed *current schema*
  against the *0007 snapshot* and emitted 200+ lines of "create everything"
  drift. Each new hand-written migration widened the gap — self-reinforcing.

**The lesson:** editing `schema.ts` (or hand-writing a migration) **without
running `drizzle-kit generate`** is what desyncs the snapshot. Drift is inevitable
once the two sources of truth diverge.

The fix: squashed everything into a single `0000_baseline.sql` whose snapshot
equals the current `schema.ts`. Pre-baseline history is preserved in
`../drizzle_archive/`. `0000_baseline.sql` is **already applied everywhere — never
run it against an existing database.**

## The ONE workflow (do this every schema change)

```
1. Edit drizzle/schema.ts
2. pnpm db:generate          # drizzle-kit generate — writes drizzle/<n>_*.sql + updates the snapshot
3. Review the generated SQL  # it should contain ONLY your change
4. Apply it to the database via the migration runner / your DB tooling
5. git add drizzle/ && commit  # schema.ts + migration + drizzle/meta TOGETHER, in one commit
```

Never edit `schema.ts` without step 2, and never commit a schema change without
the regenerated `drizzle/meta`. That single rule prevents the drift.

## Guards

- `pnpm db:check` — fails if `schema.ts` and the snapshot are out of sync
  (`scripts/check-drizzle-sync.mjs`). **Wire this into CI** (and optionally a
  pre-commit hook) so drift is caught at PR time, not months later.
- `pnpm db:push` is **disabled** (`scripts/db-push-disabled.mjs`). The old
  `db:push` = `drizzle-kit generate && drizzle-kit migrate` is dangerous here:
  `migrate` would try to re-create existing tables. Apply migrations through the
  reviewed runner instead.

## Legacy `__drizzle_migrations` (optional cleanup)

The live DB still has 8 rows in `drizzle.__drizzle_migrations` from the old
`0000`–`0007` managed runs. They are harmless (the app doesn't read them; we no
longer use `drizzle-kit migrate`). If you ever want to return to managed
`drizzle-kit migrate`, reconcile that table to the new baseline first — e.g.:

```sql
-- One-time, only if adopting drizzle-kit migrate again. Marks the squashed
-- baseline as already applied so migrate won't try to re-create the schema.
DELETE FROM drizzle.__drizzle_migrations;
-- then insert the 0000_baseline hash from drizzle/meta/_journal.json as applied.
```

Until then, keep applying via the reviewed runner + `pnpm db:check` in CI.
