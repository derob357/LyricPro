import "dotenv/config";
import postgres from "postgres";

async function test(name, url) {
  if (!url) return console.log(`${name.padEnd(20)} not set in .env`);
  if (!url.startsWith("postgres://") && !url.startsWith("postgresql://")) {
    return console.log(
      `${name.padEnd(20)} ❌ malformed — should start with 'postgresql://', got '${url.slice(0, 30)}...'`
    );
  }
  let sql;
  try {
    sql = postgres(url, { connect_timeout: 8, idle_timeout: 1, max: 1 });
    await sql`select 1 as ok`;
    console.log(`${name.padEnd(20)} ✅ OK`);
  } catch (e) {
    console.log(`${name.padEnd(20)} ❌ ${e.code ?? ""} ${String(e.message).slice(0, 140)}`);
  } finally {
    try { if (sql) await sql.end({ timeout: 1 }); } catch {}
  }
}

await test("Session pooler",     process.env.SUPABASE_SESSION_POOLER_STRING);
await test("Transaction pooler", process.env.SUPABASE_TRANSACTION_POOLER_STRING);
await test("Direct connection",  process.env.SUPABASE_DIRECT_CONNECTION_STRING);
process.exit(0);
