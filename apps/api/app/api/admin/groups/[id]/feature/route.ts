/**
 * S59-T5: POST /api/admin/groups/:id/feature
 *
 * Sets or clears the isFeatured flag on a group.
 * Featured groups appear first in the discover rail (before member-count sort).
 *
 * Auth: platform ADMIN or MODERATOR role required.
 * Body: { featured: boolean }
 * Response: { isFeatured: boolean }
 */

import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const callerId = await getUserIdFromRequest(request);
  if (!callerId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  // Platform admin/moderator check — same pattern as S57 group detail route.
  const viewer = await prisma.user.findUnique({
    where: { id: callerId },
    select: { role: true },
  });

  if (
    !viewer ||
    (viewer.role !== "ADMIN" && viewer.role !== "MODERATOR")
  ) {
    return NextResponse.json(
      { error: "Platform ADMIN or MODERATOR role required." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const featured = (body as Record<string, unknown>)?.featured;
  if (typeof featured !== "boolean") {
    return NextResponse.json(
      { error: "featured must be a boolean." },
      { status: 400 }
    );
  }

  const group = await prisma.group.findUnique({
    where: { id: params.id },
    select: { id: true },
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  const updated = await prisma.group.update({
    where: { id: params.id },
    data: { isFeatured: featured },
    select: { isFeatured: true },
  });

  return NextResponse.json({ isFeatured: updated.isFeatured }, { status: 200 });
}
