import postgres from "postgres";
import dotenv from "dotenv";
dotenv.config();
const sql = postgres(
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL,
  { max: 1, prepare: false }
);

try {
  const rows = await sql`
    SELECT
      p.proname AS function_name,
      pg_get_function_arguments(p.oid) AS args,
      pg_get_function_result(p.oid) AS result
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'realtime'
      AND p.proname LIKE 'broadcast%'
    ORDER BY p.proname
  `;
  for (const r of rows) {
    console.log(`${r.function_name}(${r.args}) returns ${r.result}`);
  }
} finally {
  await sql.end();
}
