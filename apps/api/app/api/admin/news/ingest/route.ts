import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { runNewsIngestionJob } from "@/lib/jobs/newsIngestion";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isSuspended: true },
  });
  if (!actor || actor.isSuspended) {
    return NextResponse.json({ error: "Account cannot perform this action." }, { status: 403 });
  }
  if (actor.role !== "ADMIN" && actor.role !== "MODERATOR") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  try {
    const result = await runNewsIngestionJob(actor.id);
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
