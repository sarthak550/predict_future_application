import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { ingestStories } from "@/lib/news/ingestion";
import { storiesIngestSchema } from "@/lib/validations/story";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    if (session.user.role !== "ADMIN" && session.user.role !== "MODERATOR") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const payload = storiesIngestSchema.parse(await request.json());
    const results = await ingestStories(payload.stories, session.user.id);

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
