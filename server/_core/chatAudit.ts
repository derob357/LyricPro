// Records a chat moderation / admin action in the immutable chat_audit_log.
// Always called inside the same transaction as the state change, so the
// audit row + state change succeed or fail atomically. The destination
// table has a deny-change trigger (migration 0013) so UPDATE/DELETE on
// existing rows is rejected at the DB level.
import { chatAuditLog } from "../../drizzle/schema";

export type ChatAuditAction =
  | "message_delete"
  | "message_edit"
  | "ban"
  | "unban"
  | "mute_visible"
  | "mute_shadow"
  | "unmute"
  | "tournament_create"
  | "tournament_update"
  | "tournament_cancel"
  | "tournament_add_member"
  | "tournament_remove_member"
  | "tournament_join_paid"
  | "favorite_added"
  | "favorite_removed";

interface RecordParams {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any; // Drizzle transaction handle
  actorId: number;
  actorRole: string;
  action: ChatAuditAction;
  targetUserId?: number;
  targetMessageId?: number;
  targetTournamentId?: number;
  scope?: string;
  roomId?: number;
  reason?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

export async function recordChatAction(p: RecordParams): Promise<void> {
  await p.tx.insert(chatAuditLog).values({
    actorId: p.actorId,
    actorRole: p.actorRole,
    action: p.action,
    targetUserId: p.targetUserId ?? null,
    targetMessageId: p.targetMessageId ?? null,
    targetTournamentId: p.targetTournamentId ?? null,
    scope: p.scope ?? null,
    roomId: p.roomId ?? null,
    reason: p.reason ?? null,
    metadata: p.metadata ?? null,
    ip: p.ip ?? null,
    userAgent: p.userAgent ?? null,
  });
}
