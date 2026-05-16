/**
 * Month-end league processing.
 *
 * processLeagueMonthEnd — for a given YYYY-MM month:
 *   1. Groups all MonthlyLeagueEntry rows by tier.
 *   2. Sorts each tier by netPointsMonth DESC and assigns sequential finalRank.
 *   3. Promotes top 20% (min 1, only when tier has >= 5 entries), relegates
 *      bottom 20% (min 1, same guard). Middle stays.
 *   4. Writes the next-month MonthlyLeagueEntry rows at the new tier.
 *   5. Updates User.currentLeagueTier for all processed users.
 *   6. Sends LEVEL_UP notifications to promoted users and SYSTEM notifications
 *      to relegated users.
 *   All writes happen inside a single prisma.$transaction.
 *
 * Tier ordering:
 *   BRONZE < SILVER < GOLD < PLATINUM < DIAMOND
 *   DIAMOND cannot be promoted further; BRONZE cannot be relegated further.
 *
 * Idempotency:
 *   Returns { alreadyProcessed: true } if any entries for the given month
 *   already have promoted=true or relegated=true.
 */

import type { LeagueTier } from "@prisma/client";

import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProcessLeagueMonthEndResult = {
  alreadyProcessed?: boolean;
  month?: string;
  processed?: number;
  promoted?: number;
  relegated?: number;
};

// ---------------------------------------------------------------------------
// Tier ordering helpers
// ---------------------------------------------------------------------------

const TIER_ORDER: LeagueTier[] = [
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "DIAMOND",
];

function tierAbove(tier: LeagueTier): LeagueTier {
  const idx = TIER_ORDER.indexOf(tier);
  if (idx === -1 || idx === TIER_ORDER.length - 1) return tier;
  return TIER_ORDER[idx + 1];
}

function tierBelow(tier: LeagueTier): LeagueTier {
  const idx = TIER_ORDER.indexOf(tier);
  if (idx <= 0) return tier;
  return TIER_ORDER[idx - 1];
}

/**
 * Returns the next calendar month as a 'YYYY-MM' string.
 * e.g. '2026-05' -> '2026-06', '2026-12' -> '2027-01'.
 */
function nextMonthString(month: string): string {
  const [yyyy, mm] = month.split("-").map(Number);
  const nextDate = new Date(Date.UTC(yyyy, mm, 1)); // mm is already 1-based -> +1
  const nextYyyy = nextDate.getUTCFullYear();
  const nextMm = String(nextDate.getUTCMonth() + 1).padStart(2, "0");
  return `${nextYyyy}-${nextMm}`;
}

// ---------------------------------------------------------------------------
// Minimum count guard for promotion / relegation
// ---------------------------------------------------------------------------

const MIN_TIER_SIZE_FOR_MOVEMENT = 5;

// ---------------------------------------------------------------------------
// Core processing function
// ---------------------------------------------------------------------------

