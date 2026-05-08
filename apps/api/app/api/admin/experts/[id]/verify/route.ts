import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

  let body: { avatarUrl?: string } = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const expert = await prisma.expert.findUnique({
    where: { id: params.id },
  });

  if (!expert) {
    return NextResponse.json({ error: "Expert not found." }, { status: 404 });
  }

  const updated = await prisma.expert.update({
    where: { id: params.id },
    data: {
      verified: true,
      ...(body.avatarUrl ? { avatarUrl: body.avatarUrl } : {}),
    },
    select: {
      id: true,
      name: true,
      organization: true,
      verified: true,
      avatarUrl: true,
    },
  });

  return NextResponse.json({ ok: true, expert: updated });
}
