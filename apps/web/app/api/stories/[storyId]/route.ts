import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

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

  return NextResponse.json({ story });
}
