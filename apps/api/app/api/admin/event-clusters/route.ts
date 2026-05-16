/**
 * Admin: Event Cluster collection endpoints.
 *
 * GET  /api/admin/event-clusters  — list all clusters (desc by startsAt)
 * POST /api/admin/event-clusters  — create a new cluster
 *
 * Auth: session-based, ADMIN or MODERATOR role required.
 */

import { Prisma } from "@prisma/client";
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

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const clusters = await prisma.marketEventCluster.findMany({
      orderBy: { startsAt: "desc" },
      include: { _count: { select: { markets: true } } },
    });

    return NextResponse.json({ ok: true, clusters });
  } catch (err) {
    console.error("[admin/event-clusters GET]", err);
    return NextResponse.json({ error: "Failed to fetch event clusters." }, { status: 500 });
  }
}

interface CreateBody {
  title?: unknown;
  description?: unknown;
  emoji?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  dataPoints?: unknown;
  category?: unknown;
}

export async function POST(request: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  let body: CreateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Validate required fields.
  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title is required and must be a non-empty string." }, { status: 400 });
  }
  if (typeof body.startsAt !== "string" || isNaN(Date.parse(body.startsAt))) {
    return NextResponse.json({ error: "startsAt is required and must be a valid ISO 8601 date string." }, { status: 400 });
  }
  if (typeof body.endsAt !== "string" || isNaN(Date.parse(body.endsAt))) {
    return NextResponse.json({ error: "endsAt is required and must be a valid ISO 8601 date string." }, { status: 400 });
  }

  const startsAt = new Date(body.startsAt);
  const endsAt = new Date(body.endsAt);

  if (endsAt <= startsAt) {
    return NextResponse.json({ error: "endsAt must be after startsAt." }, { status: 400 });
  }

  // Derive a unique slug from the title.
  const baseSlug = body.title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const timestamp = Date.now();
  const slug = `${baseSlug}-${timestamp}`;

  try {
    const cluster = await prisma.marketEventCluster.create({
      data: {
        slug,
        name: body.title.trim(),
        description: typeof body.description === "string" ? body.description.trim() || null : null,
        bannerEmoji: typeof body.emoji === "string" ? body.emoji.trim() || null : null,
        startsAt,
        endsAt,
        dataPoints:
          body.dataPoints !== undefined
            ? (body.dataPoints as Prisma.InputJsonValue)
            : undefined,
        category:
          typeof body.category === "string" && body.category
            ? (body.category as "FINANCE")
            : "FINANCE",
      },
    });

    return NextResponse.json({ ok: true, cluster }, { status: 201 });
  } catch (err) {
    console.error("[admin/event-clusters POST]", err);
    return NextResponse.json({ error: "Failed to create event cluster." }, { status: 500 });
  }
}
