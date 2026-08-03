import { NextResponse } from "next/server";

import { createUserScriptSchema, USER_SCRIPT_MAX_PER_USER } from "@predict-future/validation/userScripts";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * User Strategy Scripting (SS1) — scripts CRUD collection route. Session
 * auth (`getSession()`), direct prisma via `apps/web/lib/prisma.ts`, exact
 * pattern of `apps/web/app/api/chart-drawings/route.ts`.
 *
 * GET /api/user-scripts — lists every script the caller owns, newest
 * `updatedAt` first, FULL rows (including `source`) — a single fetch is
 * enough to open any script for editing without a second round trip (50
 * scripts x 20KB source cap ~= 1MB worst case, acceptable for one
 * authenticated fetch).
 *
 * POST /api/user-scripts — creates one script. `USER_SCRIPT_MAX_PER_USER`
 * (50) cap enforced via a single `count()` query before `create()` — not a
 * transaction-wrapped read-then-write — so there is a small, accepted TOCTOU
 * window where two concurrent requests could both pass the count check and
 * briefly push the caller past 50 scripts (same posture as
 * `CHART_DRAWINGS_MAX_PER_CHART_KEY`'s own cap check). A name collision
 * (`@@unique([userId, name])`, Prisma `P2002`) is mapped to a clean 409, not
 * a raw 500.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const scripts = await prisma.userStrategyScript.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ scripts });
}

export async function POST(request: Request) {
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

  const parsed = createUserScriptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const existingCount = await prisma.userStrategyScript.count({
    where: { userId: session.user.id },
  });
  if (existingCount >= USER_SCRIPT_MAX_PER_USER) {
    return NextResponse.json(
      { error: `You already have the maximum of ${USER_SCRIPT_MAX_PER_USER} saved scripts — delete one before adding another.` },
      { status: 422 }
    );
  }

  try {
    const script = await prisma.userStrategyScript.create({
      data: {
        userId: session.user.id,
        name: parsed.data.name,
        source: parsed.data.source,
      },
    });
    return NextResponse.json({ script }, { status: 201 });
  } catch (error: unknown) {
    if (isPrismaUniqueConstraintError(error)) {
      return NextResponse.json({ error: `You already have a script named '${parsed.data.name}'.` }, { status: 409 });
    }
    throw error;
  }
}

/** Narrow, dependency-free check for Prisma's `P2002` unique-constraint-violation error code — avoids importing `Prisma.PrismaClientKnownRequestError` just for an instanceof check. */
function isPrismaUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}
