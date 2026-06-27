// scripts/check-drizzle-sync.mjs
// Guard against drizzle snapshot drift. Fails if drizzle/schema.ts has changes
// that are NOT reflected in the latest snapshot — i.e. someone edited the schema
// without running `pnpm db:generate`. Run this in CI and/or a pre-commit hook so
// the snapshot can never silently fall behind schema.ts again (the exact failure
// that produced the 0007→0020 drift).
//
// Mechanism: with an in-sync snapshot, `drizzle-kit generate` is a no-op and
// writes nothing. If it writes a migration/snapshot, schema.ts drifted.
import { execSync } from "node:child_process";

const git = (args) => execSync(`git ${args}`, { encoding: "utf8" }).trim();

// Need a clean drizzle/ tree to distinguish drift from in-progress edits.
if (git("status --porcelain drizzle/")) {
  console.error("drizzle/ has uncommitted changes — commit or stash them before running db:check.");
  process.exit(2);
}

execSync("pnpm exec drizzle-kit generate --name __sync_check__", { stdio: "ignore" });

if (git("status --porcelain drizzle/")) {
  console.error("\n❌ Drizzle drift: drizzle/schema.ts changed but no migration was generated.");
  console.error("   Fix: run `pnpm db:generate`, review the new drizzle/<n>_*.sql, then commit");
  console.error("   schema.ts + the migration + drizzle/meta together. See drizzle/README.md.\n");
  git("checkout -- drizzle/");      // revert modified meta/journal
  execSync("git clean -fdq drizzle/"); // remove the generated migration file
  process.exit(1);
}

console.log("✓ drizzle: schema.ts and the snapshot are in sync.");
