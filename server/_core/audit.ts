// server/_core/audit.ts
// Central audit helper. Called inside the same tx as every admin mutation
// so the audit row and the mutation succeed or fail atomically.
import { truncateIp } from "./ip-utils";
import type { TrpcContext } from "./context";
import { adminActions } from "../../drizzle/schema";

export type AdminAction =
  | "song.create"
  | "song.update"
  | "song.disable"
  | "song.enable"
  | "lyric_variant.create"
  | "lyric_variant.update"
  | "lyric_variant.delete"
  | "admin_pause.toggle"
  | "export.usage_csv"
  | "export.usage_ddex"
  | "export.admin_actions_csv"
  | "export.users_csv"
  | "export.payouts_csv"
  | "curatedSet.create"
  | "curatedSet.update"
  | "curatedSet.delete"
  | "curatedSet.launch"
  | "vendor.create"
  | "vendor.update"
  | "vendor.linkMember"
  | "vendor.unlinkMember"
  | "vendor.issueKey"
  | "vendor.revokeKey";

export type AdminTargetType = "song" | "lyric_variant" | "system" | "export" | "curatedSet" | "gameRoom" | "vendor";

interface RecordParams {
  ctx: TrpcContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any; // Drizzle transaction handle
  action: AdminAction;
  targetType: AdminTargetType;
  targetId: string;
  targetVariantIndex?: number;
  payload?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    params?: Record<string, unknown>;
    reason?: string;
  };
}

export async function recordAdminAction(p: RecordParams): Promise<void> {
  if (p.ctx.user?.role !== "admin") {
    throw new Error("recordAdminAction called with non-admin actor");
  }
  await p.tx.insert(adminActions).values({
    actorType: "admin" as const,
    actorId: p.ctx.user.id,
    actorEmail: p.ctx.user.email,
    action: p.action,
    targetType: p.targetType,
    targetId: p.targetId,
    targetVariantIndex: p.targetVariantIndex ?? null,
    payload: p.payload ?? {},
    requestId: p.ctx.requestId ?? null,
    ipTruncated: truncateIp(p.ctx.ip),
    userAgent: p.ctx.userAgent ?? null,
  });
}
