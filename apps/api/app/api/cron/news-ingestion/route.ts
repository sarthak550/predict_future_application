import { NextResponse } from "next/server";

import { runNewsIngestionJob } from "@/lib/jobs/newsIngestion";

function hasCronAccess(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }

  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");

  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

export async function POST(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await runNewsIngestionJob();
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
    return NextResponse.json({ error: "Unable to run news ingestion." }, { status: 400 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
