import postgres from "postgres";
import dotenv from "dotenv";
dotenv.config();
const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const sql = postgres(DB_URL, { max: 1, prepare: false });

try {
  // Find any admin user (the existing project has at least one).
  const admins = await sql`SELECT id FROM users WHERE role = 'admin' LIMIT 1`;
  if (admins.length === 0) {
    console.log("SKIP: no admin user in DB to seed a test row.");
    process.exit(0);
  }
  const adminId = admins[0].id;

  // Insert a test audit row (we expect this to succeed)
  const [inserted] = await sql`
    INSERT INTO chat_audit_log (actor_id, actor_role, action, reason)
    VALUES (${adminId}, 'admin', 'test_immutability', 'verifying triggers')
    RETURNING id
  `;
  console.log(`Inserted test audit row id=${inserted.id} — INSERT works as expected.`);

  // Try UPDATE — must fail
  let updateBlocked = false;
  try {
    await sql`UPDATE chat_audit_log SET reason = 'tampered' WHERE id = ${inserted.id}`;
    console.error("BAD: UPDATE succeeded; immutability trigger NOT active");
  } catch (e) {
    if (/immutable|append-only/i.test(e.message)) {
      console.log("OK: UPDATE rejected with immutability error.");
      updateBlocked = true;
    } else {
      console.error("UPDATE failed with UNEXPECTED error:", e.message);
    }
  }

  // Try DELETE — must fail
  let deleteBlocked = false;
  try {
    await sql`DELETE FROM chat_audit_log WHERE id = ${inserted.id}`;
    console.error("BAD: DELETE succeeded; immutability trigger NOT active");
  } catch (e) {
    if (/immutable|append-only/i.test(e.message)) {
      console.log("OK: DELETE rejected with immutability error.");
      deleteBlocked = true;
    } else {
      console.error("DELETE failed with UNEXPECTED error:", e.message);
    }
  }

  if (updateBlocked && deleteBlocked) {
    console.log("Audit-log immutability verified.");
    console.log(`Test row id=${inserted.id} remains in chat_audit_log (cannot be deleted by design).`);
  } else {
    process.exit(2);
  }
} finally {
  await sql.end();
}
