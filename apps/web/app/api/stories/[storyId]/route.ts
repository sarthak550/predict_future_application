import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const PUBLIC_STORY_STATUSES = ["APPROVED", "PUBLISHED"] as const;

export async function GET(
  _request: Request,
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
    // Hide unapproved stories from non-admin viewers; return the same 404
    // the unauthenticated path would, so the ID isn't confirmed as real.
    const session = await getSession();
    const isStaff = session?.user?.role === "ADMIN" || session?.user?.role === "MODERATOR";
    if (!isStaff) {
      return NextResponse.json({ error: "Story not found." }, { status: 404 });
    }
  }

  return NextResponse.json({ story });
}
