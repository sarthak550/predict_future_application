import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { ingestStories } from "@/lib/news/ingestion";
import { prisma } from "@/lib/prisma";
import { storiesIngestSchema } from "@/lib/validations/story";

export async function POST(request: Request) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const actor = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, isSuspended: true },
    });
    if (!actor || actor.isSuspended || (actor.role !== "ADMIN" && actor.role !== "MODERATOR")) {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const payload = storiesIngestSchema.parse(await request.json());
    const results = await ingestStories(payload.stories, userId);

    return NextResponse.json(
      {
        ingested: results.length,
        results
      },
      { status: 201 }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to ingest stories." }, { status: 400 });
  }
}
