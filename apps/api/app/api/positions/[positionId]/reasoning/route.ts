/**
 * PATCH /api/positions/[positionId]/reasoning
 *
 * Updates only the `reasoning` text on an existing MarketPosition. Used by
 * flagship polls where the user's side is locked but they can keep refining
 * their reasoning until the event closes.
 *
 * Auth: required. User must own the position.
 * Body: { reasoning: string | null }  (1–500 chars; null/empty string clears it)
 */

import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: { positionId: string } }
) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | { reasoning?: string | null }
      | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const raw = body.reasoning;
    let normalised: string | null;
    if (raw == null) {
      normalised = null;
    } else if (typeof raw !== "string") {
      return NextResponse.json({ error: "reasoning must be a string." }, { status: 400 });
    } else {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        normalised = null;
      } else if (trimmed.length > 500) {
        return NextResponse.json({ error: "Reasoning must be 500 characters or less." }, { status: 400 });
      } else {
        normalised = trimmed;
      }
    }

    // Try MarketPosition first, then fall back to MultiChoicePosition.
    const binaryPosition = await prisma.marketPosition.findUnique({
      where: { id: params.positionId },
      select: { id: true, userId: true },
    });

    if (binaryPosition) {
      if (binaryPosition.userId !== userId) {
        return NextResponse.json({ error: "You can only edit your own reasoning." }, { status: 403 });
      }
      await prisma.marketPosition.update({
        where: { id: binaryPosition.id },
        data: { reasoning: normalised },
      });
      return NextResponse.json({ ok: true, reasoning: normalised });
    }

    const multiPosition = await prisma.multiChoicePosition.findUnique({
      where: { id: params.positionId },
      select: { id: true, userId: true },
    });

    if (!multiPosition) {
      return NextResponse.json({ error: "Position not found." }, { status: 404 });
    }

    if (multiPosition.userId !== userId) {
      return NextResponse.json({ error: "You can only edit your own reasoning." }, { status: 403 });
    }

    await prisma.multiChoicePosition.update({
      where: { id: multiPosition.id },
      data: { reasoning: normalised },
    });

    return NextResponse.json({ ok: true, reasoning: normalised });
  } catch (error) {
    console.error("[positions.reasoning PATCH]", error);
    return NextResponse.json({ error: "Unable to update reasoning." }, { status: 500 });
  }
}
