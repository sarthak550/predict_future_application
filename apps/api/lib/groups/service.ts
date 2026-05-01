import { randomUUID } from "crypto";

import { GroupRole, type Prisma } from "@prisma/client";

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
}) {
  return prisma.$transaction(async (tx) => createGroupTx(tx, input));
}

export async function createGroupTx(
  tx: TxClient,
  input: {
    ownerId: string;
    name: string;
    description?: string | null;
  }
) {
  const group = await tx.group.create({
    data: {
      name: input.name,
      description: input.description || null,
      slug: buildGroupSlug(input.name),
      inviteCode: buildInviteCode(),
      ownerId: input.ownerId
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
 * Returns groups the given user is NOT already a member of, ordered by
 * most-recently-created first, capped at `limit` results.
 */
export async function getDiscoverGroups(userId: string, limit = 20) {
  const groups = await prisma.group.findMany({
    where: {
      isArchived: false,
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
          memberships: true,
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
    // Note: inviteCode is intentionally omitted — users must enter it manually
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
