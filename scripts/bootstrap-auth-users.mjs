// Provision initial user accounts in Supabase Auth + create matching rows
// in public.users with the right roles. Idempotent — re-running won't
// duplicate auth users or create extra public.users rows.
//
// Requires in .env:
//   VITE_SUPABASE_PROJECT_URL
//   SUPABASE_SECRET_KEY           (admin operations — bypasses RLS)
//   SUPABASE_SESSION_POOLER_STRING (for the public.users row upsert)
//
// Run:  node scripts/bootstrap-auth-users.mjs

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const SUPABASE_URL = process.env.VITE_SUPABASE_PROJECT_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;
const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING;

if (!SUPABASE_URL || !SUPABASE_SECRET || !DB_URL) {
  console.error(
    "Missing one of: VITE_SUPABASE_PROJECT_URL, SUPABASE_SECRET_KEY, SUPABASE_SESSION_POOLER_STRING"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const sql = postgres(DB_URL, { max: 1, prepare: false });

// ── Users to provision ──────────────────────────────────────────────────────
// email_confirm: true means they can log in immediately (no click-to-verify
// roundtrip). For magic-link flow: user enters email → Supabase mails a
// one-time link → clicking it creates a session. No password needed.
const USERS = [
  {
    email: "deric@intentionai.ai",
    role: "admin",
    firstName: "Deric",
    lastName: "Robinson",
  },
  {
    email: "derob357@yahoo.com",
    role: "user",
    firstName: "Deric",
    lastName: "Robinson",
  },
  {
    email: "jim@conciergecareerservices.com",
    role: "admin",
    firstName: "Jim",
    lastName: "",
  },
  {
    email: "jaz@conciergecareerservices.com",
    role: "admin",
    firstName: "Jaz",
    lastName: "",
  },
];

async function findAuthUserByEmail(email) {
  // List all users and filter. Supabase's admin.listUsers supports pagination;
  // for our 2-user bootstrap the first page is plenty.
  const { data, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error) throw error;
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
}

async function upsertAppUser({ authId, email, role, firstName, lastName }) {
  // The public.users table keyed on openId (varchar 64) receives the
  // Supabase auth UUID as the openId. 36 chars fits comfortably.
  await sql`
    INSERT INTO users ("openId", "email", "role", "firstName", "lastName",
                       "loginMethod", "name")
    VALUES (${authId}, ${email}, ${role}, ${firstName}, ${lastName},
            'supabase', ${firstName + " " + lastName})
    ON CONFLICT ("openId") DO UPDATE SET
      "email" = EXCLUDED."email",
      "role" = EXCLUDED."role",
      "firstName" = EXCLUDED."firstName",
      "lastName" = EXCLUDED."lastName",
      "loginMethod" = 'supabase',
      "updatedAt" = NOW()
  `;
}

async function main() {
  for (const u of USERS) {
    console.log(`\nProcessing ${u.email} (role=${u.role})…`);
    let existing = await findAuthUserByEmail(u.email);
    let authUser;

    if (existing) {
      console.log(`  auth user already exists (id=${existing.id})`);
      authUser = existing;
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: u.email,
        email_confirm: true,
        user_metadata: {
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
        },
      });
      if (error) {
        console.error(`  ❌ createUser failed: ${error.message}`);
        continue;
      }
      authUser = data.user;
      console.log(`  ✅ created auth user (id=${authUser.id})`);
    }

    await upsertAppUser({
      authId: authUser.id,
      email: u.email,
      role: u.role,
      firstName: u.firstName,
      lastName: u.lastName,
    });
    console.log(`  ✅ public.users row synced with role=${u.role}`);
  }

  // Report final state — no values echoed, just counts.
  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM users`;
  const byRole = await sql`
    SELECT "role", COUNT(*)::int AS count
    FROM users
    GROUP BY "role"
    ORDER BY "role"
  `;
  console.log(`\npublic.users total: ${count}`);
  for (const r of byRole) console.log(`  ${r.role}: ${r.count}`);

  await sql.end();
}

main().catch((err) => {
  console.error("Fatal:", err.message ?? err);
  process.exit(1);
});
