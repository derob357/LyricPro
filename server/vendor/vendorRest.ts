// server/vendor/vendorRest.ts
// Express glue for the vendor REST API. All logic lives in vendorApi.ts /
// vendorAuth.ts (unit-tested); this file only wires auth, rate limiting,
// and response formatting.
import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { getDb } from "../db";
import { rateLimit } from "../_core/rateLimit";
import { authenticateVendorKey, type VendorAuth } from "./vendorAuth";
import { handleMeta, handleMetrics, handleReports, type ApiResult } from "./vendorApi";

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error, correlationId: crypto.randomUUID() });
}

function send(res: Response, r: ApiResult, wantCsv: boolean): void {
  if (wantCsv && r.csv) {
    res
      .status(r.status)
      .setHeader("Content-Type", "text/csv; charset=utf-8")
      .setHeader("Content-Disposition", `attachment; filename="${r.csv.filename}"`)
      .send(r.csv.content);
    return;
  }
  res.status(r.status).json(r.body);
}

type Handler = (db: NonNullable<Awaited<ReturnType<typeof getDb>>>, auth: VendorAuth, req: Request) => Promise<ApiResult>;

function route(handler: Handler) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const db = await getDb();
      if (!db) return fail(res, 503, "service_unavailable");
      const auth = await authenticateVendorKey(db, req.headers.authorization);
      if (!auth) return fail(res, 401, "invalid_api_key");
      try {
        // In-process token bucket (best-effort on serverless — Upstash swap is
        // a recorded follow-up). 120 requests/min per key.
        // rateLimit() throws TRPCError on limit exceeded; catch converts to 429.
        rateLimit("vendor.api", auth.keyId, { max: 120, windowMs: 60_000 });
      } catch {
        return fail(res, 429, "rate_limited");
      }
      const result = await handler(db, auth, req);
      send(res, result, req.query.format === "csv" || (req.body as { format?: string } | undefined)?.format === "csv");
    } catch (err) {
      console.error("[vendor-api] unhandled:", err);
      fail(res, 500, "internal_error");
    }
  };
}

export function registerVendorRoutes(app: Express): void {
  app.get("/api/vendor/v1/meta", route((db, auth) => handleMeta(db, auth)));
  app.get("/api/vendor/v1/metrics/:family", route((db, auth, req) =>
    handleMetrics(db, auth, req.params.family ?? "", req.query as Record<string, unknown>)));
  app.post("/api/vendor/v1/reports", route((db, auth, req) => handleReports(db, auth, req.body)));
}
