// Stripe webhook — Vercel serverless function with raw-body parsing
// disabled (Stripe signature verification needs the exact bytes).

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleStripeWebhook } from "../../server/_core/stripeWebhook";

export const config = {
  api: {
    // Stripe signature verification requires the raw request body. Disable
    // Vercel's default body parser so we can read the untouched buffer.
    bodyParser: false,
  },
  runtime: "nodejs",
};

// Collect the incoming request's raw bytes into a Buffer. Stripe's
// constructEvent accepts either a Buffer or a string; we hand it Buffer.
function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", chunk =>
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
    );
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const raw = await readRawBody(req);
  // Mutate the VercelRequest so the existing Express-style handler sees
  // a Buffer body (same shape it gets from express.raw()).
  (req as unknown as { body: Buffer }).body = raw;
  // Delegate to the existing, already-audited handler. Types line up
  // because both Vercel and Express Request satisfy the subset the
  // handler actually touches (headers + body).
  await handleStripeWebhook(
    req as unknown as Parameters<typeof handleStripeWebhook>[0],
    res as unknown as Parameters<typeof handleStripeWebhook>[1]
  );
}
