// Vercel serverless handler for every tRPC procedure.
// Runs as a Node-runtime function on Vercel. A single file catches
// /api/trpc/* via the [trpc] dynamic segment.

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { appRouter } from "../../server/routers";
import { authenticateRequest } from "../../server/_core/supabase-auth";
import { upsertUser, getUserByOpenId } from "../../server/db";
import type { TrpcContext } from "../../server/_core/context";

// Same dev-bypass behavior as the Express server. Gated so it can never
// activate in production.
const DEV_USER_OPEN_ID = "dev-bypass-user";
async function getOrCreateDevUser() {
  try {
    const existing = await getUserByOpenId(DEV_USER_OPEN_ID);
    if (existing) return existing;
    await upsertUser({
      openId: DEV_USER_OPEN_ID,
      name: "Dev User",
      firstName: "Dev",
      lastName: "User",
      email: "dev@local",
      loginMethod: "dev-bypass",
      role: "admin",
    });
    return (await getUserByOpenId(DEV_USER_OPEN_ID)) ?? null;
  } catch {
    return null;
  }
}

async function buildContext(req: Request, res: VercelResponse): Promise<TrpcContext> {
  let user: TrpcContext["user"] = null;
  try {
    // Adapt the Fetch Request headers into the shape our Supabase auth
    // module expects. It reads Authorization (Bearer <jwt>) first, then
    // falls back to the Supabase SSR auth cookie.
    const shimReq = {
      headers: {
        authorization: req.headers.get("authorization") ?? undefined,
        cookie: req.headers.get("cookie") ?? undefined,
      },
    };
    user = await authenticateRequest(shimReq);
  } catch {
    user = null;
  }
  if (
    !user &&
    process.env.DEV_AUTH_BYPASS === "1" &&
    process.env.NODE_ENV !== "production"
  ) {
    user = await getOrCreateDevUser();
  }
  // Procedures read ctx.req.ip (rate limiter) and ctx.res (cookie ops).
  // Synthesize an Express-like shape from the Fetch Request.
  const shimExpressReq = {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "0.0.0.0",
    headers: Object.fromEntries(req.headers.entries()),
  } as unknown as TrpcContext["req"];
  return { req: shimExpressReq, res: res as unknown as TrpcContext["res"], user };
}

export const config = {
  runtime: "nodejs",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Convert VercelRequest → Fetch Request for the tRPC fetch adapter.
  const url = `https://${req.headers.host ?? "localhost"}${req.url ?? ""}`;
  const method = req.method ?? "GET";
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) headers.set(k, v.join(","));
    else if (typeof v === "string") headers.set(k, v);
  }
  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body ?? {});

  const fetchReq = new Request(url, { method, headers, body });
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: fetchReq,
    router: appRouter,
    createContext: () => buildContext(fetchReq, res),
  });

  // Pipe the Fetch Response back through Vercel's res.
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const text = await response.text();
  res.send(text);
}
