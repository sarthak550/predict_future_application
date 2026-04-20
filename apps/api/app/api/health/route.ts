import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "@predict-future/api",
    timestamp: new Date().toISOString()
  });
}
