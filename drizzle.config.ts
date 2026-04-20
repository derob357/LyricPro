import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// drizzle-kit (migrations, introspection) needs a DDL-capable connection —
// pgBouncer transaction mode (port 6543) can't run CREATE TABLE. Valid
// sources, in preference order:
//   1. Session pooler (port 5432 via pooler.supabase.com) — IPv4-friendly,
//      supports DDL, works from any network. Recommended for most users.
//   2. Direct connection (db.*.supabase.co:5432) — IPv6-only hostname;
//      only works if the local network has IPv6 egress.
//   3. Legacy DATABASE_URL fallback for pre-Supabase setups.
const connectionString =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "Set SUPABASE_SESSION_POOLER_STRING (or SUPABASE_DIRECT_CONNECTION_STRING) in .env to run drizzle commands"
  );
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
