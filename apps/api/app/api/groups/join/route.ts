import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { getUserGroups, joinGroupByInviteCode } from "@/lib/groups/service";
import { prisma } from "@/lib/prisma";
import { joinGroupSchema } from "@/lib/validations/group";

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const session = await getSession();
    const userId = session?.user?.id ?? searchParams.get("userId");
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
      return NextResponse.json({ error: "Account cannot join groups." }, { status: 403 });
    }

    const payload = joinGroupSchema.parse(await request.json());
    const joinedGroup = await joinGroupByInviteCode({
      userId: actor.id,
      inviteCode: payload.inviteCode
    });
    const groups = await getUserGroups(actor.id);
    const group = groups.find((item) => item.id === joinedGroup.id);

    if (!group) {
      throw new Error("Unable to load the joined group.");
    }

    return NextResponse.json({ group }, { status: 200 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to join group." },
      { status: 400 }
    );
  }
}
