/**
 * PATCH /api/users/me/display-mode
 *
 * Toggles the authenticated user's display mode between USERNAME and ANONYMOUS.
 *
 * Body: { displayMode: "USERNAME" | "ANONYMOUS" }
 * Auth: required.
 *
 * Returns: { displayMode: "USERNAME" | "ANONYMOUS" }
 *
 * Design: anonymity is display-only. The user's accuracy record, wallet
 * balance, league position, and quest rewards all continue to accrue to
 * the real userId regardless of displayMode. Only public-facing name
 * rendering is affected.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  displayMode: z.enum(["USERNAME", "ANONYMOUS"]),
});

export async function PATCH(request: Request) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const parseResult = bodySchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "displayMode must be 'USERNAME' or 'ANONYMOUS'." },
        { status: 400 }
      );
    }

    const { displayMode } = parseResult.data;

    const user = await prisma.user.update({
      where: { id: userId },
      data: { displayMode },
      select: { id: true, displayMode: true },
    });

    return NextResponse.json({ displayMode: user.displayMode });
  } catch (error) {
    console.error("[display-mode PATCH]", error);
    return NextResponse.json(
      { error: "Unable to update display mode." },
      { status: 500 }
    );
  }
}

// Also accept PUT for clients that prefer it.
export { PATCH as PUT };
