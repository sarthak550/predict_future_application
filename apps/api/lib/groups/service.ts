import { randomUUID } from "crypto";

import { GroupRole, GroupVisibility, MarketCategory, type Prisma } from "@prisma/client";

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
