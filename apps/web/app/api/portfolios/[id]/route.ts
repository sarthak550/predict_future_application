import { NextResponse } from "next/server";

import { updatePortfolioSchema } from "@predict-future/validation/portfolio";

import { getSession } from "@/lib/auth";
import { getPortfolioDetail } from "@/lib/portfolios/queries";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/portfolios/:id
 *
 * Owner gets the full detail payload (live holdings/cash/NAV, pending orders, daily
 * value history). A non-owner only gets it if the portfolio is PUBLIC — and even
 * then, pending orders are withheld (see getPortfolioDetail's doc comment: showing
 * another user's open trading intentions is a privacy/front-running concern the
 * brief didn't rule on, so this errs toward not exposing them).
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { access, detail } = await getPortfolioDetail(params.id, session.user.id);

  switch (access) {
    case "not-found":
      return NextResponse.json({ error: "Portfolio not found." }, { status: 404 });
    case "denied":
      return NextResponse.json({ error: "This portfolio is private." }, { status: 403 });
    case "owner":
    case "public":
      return NextResponse.json({ portfolio: detail });
  }
}

/**
 * PATCH /api/portfolios/:id
 *
 * Owner-only. Only name/description/visibility are patchable — kind, slug,
 * startingCapital, and ownership are immutable after creation. Flipping
 * PRIVATE -> PUBLIC sets publicSince once; publicSince is never cleared once set,
 * even if the portfolio later flips back to PRIVATE.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const existing = await prisma.portfolio.findUnique({ where: { id: params.id } });
  if (!existing) {
    return NextResponse.json({ error: "Portfolio not found." }, { status: 404 });
  }
  if (existing.ownerUserId !== session.user.id) {
    return NextResponse.json({ error: "You do not own this portfolio." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = updatePortfolioSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const { name, description, visibility } = parsed.data;
  if (name === undefined && description === undefined && visibility === undefined) {
    return NextResponse.json({ error: "No fields to update." }, { status: 400 });
  }

  const data: { name?: string; description?: string | null; visibility?: "PUBLIC" | "PRIVATE"; publicSince?: Date } = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description && description.length > 0 ? description : null;
  if (visibility !== undefined) {
    data.visibility = visibility;
    if (visibility === "PUBLIC" && existing.publicSince === null) {
      data.publicSince = new Date();
    }
  }

  const portfolio = await prisma.portfolio.update({ where: { id: params.id }, data });
  return NextResponse.json({ portfolio });
}
