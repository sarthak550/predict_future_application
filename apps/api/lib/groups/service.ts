import { randomUUID } from "crypto";

import { GroupNotifLevel, GroupRole, GroupVisibility, MarketCategory, type Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";

type TxClient = Prisma.TransactionClient;

function buildInviteCode() {
  return randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

function buildGroupSlug(name: string) {
  return `${slugify(name).slice(0, 48) || "group"}-${randomUUID().slice(0, 6)}`;
}

export async function createGroup(input: {
  ownerId: string;
  name: string;
  description?: string | null;
  /** S54: defaults to OPEN so new groups appear in the discover feed. */
  visibility?: GroupVisibility;
  category?: MarketCategory | null;
  coverImageUrl?: string | null;
}) {
  return prisma.$transaction(async (tx) => createGroupTx(tx, input));
}

export async function createGroupTx(
  tx: TxClient,
  input: {
    ownerId: string;
    name: string;
    description?: string | null;
    visibility?: GroupVisibility;
    category?: MarketCategory | null;
    coverImageUrl?: string | null;
  }
) {
  const group = await tx.group.create({
    data: {
      name: input.name,
      description: input.description || null,
      slug: buildGroupSlug(input.name),
      inviteCode: buildInviteCode(),
      ownerId: input.ownerId,
      // S54: new groups default to OPEN (visible in discover feed).
      visibility: input.visibility ?? GroupVisibility.OPEN,
      category: input.category ?? null,
      coverImageUrl: input.coverImageUrl ?? null
    }
  });

  await tx.groupMembership.create({
    data: {
      groupId: group.id,
      userId: input.ownerId,
      role: GroupRole.OWNER
    }
  });

  return group;
}

export async function joinGroupByInviteCode(input: {
  userId: string;
  inviteCode: string;
}) {
  return prisma.$transaction(async (tx) => {
    const group = await tx.group.findUnique({
      where: {
        inviteCode: input.inviteCode
      }
    });

    if (!group || group.isArchived) {
      throw new Error("Group not found.");
    }

    const existingMembership = await tx.groupMembership.findUnique({
      where: {
        groupId_userId: {
          groupId: group.id,
          userId: input.userId
        }
      }
    });

    // Ban check: tombstone rows (bannedAt != null) block all join paths including invite code.
    // This prevents banned users from bypassing moderation with an old invite link.
    if (existingMembership?.bannedAt != null) {
      throw new Error("You have been removed from this group.");
    }

    if (existingMembership) {
      return group;
    }

    await tx.groupMembership.create({
      data: {
        groupId: group.id,
        userId: input.userId,
        role: GroupRole.MEMBER
      }
    });

    return group;
  });
}

export async function joinGroupById(input: {
  userId: string;
  groupId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const group = await tx.group.findUnique({
      where: { id: input.groupId }
    });

    if (!group || group.isArchived) {
      throw new Error("Group not found.");
    }

    const existingMembership = await tx.groupMembership.findUnique({
      where: {
        groupId_userId: {
          groupId: group.id,
          userId: input.userId
        }
      }
    });

    if (existingMembership) {
      return group;
    }

    await tx.groupMembership.create({
      data: {
        groupId: group.id,
        userId: input.userId,
        role: GroupRole.MEMBER
      }
    });

    return group;
  });
}

/**
 * @deprecated S54: getDiscoverGroups previously returned all non-archived groups
 * regardless of visibility — a privacy leak (INVITE_ONLY groups were exposed).
 * The discover feed is now handled entirely by GET /api/groups/discover which
 * filters to visibility = OPEN only. This function is kept as a stub so
 * compile-time imports don't break, but it is not called from any route.
 *
 * TODO: remove this function in S56 cleanup.
 */
export async function getDiscoverGroups(userId: string, limit = 20) {
  // S54: redirected to /api/groups/discover which correctly filters by visibility.
  // This stub is unreferenced by route handlers after S54 — safe to delete in S56.
  const groups = await prisma.group.findMany({
    where: {
      isArchived: false,
      visibility: "OPEN",
      memberships: {
        none: {
          userId
        }
      }
    },
    take: limit,
    orderBy: {
      createdAt: "desc"
    },
    include: {
      _count: {
        select: {
          memberships: { where: { bannedAt: null } },
          markets: true
        }
      }
    }
  });

  return groups.map((group) => ({
    id: group.id,
    slug: group.slug,
    name: group.name,
    description: group.description,
    memberCount: group._count.memberships,
    marketCount: group._count.markets
  }));
}

// ── S57: Typed error codes ─────────────────────────────────────────────────────

export class GroupServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "GroupServiceError";
  }
}

