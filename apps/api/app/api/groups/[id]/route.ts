import { NextResponse } from "next/server";

import { getSession, getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { searchParams } = new URL(request.url);
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const viewer = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true
    }
  });

  if (!viewer) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const group = await prisma.group.findUnique({
    where: { id: params.id },
    include: {
      owner: {
        select: {
          username: true
        }
      },
      memberships: {
        include: {
          user: {
            select: {
              username: true,
              reputationScore: true
            }
          }
        },
        orderBy: {
          joinedAt: "asc"
        }
      },
      markets: {
        where: {
          visibility: "PRIVATE"
        },
        include: {
          creator: {
            select: {
              username: true,
              reputationScore: true
            }
          }
        },
        orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }]
      }
    }
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  const isMember =
    viewer.role === "ADMIN" ||
    viewer.role === "MODERATOR" ||
    group.ownerId === viewer.id ||
    group.memberships.some((membership) => membership.userId === viewer.id);

  if (!isMember) {
    return NextResponse.json({ error: "Group access denied." }, { status: 403 });
  }

  return NextResponse.json({ group });
}
