/**
 * S46 one-time cleanup — cancel stale auto-generated SPORTS polls and refund positions.
 *
 * Staleness criteria: status=OPEN AND category=SPORTS AND storyId IS NOT NULL AND
 *   (closeAt < NOW() OR story.publishedAt < NOW() - 7 days)
 *
 * Uses cancelMarketAfterReview which runs the full audit+refund flow via settleMarket.
 * NEVER does raw DB updates to Market or wallet tables.
 *
 * Usage:
 *   DRY RUN (preview only, no writes):
 *     npx tsx scripts/cancel-stale-sports-polls.ts --dry-run
 *
 *   APPLY:
 *     npx tsx scripts/cancel-stale-sports-polls.ts
 *
 * NOTE: Deploy S46-T1 (the generation prevention fix) before running this in production
 * so that no new stale sports polls are created between the script run and the next
 * ingest cycle.
 */

import { cancelMarketAfterReview } from "../lib/markets/resolution";
import { prisma } from "../lib/prisma";

const DRY_RUN = process.argv.includes("--dry-run");

const CANCELLATION_EXPLANATION =
  "This poll was auto-generated from a sports news story but the outcome may already be public by now. It has been cancelled and all stakes refunded.";

async function main(): Promise<void> {
  console.log(`[cancel-stale-sports] mode = ${DRY_RUN ? "DRY RUN" : "APPLY"}`);

  // Resolve the system actor (used as actorId for cancelMarketAfterReview)
  const systemEmail = process.env.SYSTEM_ADMIN_EMAIL;
  const admin = systemEmail
    ? await prisma.user.findUnique({ where: { email: systemEmail }, select: { id: true } })
    : await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });

  if (!admin) {
    throw new Error(
      "No admin user found. Set SYSTEM_ADMIN_EMAIL env var or ensure at least one ADMIN user exists."
    );
  }
  const SYSTEM_ACTOR_ID = admin.id;
  console.log(`[cancel-stale-sports] actor=${SYSTEM_ACTOR_ID}`);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const now = new Date();

  // Find all OPEN SPORTS polls linked to a story where either:
  //   - closeAt has already passed (poll window over), or
  //   - the source story is more than 7 days old
  const candidates = await prisma.market.findMany({
    where: {
      status: "OPEN",
      category: "SPORTS",
      storyId: { not: null },
      OR: [
        { closeAt: { lt: now } },
        { story: { publishedAt: { lt: sevenDaysAgo } } },
      ],
    },
    include: {
      story: { select: { publishedAt: true, headline: true } },
      _count: { select: { positions: true } },
    },
    orderBy: { closeAt: "asc" },
  });

  console.log(`[cancel-stale-sports] found ${candidates.length} candidate(s)`);

  let cancelled = 0;
  const errors: string[] = [];

  for (const market of candidates) {
    const reason = market.closeAt < now ? "closeAt-passed" : "stale-story";
    const storyAge = market.story
      ? Math.round((now.getTime() - market.story.publishedAt.getTime()) / (1000 * 60 * 60 * 24))
      : "?";
    console.log(
      `[cancel] id=${market.id} positions=${market._count.positions} reason=${reason} storyAgeDays=${storyAge} title="${market.title.slice(0, 60)}"`
    );

    if (DRY_RUN) continue;

    try {
      await cancelMarketAfterReview({
        marketId: market.id,
        actorId: SYSTEM_ACTOR_ID,
        explanation: CANCELLATION_EXPLANATION,
      });
      cancelled++;
      // Throttle: 300ms between cancellations to avoid overwhelming the wallet ledger
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cancel] FAILED id=${market.id}: ${msg}`);
      errors.push(`${market.id}: ${msg}`);
    }
  }

  console.log(`
[cancel-stale-sports] summary:
  scanned:  ${candidates.length}
  cancelled: ${DRY_RUN ? `0 (dry-run, would have cancelled ${candidates.length})` : cancelled}
  errors:    ${errors.length}
`);

  if (DRY_RUN) {
    console.log("Re-run without --dry-run to apply changes.");
  }

  if (errors.length > 0) {
    console.error("[cancel-stale-sports] errors encountered:", errors);
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error("[cancel-stale-sports] fatal:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
