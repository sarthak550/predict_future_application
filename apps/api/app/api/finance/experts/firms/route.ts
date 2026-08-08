import { NextResponse } from "next/server";
import { canonicalizeOrgDisplay } from "@predict-future/business-rules/experts/firmAliases";
import { prisma } from "@/lib/prisma";

// Param-less GET → Next tries to STATICALLY prerender this at build time,
// executing the Prisma query inside the build container (no DATABASE_URL)
// and failing the whole image build. Same idiom as finance/indices/route.ts.
export const dynamic = "force-dynamic";

/**
 * GET /api/finance/experts/firms
 *
 * Distinct canonical firms among HUMAN experts with at least one public
 * opinion, with counts — feeds the mobile "Firm" filter on the expert
 * search and leaderboard screens (founder ask, 2026-08-08: "another filter
 * with Analyst where you can filter the firms"). Mirrors apps/web's
 * buildFirmOptions (lib/finance/analysts.ts) so the mobile and web filter
 * lists agree on what counts as a filterable firm — HUMAN entities only
 * (FIRM "org-as-analyst" identities aren't something a person can be "from"),
 * canonicalized through the shared alias map so a stray pre-merge acronym
 * spelling never appears as its own separate option next to its spelled-out
 * sibling.
 *
 * Deliberately NOT scoped to the credibility-qualified leaderboard pool (5+
 * resolved calls) — the search screen lists any expert with a public opinion,
 * so the filter's universe matches search's broader pool, not the narrower
 * leaderboard one. A firm filter selected on the leaderboard screen still
 * only ever surfaces qualified experts from within it; this endpoint just
 * supplies the chip list.
 */
export async function GET() {
  const experts = await prisma.expert.findMany({
    where: { entityKind: "HUMAN", opinions: { some: { suppressedAt: null } } },
    select: { organization: true },
  });

  const counts = new Map<string, number>();
  for (const expert of experts) {
    const firm = canonicalizeOrgDisplay(expert.organization);
    if (!firm) continue;
    counts.set(firm, (counts.get(firm) ?? 0) + 1);
  }

  const firms = [...counts.entries()]
    .map(([firm, count]) => ({ firm, count }))
    .sort((a, b) => b.count - a.count || a.firm.localeCompare(b.firm));

  const response = NextResponse.json(firms);
  response.headers.set("Cache-Control", "public, max-age=300");
  return response;
}
