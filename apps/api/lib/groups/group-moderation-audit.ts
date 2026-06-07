/**
 * S59-T1: Group moderation audit log helper.
 *
 * Writes an immutable GroupModerationAction row after each mutating group
 * management operation. All callers are fire-and-forget — this function
 * swallows errors and must never block or reject the calling HTTP response.
 *
 * Usage pattern (caller side):
 *   void logModerationAction({ ... }).catch(console.error);
 *
 * The optional `tx` parameter allows the write to participate in an existing
 * Prisma transaction. Callers that want the audit row to be atomic with their
 * own writes (e.g. transfer-ownership) should pass the tx client.
 * Callers that run outside a transaction omit `tx` — prisma is used directly.
 */

import { type Prisma, GroupModerationActionType } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export { GroupModerationActionType };

type TxClient = Prisma.TransactionClient;

export async function logModerationAction(params: {
  groupId: string;
  actorId: string;
  targetUserId?: string;
  actionType: GroupModerationActionType;
  metadata?: Record<string, unknown>;
  tx?: TxClient;
}): Promise<void> {
  const { groupId, actorId, targetUserId, actionType, metadata, tx } = params;
  const client = tx ?? prisma;

  try {
    await client.groupModerationAction.create({
      data: {
        groupId,
        actorId,
        targetUserId: targetUserId ?? null,
        actionType,
        ...(metadata !== undefined ? { metadata: metadata as Prisma.InputJsonValue } : {}),
      },
    });
  } catch (err) {
    // Audit writes must never surface to the caller. Log for observability only.
    console.error("[group-moderation-audit] Failed to write audit row:", err);
  }
}