// ── S57: Leave group ───────────────────────────────────────────────────────────

/**
 * Hard-deletes the caller's GroupMembership row, allowing them to voluntarily
 * leave a group. Banned users are tombstoned by design and cannot self-leave.
 * Group OWNERs must transfer ownership or archive before leaving.
 *
 * Throws GroupServiceError with typed codes for route-level HTTP mapping.
 */
export async function leaveGroup(input: { groupId: string; userId: string }) {
  const { groupId, userId } = input;

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true, isArchived: true }
  });

  if (!group || group.isArchived) {
    throw new GroupServiceError("group_not_found", "Group not found.");
  }

  const membership = await prisma.groupMembership.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { role: true, bannedAt: true }
  });

  if (!membership) {
    throw new GroupServiceError("not_member", "You are not a member of this group.");
  }

  if (membership.bannedAt != null) {
    // Banned users are tombstoned. The tombstone row must remain so re-join is blocked.
    throw new GroupServiceError("banned", "You have been removed from this group.");
  }

  if (membership.role === GroupRole.OWNER) {
    throw new GroupServiceError(
      "owner_must_transfer_or_archive",
      "Group owners must transfer ownership or archive the group before leaving."
    );
  }

  await prisma.groupMembership.delete({
    where: { groupId_userId: { groupId, userId } }
  });
}

// ── S57: Transfer ownership ────────────────────────────────────────────────────

/**
 * Atomically transfers group ownership from the current OWNER to a new member.
 * The outgoing owner is demoted to ADMIN (retains moderation power for cleanup).
 * The incoming owner must be an active, non-banned MEMBER or ADMIN.
 *
 * Decision rationale (recorded per CEO brief):
 *   - Outgoing owner → ADMIN (not MEMBER): they stewarded the group; admin power
 *     lets them do cleanup (remove markets, manage members) without retaining the
 *     reserved owner actions.
 *
 * // TODO S58: log ownership transfer to GroupModerationAction audit table.
 *
 * Throws GroupServiceError with typed codes for route-level HTTP mapping.
 */
export async function transferOwnership(input: {
  groupId: string;
  callerId: string;
  newOwnerId: string;
}) {
  const { groupId, callerId, newOwnerId } = input;

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true, isArchived: true }
  });

  if (!group || group.isArchived) {
    throw new GroupServiceError("group_not_found", "Group not found.");
  }

  const callerMembership = await prisma.groupMembership.findUnique({
    where: { groupId_userId: { groupId, userId: callerId } },
    select: { role: true }
  });

  if (!callerMembership || callerMembership.role !== GroupRole.OWNER) {
    throw new GroupServiceError("forbidden", "Only the group owner can transfer ownership.");
  }

  if (newOwnerId === callerId) {
    throw new GroupServiceError("self_transfer", "You are already the owner.");
  }

  const targetMembership = await prisma.groupMembership.findUnique({
    where: { groupId_userId: { groupId, userId: newOwnerId } },
    select: { role: true, bannedAt: true }
  });

  if (!targetMembership || targetMembership.bannedAt != null) {
    throw new GroupServiceError(
      "ineligible_target",
      "Target user is not an eligible member."
    );
  }

  // Atomic transaction: both role flips + Group.ownerId update must succeed or
  // neither applies. This preserves the sole-OWNER invariant. Postgres transaction
  // isolation is sufficient; no distributed lock needed.
  await prisma.$transaction([
    // 1. Demote outgoing owner to ADMIN.
    prisma.groupMembership.update({
      where: { groupId_userId: { groupId, userId: callerId } },
      data: { role: GroupRole.ADMIN }
    }),
    // 2. Promote incoming member to OWNER.
    prisma.groupMembership.update({
      where: { groupId_userId: { groupId, userId: newOwnerId } },
      data: { role: GroupRole.OWNER }
    }),
    // 3. Update Group.ownerId to mirror the membership change.
    prisma.group.update({
      where: { id: groupId },
      data: { ownerId: newOwnerId }
    })
  ]);
}

