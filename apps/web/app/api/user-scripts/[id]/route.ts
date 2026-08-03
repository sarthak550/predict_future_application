import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { updateUserScriptSchema } from "@predict-future/validation/userScripts";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * User Strategy Scripting (SS1) — scripts CRUD single-resource route. Same
 * session-auth + direct-prisma pattern as the collection route
 * (../route.ts). Ownership is enforced by including `userId` directly in
 * the mutation's `where` clause (`updateMany`/`deleteMany`, never a plain
 * `findUnique` followed by an app-code ownership check) so a cross-user id
 * simply matches zero rows — the DB itself is the ownership boundary, not a
 * read-then-trust step. A miss and a cross-user id are indistinguishable to
 * the caller: both 404, never a 403 that would leak the row's existence to
 * someone who doesn't own it.
 */

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = updateUserScriptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const data: Prisma.UserStrategyScriptUpdateManyMutationInput = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.source !== undefined) data.source = parsed.data.source;

  try {
    const result = await prisma.userStrategyScript.updateMany({
      where: { id: params.id, userId: session.user.id },
      data,
    });

    if (result.count === 0) {
      return NextResponse.json({ error: "Script not found." }, { status: 404 });
    }

    const script = await prisma.userStrategyScript.findUnique({ where: { id: params.id } });
    return NextResponse.json({ script });
  } catch (error: unknown) {
    if (isPrismaUniqueConstraintError(error) && parsed.data.name !== undefined) {
      return NextResponse.json({ error: `You already have a script named '${parsed.data.name}'.` }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const result = await prisma.userStrategyScript.deleteMany({
    where: { id: params.id, userId: session.user.id },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Script not found." }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}

/** Narrow, dependency-free check for Prisma's `P2002` unique-constraint-violation error code — avoids importing `Prisma.PrismaClientKnownRequestError` just for an instanceof check. */
function isPrismaUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}
