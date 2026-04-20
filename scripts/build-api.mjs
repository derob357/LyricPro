// Pre-bundle Vercel serverless functions. Our server/* modules use
// extensionless TS imports that Node's native ESM loader rejects at
// runtime (ERR_UNSUPPORTED_DIR_IMPORT), so we bundle each api-src/*.ts
// into a self-contained .mjs under api/ that has everything inlined.
//
// Layout:
//   api-src/<route>/<handler>.ts   ← source, authored by devs
//   api/<route>/<handler>.mjs      ← bundled output, what Vercel deploys
//
// The api/ directory is gitignored — it's fully regenerated here. Run
// once locally (`node scripts/build-api.mjs`) before `vercel dev`; run
// automatically during deploy via vercel.json buildCommand.

import { build } from "esbuild";
import { readdirSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";

const SRC = "api-src";
const OUT = "api";

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) entries.push(...walk(p));
    else if (name.endsWith(".ts")) entries.push(p);
  }
  return entries;
}

const sources = walk(SRC);
console.log(`[build-api] bundling ${sources.length} function(s):`);

for (const src of sources) {
  const rel = relative(SRC, src);
  const out = join(OUT, rel.replace(/\.ts$/, ".mjs"));
  mkdirSync(dirname(out), { recursive: true });
  console.log(`  ${src} -> ${out}`);
  await build({
    entryPoints: [src],
    outfile: out,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    // Externalize large Node / peer packages — Vercel's node_modules
    // are present at runtime and native addons don't round-trip through
    // esbuild cleanly.
    external: [
      "@vercel/node",
      "postgres",
      "@supabase/supabase-js",
      "stripe",
      "@trpc/server",
      "@trpc/server/adapters/fetch",
      "zod",
      "drizzle-orm",
      "drizzle-orm/postgres-js",
      "superjson",
    ],
    logLevel: "warning",
  });
}

console.log("[build-api] done");