export async function processLeagueMonthEnd(
  month: string
): Promise<ProcessLeagueMonthEndResult> {
  // Idempotency check: if any entry for this month already has promoted or
  // relegated set to true, the processing has already run.
  const alreadyProcessedEntry = await prisma.monthlyLeagueEntry.findFirst({
    where: {
      month,
      OR: [{ promoted: true }, { relegated: true }],
    },
    select: { id: true },
  });

  if (alreadyProcessedEntry) {
    return { alreadyProcessed: true };
  }

  const nextMonth = nextMonthString(month);

  let totalProcessed = 0;
  let totalPromoted = 0;
  let totalRelegated = 0;

  await prisma.$transaction(
    async (tx) => {
      for (const tier of TIER_ORDER) {
        // Fetch all entries for this tier+month ordered by score desc
        const entries = await tx.monthlyLeagueEntry.findMany({
          where: { month, tier },
          orderBy: { netPointsMonth: "desc" },
          select: { id: true, userId: true, netPointsMonth: true },
        });

        if (entries.length === 0) continue;

        const count = entries.length;
        const applyMovement = count >= MIN_TIER_SIZE_FOR_MOVEMENT;

        // Assign finalRank (1 = best)
        const rankUpdates = entries.map((entry, index) => ({
          id: entry.id,
          rank: index + 1,
        }));

        // Compute promotion / relegation thresholds
        const promotionCount = applyMovement
          ? Math.max(1, Math.floor(count * 0.2))
          : 0;
        const relegationCount =
          applyMovement && tier !== "BRONZE"
            ? Math.max(1, Math.floor(count * 0.2))
            : 0;

        const promotedIds = new Set(
          tier !== "DIAMOND"
            ? entries.slice(0, promotionCount).map((e) => e.userId)
            : []
        );
        const relegatedIds = new Set(
          tier !== "BRONZE"
            ? entries.slice(count - relegationCount).map((e) => e.userId)
            : []
        );
        // Safety: a user can't be in both sets (only possible if count < 2, edge-case guard)
        for (const uid of promotedIds) {
          relegatedIds.delete(uid);
        }

        // Apply finalRank, promoted, relegated to closing-month entries
        for (const { id, rank } of rankUpdates) {
          const userId = entries[rank - 1].userId;
          await tx.monthlyLeagueEntry.update({
            where: { id },
            data: {
              finalRank: rank,
              promoted: promotedIds.has(userId),
              relegated: relegatedIds.has(userId),
            },
          });
        }

        // Build next-month entries
        const promotionNotifData: Array<{
          userId: string;
          newTier: LeagueTier;
        }> = [];
        const relegationNotifData: Array<{
          userId: string;
          newTier: LeagueTier;
        }> = [];

        for (const entry of entries) {
          const isPromoted = promotedIds.has(entry.userId);
          const isRelegated = relegatedIds.has(entry.userId);

          const newTier: LeagueTier = isPromoted
            ? tierAbove(tier)
            : isRelegated
              ? tierBelow(tier)
              : tier;

          // Upsert next-month entry (idempotent if somehow already exists)
          await tx.monthlyLeagueEntry.upsert({
            where: {
              userId_month: { userId: entry.userId, month: nextMonth },
            },
            create: {
              userId: entry.userId,
              month: nextMonth,
              tier: newTier,
              startingTier: newTier,
              netPointsMonth: 0,
            },
            update: {
              tier: newTier,
              startingTier: newTier,
            },
          });

          // Update User.currentLeagueTier
          await tx.user.update({
            where: { id: entry.userId },
            data: { currentLeagueTier: newTier },
          });

          if (isPromoted) {
            promotionNotifData.push({ userId: entry.userId, newTier });
            totalPromoted += 1;
          } else if (isRelegated) {
            relegationNotifData.push({ userId: entry.userId, newTier });
            totalRelegated += 1;
          }
        }

        totalProcessed += count;

        // LEVEL_UP notifications for promoted users
        if (promotionNotifData.length > 0) {
          await tx.notification.createMany({
            data: promotionNotifData.map(({ userId, newTier }) => ({
              userId,
              type: "LEVEL_UP" as const,
              title: `Promoted to ${newTier.charAt(0) + newTier.slice(1).toLowerCase()}!`,
              body: `You finished in the top 20% of your league. Welcome to ${newTier.charAt(0) + newTier.slice(1).toLowerCase()} tier!`,
              href: "/leagues",
            })),
          });
        }

        // SYSTEM notifications for relegated users
        if (relegationNotifData.length > 0) {
          await tx.notification.createMany({
            data: relegationNotifData.map(({ userId, newTier }) => ({
              userId,
              type: "SYSTEM" as const,
              title: `Relegated to ${newTier.charAt(0) + newTier.slice(1).toLowerCase()}`,
              body: `You finished in the bottom 20% of your league. Earn more points next month to climb back up!`,
              href: "/leagues",
            })),
          });
        }
      }
    },
    { timeout: 60000 } // month-end may process many rows; allow 60s
  );

  return {
    month,
    processed: totalProcessed,
    promoted: totalPromoted,
    relegated: totalRelegated,
  };
}

// ---------------------------------------------------------------------------
// Standings query (paginated, used by GET /api/leagues/standings)
// ---------------------------------------------------------------------------

export type LeagueStandingsEntry = {
  rank: number | null;
  userId: string;
  username: string;
  netPointsMonth: number;
};

export type LeagueStandingsPage = {
  tier: LeagueTier;
  month: string;
  entries: LeagueStandingsEntry[];
  nextCursor: string | null;
};

const STANDINGS_PAGE_SIZE = 20;

export async function getLeagueStandings(params: {
  tier: LeagueTier;
  month: string;
  cursor?: string;
}): Promise<LeagueStandingsPage> {
  const { tier, month, cursor } = params;

  const rows = await prisma.monthlyLeagueEntry.findMany({
    where: {
      month,
      tier,
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    orderBy: [{ netPointsMonth: "desc" }, { id: "asc" }],
    take: STANDINGS_PAGE_SIZE + 1,
    include: {
      user: { select: { username: true } },
    },
  });

  const hasMore = rows.length > STANDINGS_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, STANDINGS_PAGE_SIZE) : rows;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  return {
    tier,
    month,
    entries: page.map((row) => ({
      rank: row.finalRank,
      userId: row.userId,
      username: row.user.username,
      netPointsMonth: row.netPointsMonth,
    })),
    nextCursor,
  };
}
