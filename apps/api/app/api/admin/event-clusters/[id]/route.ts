/**
 * Admin: Event Cluster resource endpoints.
 *
 * PATCH  /api/admin/event-clusters/:id  — update cluster fields
 * DELETE /api/admin/event-clusters/:id  — delete cluster
 *
 * Auth: session-based, ADMIN or MODERATOR role required.
 */

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** Shared admin auth guard. Returns the actor or a NextResponse error. */
async function requireAdmin() {
  const session = await getSession();
  if (!session?.user?.id) {
    return { actor: null, error: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  }

  const actor = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true },
  });

  if (!actor || (actor.role !== "ADMIN" && actor.role !== "MODERATOR")) {
    return { actor: null, error: NextResponse.json({ error: "Admin access required." }, { status: 403 }) };
  }

  return { actor, error: null };
}

interface UpdateBody {
  title?: unknown;
  description?: unknown;
  emoji?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  dataPoints?: unknown;
  category?: unknown;
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = params;

  // Verify the cluster exists.
  const existing = await prisma.marketEventCluster.findUnique({
    where: { id },
    select: { id: true, startsAt: true, endsAt: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Event cluster not found." }, { status: 404 });
  }

  let body: UpdateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Build the update payload — only include fields that were provided.
  const updateData: Record<string, unknown> = {};

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json({ error: "title must be a non-empty string." }, { status: 400 });
    }
    updateData.name = body.title.trim();
  }

  if (body.description !== undefined) {
    updateData.description =
      typeof body.description === "string" ? body.description.trim() || null : null;
  }

  if (body.emoji !== undefined) {
    updateData.bannerEmoji =
      typeof body.emoji === "string" ? body.emoji.trim() || null : null;
  }

  if (body.startsAt !== undefined) {
    if (typeof body.startsAt !== "string" || isNaN(Date.parse(body.startsAt))) {
      return NextResponse.json({ error: "startsAt must be a valid ISO 8601 date string." }, { status: 400 });
    }
    updateData.startsAt = new Date(body.startsAt);
  }

  if (body.endsAt !== undefined) {
    if (typeof body.endsAt !== "string" || isNaN(Date.parse(body.endsAt))) {
      return NextResponse.json({ error: "endsAt must be a valid ISO 8601 date string." }, { status: 400 });
    }
    updateData.endsAt = new Date(body.endsAt);
  }

  // Validate temporal ordering after resolving effective values.
  const effectiveStartsAt =
    updateData.startsAt instanceof Date ? updateData.startsAt : existing.startsAt;
  const effectiveEndsAt =
    updateData.endsAt instanceof Date ? updateData.endsAt : existing.endsAt;

  if (effectiveEndsAt <= effectiveStartsAt) {
    return NextResponse.json({ error: "endsAt must be after startsAt." }, { status: 400 });
  }

  if (body.dataPoints !== undefined) {
    updateData.dataPoints = body.dataPoints;
  }

  if (body.category !== undefined) {
    if (typeof body.category !== "string" || !body.category) {
      return NextResponse.json({ error: "category must be a non-empty string." }, { status: 400 });
    }
    updateData.category = body.category;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No updatable fields provided." }, { status: 400 });
  }

  try {
    const cluster = await prisma.marketEventCluster.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ ok: true, cluster });
  } catch (err) {
    console.error("[admin/event-clusters/:id PATCH]", err);
    return NextResponse.json({ error: "Failed to update event cluster." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = params;

  const existing = await prisma.marketEventCluster.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Event cluster not found." }, { status: 404 });
  }

  try {
    // Detach markets from the cluster before deletion to avoid FK constraint
    // errors (markets may still reference this cluster).
    await prisma.market.updateMany({
      where: { eventClusterId: id },
      data: { eventClusterId: null },
    });

    await prisma.marketEventCluster.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/event-clusters/:id DELETE]", err);
    return NextResponse.json({ error: "Failed to delete event cluster." }, { status: 500 });
  }
}
