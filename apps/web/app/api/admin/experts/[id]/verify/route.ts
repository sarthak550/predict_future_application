import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Avatar URLs render inside <Image> on mobile and web. We require https so we
// don't accidentally trigger mixed-content warnings or render attacker-served
// http content on a secure page, and we cap length so a hostile body can't
// blow up the Postgres column / mobile bundle.
const verifyPayloadSchema = z.object({
  avatarUrl: z
    .string()
    .trim()
    .max(2048, "avatarUrl must be ≤ 2048 chars")
    .url("avatarUrl must be a valid URL")
    .refine((v) => v.startsWith("https://"), { message: "avatarUrl must be https" })
    .optional()
    .or(z.literal("")),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (session.user.role !== "ADMIN" && session.user.role !== "MODERATOR") {
    return NextResponse.json({ error: "Admin or Moderator access required." }, { status: 403 });
  }
  if (session.user.isSuspended) {
    return NextResponse.json({ error: "Account suspended." }, { status: 403 });
  }

  let raw: unknown = {};
  try {
    const text = await request.text();
    if (text) raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = verifyPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload." },
      { status: 400 }
    );
  }
  const avatarUrl = parsed.data.avatarUrl && parsed.data.avatarUrl.length > 0 ? parsed.data.avatarUrl : undefined;

  const expert = await prisma.expert.findUnique({
    where: { id: params.id },
  });

  if (!expert) {
    return NextResponse.json({ error: "Expert not found." }, { status: 404 });
  }

  // Wrap the update + audit log in a single transaction so we can never end
  // up with a verified expert and no AdminAction row to explain who did it.
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.expert.update({
      where: { id: params.id },
      data: {
        verified: true,
        ...(avatarUrl ? { avatarUrl } : {}),
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
        actorId: session.user.id,
        type: "GRANT_VERIFIED_ANALYST",
        notes: `Verified expert ${next.name} (${next.organization})`,
        metadata: {
          expertId: next.id,
          name: next.name,
          organization: next.organization,
          previouslyVerified: expert.verified,
          avatarUrlChanged: Boolean(avatarUrl) && avatarUrl !== expert.avatarUrl,
        },
      },
    });

    return next;
  });

  return NextResponse.json({ ok: true, expert: updated });
}
