import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 10;

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor") ?? undefined;

  const expert = await prisma.expert.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!expert) {
    return NextResponse.json({ error: "Expert not found." }, { status: 404 });
  }

  // Decode cursor: "publishedAt_ISO::id"
  let cursorWhere = {};
  if (cursor) {
    const [tsStr, cursorId] = cursor.split("::");
    const ts = tsStr ? new Date(tsStr) : null;
    if (ts && cursorId) {
      cursorWhere = {
        OR: [
          { publishedAt: { lt: ts } },
          { AND: [{ publishedAt: ts }, { id: { lt: cursorId } }] },
        ],
      };
    }
  }

  const opinions = await prisma.expertOpinion.findMany({
    where: {
      expertId: params.id,
      suppressedAt: null,
      ...cursorWhere,
    },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    include: {
      votes: {
        where: { pollType: "RETROSPECTIVE" },
        select: { choice: true },
      },
      story: { select: { id: true, headline: true } },
    },
  });

  const hasMore = opinions.length > PAGE_SIZE;
  const items = hasMore ? opinions.slice(0, PAGE_SIZE) : opinions;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last
    ? `${last.publishedAt.toISOString()}::${last.id}`
    : null;

  return NextResponse.json({
    items: items.map((o) => {
      const hitCount = o.votes.filter((v) => v.choice === "HIT").length;
      const missCount = o.votes.filter((v) => v.choice === "MISS").length;
      return {
        id: o.id,
        quote: o.quote,
        direction: o.direction,
        publishedAt: o.publishedAt.toISOString(),
        resolutionStatus: o.resolutionStatus,
        resolvedAt: o.resolvedAt?.toISOString() ?? null,
        resolutionNote: o.resolutionNote,
        storyId: o.story?.id ?? null,
        storyHeadline: o.story?.headline ?? null,
        instrument: o.instrument ?? null,
        instrumentTicker: o.instrumentTicker ?? null,
        retrospectiveTallies: {
          hit: hitCount,
          miss: missCount,
          total: o.votes.length,
        },
      };
    }),
    nextCursor,
  });
}
