// Placeholder — scripts/build-api.mjs overwrites this during `vercel build`
// with the real esbuild-bundled handler from api-src/stripe/webhook.ts.
// See the matching comment in api/trpc/[trpc].mjs for the full rationale.
export default function handler(_req, res) {
  res
    .status(500)
    .send(
      "api/stripe/webhook.mjs stub was not replaced during build. " +
        "Check the Vercel build log for scripts/build-api.mjs output."
    );
}
