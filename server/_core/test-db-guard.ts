// Fail-closed guard: refuse to run tests against the production database.
const DB_VARS = [
  "SUPABASE_SESSION_POOLER_STRING",
  "SUPABASE_DIRECT_CONNECTION_STRING",
  "SUPABASE_TRANSACTION_POOLER_STRING",
  "DATABASE_URL",
] as const;

function resolveDbUrl(env: NodeJS.ProcessEnv): string | null {
  return DB_VARS.map((k) => env[k]).find((v) => !!v) ?? null;
}

export function resolveDbHost(env: NodeJS.ProcessEnv): string | null {
  const url = resolveDbUrl(env);
  if (!url) return null;
  try {
    return new URL(url.replace(/^postgres(ql)?:/, "http:")).hostname;
  } catch {
    return null;
  }
}

function prodRef(env: NodeJS.ProcessEnv): string | null {
  const u = env.VITE_SUPABASE_PROJECT_URL;
  if (!u) return null;
  try {
    // https://<ref>.supabase.co  → "<ref>"
    return new URL(u).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

export function assertSafeTestDb(env: NodeJS.ProcessEnv = process.env): void {
  const host = resolveDbHost(env);
  if (!host) return; // no DB configured → DB-gated tests self-skip; nothing to guard
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to run tests with NODE_ENV=production.");
  }
  const ref = prodRef(env);
  // The project ref may live in the hostname (direct connection:
  // db.<ref>.supabase.co) OR elsewhere in the connection string (pooler
  // hostnames are shared per-region — the ref is embedded in the username
  // or query options instead), so check the full raw URL, not just the
  // parsed host.
  const url = resolveDbUrl(env) ?? "";
  if (ref && (host.includes(ref) || url.includes(ref))) {
    throw new Error(
      `Refusing to run tests against the PROD database (host resolves to project ref '${ref}'). ` +
        `Point SUPABASE_*/DATABASE_URL at a test database via .env.test.`,
    );
  }
  const allow = env.TEST_DB_HOST_ALLOW;
  if (allow && !host.includes(allow)) {
    throw new Error(`Test DB host '${host}' is not in TEST_DB_HOST_ALLOW ('${allow}').`);
  }
}
