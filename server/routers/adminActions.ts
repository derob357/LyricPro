import { z } from "zod";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { adminActions } from "../../drizzle/schema";
import { recordAdminAction } from "../_core/audit";
import { TRPCError } from "@trpc/server";

const ACTION_VALUES = [
  "song.create","song.update","song.disable","song.enable",
  "lyric_variant.create","lyric_variant.update","lyric_variant.delete",
  "admin_pause.toggle","export.usage_csv","export.usage_ddex",
  "export.admin_actions_csv",
] as const;

export const adminActionsRouter = router({
  list: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(200).default(50),
      cursor: z.string().optional(), // ISO timestamp cursor
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      actorId: z.number().int().optional(),
      actions: z.array(z.enum(ACTION_VALUES)).optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const where: any[] = [];
      if (input.from) where.push(gte(adminActions.occurredAt, new Date(input.from)));
      if (input.to) where.push(lt(adminActions.occurredAt, new Date(input.to)));
      if (input.actorId !== undefined) where.push(eq(adminActions.actorId, input.actorId));
      if (input.actions && input.actions.length > 0) {
        where.push(inArray(adminActions.action, input.actions as unknown as string[]));
      }
      if (input.cursor) where.push(lt(adminActions.occurredAt, new Date(input.cursor)));
      const rows = await db.select().from(adminActions)
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(adminActions.occurredAt))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const trimmed = hasMore ? rows.slice(0, input.limit) : rows;
      return {
        rows: trimmed,
        nextCursor: hasMore ? trimmed[trimmed.length - 1].occurredAt.toISOString() : null,
      };
    }),

  detail: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [row] = await db.select().from(adminActions).where(eq(adminActions.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  distinctActors: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const rows = await db
      .selectDistinct({ actorId: adminActions.actorId, actorEmail: adminActions.actorEmail })
      .from(adminActions);
    return rows.filter((r) => r.actorId !== null);
  }),

  exportCsv: adminProcedure
    .input(z.object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      actorId: z.number().int().optional(),
      actions: z.array(z.enum(ACTION_VALUES)).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const where: any[] = [];
      if (input.from) where.push(gte(adminActions.occurredAt, new Date(input.from)));
      if (input.to) where.push(lt(adminActions.occurredAt, new Date(input.to)));
      if (input.actorId !== undefined) where.push(eq(adminActions.actorId, input.actorId));
      if (input.actions && input.actions.length > 0) {
        where.push(inArray(adminActions.action, input.actions as unknown as string[]));
      }
      const rows = await db.select().from(adminActions)
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(adminActions.occurredAt))
        .limit(10000);
      const csv = toCsv(rows);
      await db.transaction(async (tx) => {
        await recordAdminAction({
          ctx, tx,
          action: "export.admin_actions_csv",
          targetType: "export",
          targetId: `admin_actions_${new Date().toISOString()}`,
          payload: { params: input as unknown as Record<string, unknown>, rowCount: rows.length } as any,
        });
      });
      return { csv, rowCount: rows.length };
    }),
});

function toCsv(rows: Array<typeof adminActions.$inferSelect>): string {
  const cols = ["occurred_at","actor_email","action","target_type","target_id","target_variant_index","ip_truncated","payload_json"];
  const head = cols.join(",");
  const lines = rows.map((r) => [
    r.occurredAt.toISOString(),
    csvEscape(r.actorEmail ?? ""),
    csvEscape(r.action),
    csvEscape(r.targetType),
    csvEscape(r.targetId),
    r.targetVariantIndex ?? "",
    csvEscape(r.ipTruncated ?? ""),
    csvEscape(JSON.stringify(r.payload)),
  ].join(","));
  return [head, ...lines].join("\n");
}

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
