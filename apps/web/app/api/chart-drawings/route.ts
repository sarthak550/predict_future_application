import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { chartKeySchema, createChartDrawingSchema, CHART_DRAWINGS_MAX_PER_CHART_KEY } from "@predict-future/validation/chartDrawings";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Charting Workbench (W1) — drawings CRUD collection route. Session auth
 * (`getSession()`), direct prisma via `apps/web/lib/prisma.ts`, exact
 * pattern of `apps/web/app/api/paper-trading/pending-orders/route.ts`.
 *
 * GET /api/chart-drawings?chartKey= — lists the caller's drawings for one
 * chart key, newest first.
 *
 * POST /api/chart-drawings — creates one drawing. 200-row cap per
 * (userId, chartKey): a 201st row for the same pair 422s. The cap is
 * enforced via a single `count()` query before the `create()` — not a
 * transaction-wrapped read-then-write — so there is a small TOCTOU window
 * where two concurrent requests could both pass the count check and briefly
 * push the pair to 201/202 rows. Accepted: same posture as every other cap
 * check in this codebase (e.g. the pending-orders block checks), and a
 * drawing-count race is low-stakes (worst case a couple of extra rows, not
 * a financial or security issue).
 *
 * DELETE /api/chart-drawings?chartKey= — batch-clears every drawing the
 * caller owns for one chart key (the toolbar's "clear all" action). Returns
 * the deleted count.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const rawChartKey = new URL(request.url).searchParams.get("chartKey");
  const parsedChartKey = chartKeySchema.safeParse(rawChartKey ?? "");
  if (!parsedChartKey.success) {
    return NextResponse.json({ error: parsedChartKey.error.issues[0]?.message ?? "A valid chartKey query param is required." }, { status: 400 });
  }

  const drawings = await prisma.chartDrawing.findMany({
    where: { userId: session.user.id, chartKey: parsedChartKey.data },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ drawings });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = createChartDrawingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const existingCount = await prisma.chartDrawing.count({
    where: { userId: session.user.id, chartKey: parsed.data.chartKey },
  });
  if (existingCount >= CHART_DRAWINGS_MAX_PER_CHART_KEY) {
    return NextResponse.json(
      { error: `This chart already has the maximum of ${CHART_DRAWINGS_MAX_PER_CHART_KEY} saved drawings — delete one before adding another.` },
      { status: 422 }
    );
  }

  const drawing = await prisma.chartDrawing.create({
    data: {
      userId: session.user.id,
      chartKey: parsed.data.chartKey,
      overlayName: parsed.data.overlayName,
      points: parsed.data.points,
      styles: parsed.data.styles as Prisma.InputJsonValue | undefined,
    },
  });

  return NextResponse.json({ drawing }, { status: 201 });
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const rawChartKey = new URL(request.url).searchParams.get("chartKey");
  const parsedChartKey = chartKeySchema.safeParse(rawChartKey ?? "");
  if (!parsedChartKey.success) {
    return NextResponse.json({ error: parsedChartKey.error.issues[0]?.message ?? "A valid chartKey query param is required." }, { status: 400 });
  }

  const result = await prisma.chartDrawing.deleteMany({
    where: { userId: session.user.id, chartKey: parsedChartKey.data },
  });

  return NextResponse.json({ deletedCount: result.count });
}
