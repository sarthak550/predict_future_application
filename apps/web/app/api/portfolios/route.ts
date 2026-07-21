import { NextResponse } from "next/server";

import { PORTFOLIO_MAX_PER_USER, createPortfolioSchema } from "@predict-future/validation/portfolio";

import { getSession } from "@/lib/auth";
import { generateUniquePortfolioSlug } from "@/lib/portfolios/slug";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/portfolios
 *
 * Creates a new USER-kind Portfolio owned by the caller. Namespace is /portfolios
 * (plural) — distinct from the legacy /portfolio/[username] bet-record page.
 * SHADOW (expert-owned) portfolios have no public creation path in P3.1.
 */
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

  const parsed = createPortfolioSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const existingCount = await prisma.portfolio.count({ where: { ownerUserId: session.user.id } });
  if (existingCount >= PORTFOLIO_MAX_PER_USER) {
    return NextResponse.json(
      { error: `You can have at most ${PORTFOLIO_MAX_PER_USER} portfolios.` },
      { status: 409 }
    );
  }

  const { name, description, visibility } = parsed.data;
  const slug = await generateUniquePortfolioSlug(prisma, name);
  const resolvedVisibility = visibility ?? "PRIVATE";

  const portfolio = await prisma.portfolio.create({
    data: {
      ownerUserId: session.user.id,
      kind: "USER",
      name,
      slug,
      visibility: resolvedVisibility,
      description: description && description.length > 0 ? description : null,
      publicSince: resolvedVisibility === "PUBLIC" ? new Date() : null
    }
  });

  return NextResponse.json({ portfolio }, { status: 201 });
}