// ── S57: Archive group ────────────────────────────────────────────────────────

/**
 * Flips Group.isArchived = true. Preserves all GroupMembership rows.
 * Archive is NOT reversible in v1. // S58: add unarchive route if needed.
 * isArchived is a simple boolean flip.
 *
 * Idempotent: calling archive on an already-archived group returns without error.
 * Caller must be OWNER.
 *
 * Throws GroupServiceError with typed codes for route-level HTTP mapping.
 */
export async function archiveGroup(input: { groupId: string; callerId: string }) {
  const { groupId, callerId } = input;

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true, isArchived: true }
  });

  if (!group) {
    throw new GroupServiceError("group_not_found", "Group not found.");
  }

  // Idempotent — already archived; no-op.
  if (group.isArchived) {
    return;
  }

  const callerMembership = await prisma.groupMembership.findUnique({
    where: { groupId_userId: { groupId, userId: callerId } },
    select: { role: true }
  });

  if (!callerMembership || callerMembership.role !== GroupRole.OWNER) {
    throw new GroupServiceError("forbidden", "Only the group owner can archive the group.");
  }

  await prisma.group.update({
    where: { id: groupId },
    data: { isArchived: true }
  });
}

// ── Existing function below ───────────────────────────────────────────────────

// ── S58: Notification preferences ─────────────────────────────────────────────

/**
 * Returns the caller's notification level for a specific group.
 * If no preference row exists, returns ALL (the implicit default).
 * NEVER creates a row on read.
 */
export async function getGroupNotifPref(
  groupId: string,
  userId: string
): Promise<GroupNotifLevel> {
  const row = await prisma.groupNotificationPreference.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { level: true }
  });
  return row?.level ?? GroupNotifLevel.ALL;
}

/**
 * Upserts a GroupNotificationPreference row for (groupId, userId).
 * Creates the row if absent, updates if present.
 * Returns the saved level.
 */
export async function setGroupNotifPref(
  groupId: string,
  userId: string,
  level: GroupNotifLevel
): Promise<GroupNotifLevel> {
  const row = await prisma.groupNotificationPreference.upsert({
    where: { groupId_userId: { groupId, userId } },
    create: { groupId, userId, level },
    update: { level },
    select: { level: true }
  });
  return row.level;
}

export async function getUserGroups(userId: string) {
  const memberships = await prisma.groupMembership.findMany({
    where: {
      userId,
      group: {
        isArchived: false
      }
    },
    include: {
      group: {
        include: {
          _count: {
            select: {
              memberships: true,
              markets: true
            }
          }
        }
      }
    },
    orderBy: {
      joinedAt: "desc"
    }
  });

  return memberships.map((membership) => ({
    id: membership.group.id,
    slug: membership.group.slug,
    name: membership.group.name,
    description: membership.group.description,
    inviteCode: membership.group.inviteCode,
    role: membership.role,
    memberCount: membership.group._count.memberships,
    marketCount: membership.group._count.markets
  }));
}
