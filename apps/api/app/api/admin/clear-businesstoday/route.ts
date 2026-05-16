import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
    const result = await prisma.story.deleteMany({
      where: {
        sourceUrl: {
          contains: "businesstoday.in"
        }
      }
    });

    return NextResponse.json({
      success: true,
      deleted: result.count,
      message: `Deleted ${result.count} Business Today articles. They will be re-ingested on the next cron run.`
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
