import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { runNewsIngestionJob } from "@/lib/jobs/newsIngestion";

export async function POST() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (session.user.role !== "ADMIN" && session.user.role !== "MODERATOR") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  if (session.user.isSuspended) {
    return NextResponse.json({ error: "Account suspended." }, { status: 403 });
  }

  try {
    const result = await runNewsIngestionJob(session.user.id);
    if (result.fetched === 0 && result.errors.length > 0) {
      return NextResponse.json(
        {
          error: "News ingestion failed.",
          details: result.errors
        },
        { status: 502 }
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to ingest news." }, { status: 400 });
  }
}
