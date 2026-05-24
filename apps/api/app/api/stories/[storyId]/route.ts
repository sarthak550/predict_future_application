import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Public-feed statuses — stories outside this set (DRAFT, PENDING_REVIEW,
// REJECTED, ARCHIVED) must only be visible to admins/moderators.
const PUBLIC_STORY_STATUSES = ["APPROVED", "PUBLISHED"] as const;

export async function GET(
  request: Request,
  { params }: { params: { storyId: string } }
) {
  const story = await prisma.story.findUnique({
    where: { id: params.storyId },
    include: {
      source: true,
      market: true
    }
  });

  if (!story) {
    return NextResponse.json({ error: "Story not found." }, { status: 404 });
  }

  const isPublic = (PUBLIC_STORY_STATUSES as readonly string[]).includes(story.status);
  if (!isPublic) {
    // Unapproved stories must only leak to admins/moderators. Anyone else
    // (anonymous or regular user) sees the same 404 they'd get for a
    // non-existent storyId — we don't want to confirm the ID is real.
    const userId = await getUserIdFromRequest(request);
    const viewer = userId
      ? await prisma.user.findUnique({
          where: { id: userId },
          select: { role: true },
        })
      : null;
    const isStaff = viewer?.role === "ADMIN" || viewer?.role === "MODERATOR";
    if (!isStaff) {
      return NextResponse.json({ error: "Story not found." }, { status: 404 });
    }
  }

  return NextResponse.json({ story });
}
