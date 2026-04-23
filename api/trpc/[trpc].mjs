// Placeholder — scripts/build-api.mjs overwrites this during `vercel build`
// with the real esbuild-bundled handler from api-src/trpc/[trpc].ts.
// Committed because api/ is gitignored; Vercel's detectBuilders phase runs
// before buildCommand, so without a committed file here it registers zero
// @vercel/node functions and every /api/trpc/* request 404s at the edge.
export default function handler(_req, res) {
  res
    .status(500)
    .send(
      "api/trpc/[trpc].mjs stub was not replaced during build. " +
        "Check the Vercel build log for scripts/build-api.mjs output."
    );
}
