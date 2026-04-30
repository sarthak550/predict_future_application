import { NextResponse } from "next/server";

import { getSession, getUserIdFromRequest } from "@/lib/auth";
import { createGroup, getUserGroups } from "@/lib/groups/service";
import { prisma } from "@/lib/prisma";
import { createGroupSchema } from "@/lib/validations/group";

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
  const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const actor = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isSuspended: true
      }
    });

    if (!actor || actor.isSuspended) {
      return NextResponse.json({ error: "Account cannot create groups." }, { status: 403 });
    }

    const payload = createGroupSchema.parse(await request.json());
    const createdGroup = await createGroup({
      ownerId: actor.id,
      name: payload.name,
      description: payload.description || null
    });
    const groups = await getUserGroups(actor.id);
    const group = groups.find((item) => item.id === createdGroup.id);

    if (!group) {
      throw new Error("Unable to load the created group.");
    }

    return NextResponse.json({ group }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create group." },
      { status: 400 }
    );
  }
}
