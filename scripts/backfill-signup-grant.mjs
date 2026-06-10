// scripts/backfill-signup-grant.mjs
// Back-fill the one-time 100-earned-GN signup grant to every account that was
// created before the grant-on-auth code shipped.
//
// Dry-run (default): prints the count of users who lack a signup_grant txn.
// Real run (--apply required): inserts the grant for each such user.
//
// Per-user SQL:
//   1. INSERT INTO golden_note_transactions ... ON CONFLICT ("idempotencyKey")
//      WHERE "idempotencyKey" IS NOT NULL DO NOTHING -- matches the partial index
//   2. Only if the INSERT actually inserted a row: UPDATE golden_note_balances
//      to increment balance and earnedBalance.
//
// Usage:
//   node scripts/backfill-signup-grant.mjs            (dry-run)
//   node scripts/backfill-signup-grant.mjs --dry-run  (explicit dry-run)
//   node scripts/backfill-signup-grant.mjs --apply    (real run — controller only)

import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config();

const SIGNUP_GRANT = 100;

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;

if (!DB_URL) {
  console.error(
    "Set SUPABASE_SESSION_POOLER_STRING (or _DIRECT_CONNECTION_STRING / DATABASE_URL) in .env"
  );
  process.exit(1);
}

const DRY_RUN = !process.argv.includes("--apply");

const sql = postgres(DB_URL, { max: 1, prepare: false });

try {
  // Find users who do not yet have a signup_grant transaction.
  const missing = await sql`
    SELECT id
    FROM users
    WHERE id NOT IN (
      SELECT "userId"
      FROM golden_note_transactions
      WHERE kind = 'signup_grant'
    )
    ORDER BY id
  `;

  if (DRY_RUN) {
    console.log(`Dry-run: ${missing.length} user(s) lack a signup_grant transaction.`);
    if (missing.length > 0) {
      console.log(`  User ids (first 20): ${missing.slice(0, 20).map(r => r.id).join(", ")}${missing.length > 20 ? ", ..." : ""}`);
    }
    console.log("Re-run with --apply to backfill.");
    process.exit(0);
  }

  console.log(`Backfilling signup grant for ${missing.length} user(s) ...`);
  let granted = 0;
  let skipped = 0;

  for (const { id: userId } of missing) {
    const idemKey = `signup-grant-${userId}`;

    // Ensure the balance row exists.
    await sql`
      INSERT INTO golden_note_balances ("userId", balance, "earnedBalance", "purchasedBalance")
      VALUES (${userId}, 0, 0, 0)
      ON CONFLICT ("userId") DO NOTHING
    `;

    // Insert the transaction row. The partial unique index is on
    // ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL — matching
    // ON CONFLICT clause required to satisfy Postgres inference rules.
    const inserted = await sql`
      INSERT INTO golden_note_transactions ("userId", amount, kind, reason, "balanceAfter", "idempotencyKey")
      SELECT
        ${userId},
        ${SIGNUP_GRANT},
        'signup_grant',
        'Welcome bonus',
        balance + ${SIGNUP_GRANT},
        ${idemKey}
      FROM golden_note_balances
      WHERE "userId" = ${userId}
      ON CONFLICT ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL DO NOTHING
      RETURNING id
    `;

    if (inserted.length > 0) {
      // Transaction row was freshly inserted — update balances.
      await sql`
        UPDATE golden_note_balances
        SET
          balance         = balance          + ${SIGNUP_GRANT},
          "earnedBalance" = "earnedBalance"  + ${SIGNUP_GRANT},
          "updatedAt"     = now()
        WHERE "userId" = ${userId}
      `;
      granted++;
      console.log(`  Granted ${SIGNUP_GRANT} GN to user ${userId}`);
    } else {
      // Key already existed — another process beat us (or this is a re-run).
      skipped++;
    }
  }

  console.log(`Done. Granted: ${granted}, already-had-key (skipped): ${skipped}.`);
} catch (err) {
  console.error("Backfill FAILED.");
  console.error(err.message ?? err);
  process.exit(1);
} finally {
  await sql.end();
}
