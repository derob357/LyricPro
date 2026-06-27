// scripts/db-push-disabled.mjs
// `db:push` (drizzle-kit generate && migrate) is intentionally disabled.
// The drizzle snapshots drifted from the live DB once (0007→0020), so a blind
// `migrate` would try to re-CREATE existing tables and fail/damage prod. Use the
// reviewed workflow instead.
console.error(`
db:push is disabled on this project.

  Why: snapshots previously drifted from the live database; an automatic
  generate+migrate would replay schema that already exists in production.

  Do this instead:
    1. Edit drizzle/schema.ts
    2. pnpm db:generate            # writes a clean incremental drizzle/<n>_*.sql + snapshot
    3. Review the generated SQL
    4. Apply it via the migration runner / your DB tooling (NOT drizzle-kit migrate)
    5. Commit schema.ts + the migration + drizzle/meta together
    6. pnpm db:check               # CI guard: schema.ts and snapshot must stay in sync

  See drizzle/README.md.
`);
process.exit(1);
