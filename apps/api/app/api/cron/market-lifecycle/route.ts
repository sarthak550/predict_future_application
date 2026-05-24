import { NextResponse } from "next/server";

import { runMarketLifecycleJobs } from "@/lib/markets/lifecycle";

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

  const result = await runMarketLifecycleJobs();
  return NextResponse.json(result);
}

export async function GET(request: Request) {
  return POST(request);
}
