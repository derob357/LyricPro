import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import helmet from "helmet";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
// Auth is now Supabase-driven (see server/_core/supabase-auth.ts, invoked
// from context.ts). The legacy Manus OAuth callback route has been retired.
import { appRouter } from "../app-router";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { handleStripeWebhook } from "./stripeWebhook";
import { registerVendorRoutes, vendorBodyParseErrorHandler } from "../vendor/vendorRest";

// Comma-separated list of allowed origins, e.g.
// "https://lyricpro.ai,https://www.lyricpro.ai". Empty string = only
// same-origin requests (default browser behavior).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Vercel terminates TLS and adds exactly one proxy hop. With trust proxy=1,
  // req.ip resolves the real client IP from x-forwarded-for (Vercel-validated)
  // instead of returning Vercel's internal peer address, which would defeat
  // per-IP rate limits. Do not use `true` — that trusts all proxies.
  app.set("trust proxy", 1);

  // ── Security headers ─────────────────────────────────────────────────────
  // Helmet sets 15+ hardening headers (X-Frame-Options, HSTS, X-Content-Type
  // -Options, Referrer-Policy, etc.).
  //
  // AUTHORITATIVE CSP LIVES IN vercel.json. On Vercel the browser document
  // (the static SPA shell) is served by the edge, so its Content-Security-
  // Policy must be set there — this Express app only handles /api/*, where a
  // CSP is inert (CSP governs document/worker contexts, not JSON/XHR bodies).
  // The report-only policy below is defense-in-depth for any deploy where this
  // server serves HTML directly (local / self-hosted); keep its allowlist in
  // sync with vercel.json. Disabled in dev (Vite HMR injects inline scripts).
  const isProd = process.env.NODE_ENV === "production";

  // Supabase host derived from the project URL (used for both https REST/auth
  // and the wss realtime socket — an https source never covers wss).
  const supabaseHost = (process.env.VITE_SUPABASE_PROJECT_URL ?? "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const supabaseSrcs = supabaseHost
    ? [`https://${supabaseHost}`, `wss://${supabaseHost}`]
    : [];

  const cspDirectives = isProd
    ? {
        useDefaults: true,
        directives: {
          "script-src": ["'self'", "https://js.stripe.com"],
          "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          "font-src": ["'self'", "https://fonts.gstatic.com"],
          "img-src": ["'self'", "data:", "blob:", "https:"],
          "connect-src": [
            "'self'",
            ...supabaseSrcs,
            "https://*.livekit.cloud",
            "wss://*.livekit.cloud",
            "https://api.stripe.com",
            "https://api.pwnedpasswords.com",
          ],
          "frame-src": [
            "'self'",
            "https://js.stripe.com",
            "https://hooks.stripe.com",
            "https://checkout.stripe.com",
          ],
          "media-src": ["'self'", "data:", "blob:", "mediastream:"],
          "worker-src": ["'self'", "blob:"],
        },
        reportOnly: true,
      }
    : false;

  app.use(
    helmet({
      contentSecurityPolicy: cspDirectives,
      crossOriginEmbedderPolicy: false,
      // Default 'same-origin' blocks Google/Apple OAuth popup flows in some
      // browsers (popups need window.opener postMessage access). Allow popups.
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    })
  );

  // ── CORS ─────────────────────────────────────────────────────────────────
  // Restrictive: only allow origins explicitly listed in ALLOWED_ORIGINS
  // env var. Same-origin requests from the served app work without the
  // Origin header at all.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
      );
      return res.sendStatus(204);
    }
    next();
  });

  // Stripe webhook must be registered BEFORE express.json(). The raw body
  // is required for signature verification; Stripe payloads are small.
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json", limit: "1mb" }),
    handleStripeWebhook
  );

  // Tightened body parser limits. Nothing in this app should POST more
  // than a few KB of JSON; the old 50 MB ceiling was a DoS vector.
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));
  // Vendor REST API (key-authenticated, rate-limited)
  registerVendorRoutes(app);
  app.use(vendorBodyParseErrorHandler);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
