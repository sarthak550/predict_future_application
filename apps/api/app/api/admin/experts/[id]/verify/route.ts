import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const verifyExpertSchema = z.object({
  // S42-T13(a): https-only, length-capped to prevent XSS via javascript: scheme
  // or oversized strings reaching <img src>.
  avatarUrl: z.string().url().startsWith("https://").max(2048).optional(),
  bio: z.string().max(2000).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isSuspended: true },
  });
  if (!actor || actor.isSuspended) {
    return NextResponse.json({ error: "Account cannot perform this action." }, { status: 403 });
  }
  if (actor.role !== "ADMIN" && actor.role !== "MODERATOR") {
    return NextResponse.json({ error: "Admin or Moderator access required." }, { status: 403 });
  }

  let rawBody: unknown = {};
  try {
    const text = await request.text();
    if (text) rawBody = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = verifyExpertSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { avatarUrl, bio } = parsed.data;

  const expert = await prisma.expert.findUnique({
    where: { id: params.id },
    select: { id: true, verified: true },
  });

  if (!expert) {
    return NextResponse.json({ error: "Expert not found." }, { status: 404 });
  }

  // S42-T13(a): Idempotency — if already verified with no profile changes
  // requested, return a 200 no-op rather than writing a redundant AdminAction.
  const hasProfileUpdate = avatarUrl !== undefined || bio !== undefined;
  if (expert.verified && !hasProfileUpdate) {
    const current = await prisma.expert.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, organization: true, verified: true, avatarUrl: true },
    });
    return NextResponse.json({ ok: true, noOp: true, expert: current });
  }

  // Wrap update + audit log in a transaction for consistency.
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.expert.update({
      where: { id: params.id },
      data: {
        verified: true,
        ...(avatarUrl !== undefined ? { avatarUrl } : {}),
        ...(bio !== undefined ? { bio } : {}),
      },
      select: {
        id: true,
        name: true,
        organization: true,
        verified: true,
        avatarUrl: true,
      },
    });

    await tx.adminAction.create({
      data: {
        actorId: actor.id,
        type: "GRANT_VERIFIED_ANALYST",
        notes: hasProfileUpdate
          ? `Verified expert and updated profile fields for expert ${params.id}.`
          : `Verified expert ${params.id}.`,
        metadata: { expertId: params.id, avatarUpdated: avatarUrl !== undefined, bioUpdated: bio !== undefined },
      },
    });

    return result;
  });

  return NextResponse.json({ ok: true, expert: updated });
}
