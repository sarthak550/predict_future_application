import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { updateChartDrawingSchema } from "@predict-future/validation/chartDrawings";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Charting Workbench (W1) — drawings CRUD single-resource route. Same
 * session-auth + direct-prisma pattern as the collection route
 * (../route.ts). Ownership is enforced by including `userId` directly in
 * the mutation's `where` clause (`updateMany`/`deleteMany`, never a plain
 * `findUnique` followed by an app-code ownership check) so a cross-user id
 * simply matches zero rows — the DB itself is the ownership boundary, not a
 * read-then-trust step. A miss and a cross-user id are indistinguishable to
 * the caller: both 404, never a 403 that would leak the row's existence to
 * someone who doesn't own it.
 */

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
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

  const parsed = updateChartDrawingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const data: Prisma.ChartDrawingUpdateManyMutationInput = {};
  if (parsed.data.points !== undefined) data.points = parsed.data.points;
  if (parsed.data.styles !== undefined) data.styles = parsed.data.styles as Prisma.InputJsonValue;
  if (parsed.data.visible !== undefined) data.visible = parsed.data.visible;

  const result = await prisma.chartDrawing.updateMany({
    where: { id: params.id, userId: session.user.id },
    data,
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Drawing not found." }, { status: 404 });
  }

  const drawing = await prisma.chartDrawing.findUnique({ where: { id: params.id } });
  return NextResponse.json({ drawing });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const result = await prisma.chartDrawing.deleteMany({
    where: { id: params.id, userId: session.user.id },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Drawing not found." }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
