/**
 * POST /api/admin/rbi/mpc-pack/[clusterId]/resolve
 *
 * Admin-only endpoint to resolve both markets in an RBI MPC poll-pack atomically.
 *
 * For each market the handler:
 *   1. Validates that the supplied winning option belongs to that market.
 *   2. Writes `winningOptionId`, marks `status = RESOLVED`, `outcome = YES`,
 *      `resolutionStatus = FINALIZED` — exactly as the existing
 *      /api/markets/[marketId]/resolve-multi-choice route does.
 *   3. Calls the existing `settleMultiChoiceMarket()` to award points/accuracy.
 *   4. Idempotent: if a market in the pack is already resolved, it is skipped.
 *
 * Request body:
 * {
 *   repoWinningOptionId:   string,   // winning MarketOption.id for the Repo Rate market
 *   stanceWinningOptionId: string,   // winning MarketOption.id for the Stance market
 * }
 *
 * The caller must know which optionId to supply. The T0 create endpoint returns
 * the option ids in the pack response, and the client can also fetch them via
 * GET /api/markets/[marketId].
 *
 * Response 200: { ok: true, settled: string[] }   // array of resolved marketIds
 */

import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { settleMultiChoiceMarket } from "@/lib/markets/payouts";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Auth helper (same pattern as other admin routes)
// ---------------------------------------------------------------------------

async function requireAdmin(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return {
      actor: null,
      error: NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      ),
    };
  }

  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isSuspended: true },
  });

  if (!actor || actor.isSuspended) {
    return {
      actor: null,
      error: NextResponse.json(
        { error: "Account cannot perform this action." },
        { status: 403 }
      ),
    };
  }

  if (actor.role !== "ADMIN" && actor.role !== "MODERATOR") {
    return {
      actor: null,
      error: NextResponse.json(
        { error: "Admin access required." },
        { status: 403 }
      ),
    };
  }

  return { actor, error: null };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

interface ResolvePackBody {
  repoWinningOptionId?: unknown;
  stanceWinningOptionId?: unknown;
}

export async function POST(
  request: Request,
  { params }: { params: { clusterId: string } }
) {
  const { actor, error } = await requireAdmin(request);
  if (error) return error;

  const { clusterId } = params;

  // ---- Validate body -------------------------------------------------------

  let body: ResolvePackBody;
  try {
    body = (await request.json()) as ResolvePackBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    typeof body.repoWinningOptionId !== "string" ||
    !body.repoWinningOptionId.trim()
  ) {
    return NextResponse.json(
      { error: "repoWinningOptionId is required." },
      { status: 400 }
    );
  }
  if (
    typeof body.stanceWinningOptionId !== "string" ||
    !body.stanceWinningOptionId.trim()
  ) {
    return NextResponse.json(
      { error: "stanceWinningOptionId is required." },
      { status: 400 }
    );
  }

  const repoWinningOptionId = body.repoWinningOptionId.trim();
  const stanceWinningOptionId = body.stanceWinningOptionId.trim();

  // ---- Load the cluster's RBI MULTIPLE_CHOICE markets ----------------------

  const cluster = await prisma.marketEventCluster.findUnique({
    where: { id: clusterId },
    select: { id: true, name: true },
  });

  if (!cluster) {
    return NextResponse.json(
      { error: "Event cluster not found." },
      { status: 404 }
    );
  }

  const markets = await prisma.market.findMany({
    where: {
      eventClusterId: clusterId,
      flagshipEventType: "RBI",
      marketType: "MULTIPLE_CHOICE",
    },
    select: {
      id: true,
      title: true,
      status: true,
      marketType: true,
      winningOptionId: true,
      options: { select: { id: true, marketId: true } },
    },
  });

  if (markets.length !== 2) {
    return NextResponse.json(
      {
        error: `Expected exactly 2 RBI MULTIPLE_CHOICE markets in cluster, found ${markets.length}.`,
      },
      { status: 422 }
    );
  }

  // ---- Validate that each winning option belongs to the correct market ------

  // Map optionId → its owning market (across both markets in the pack).
  const optionToMarket = new Map<string, (typeof markets)[number]>();
  for (const market of markets) {
    for (const opt of market.options) {
      optionToMarket.set(opt.id, market);
    }
  }

  const repoMarketForOption = optionToMarket.get(repoWinningOptionId);
  const stanceMarketForOption = optionToMarket.get(stanceWinningOptionId);

  if (!repoMarketForOption) {
    return NextResponse.json(
      {
        error: `repoWinningOptionId "${repoWinningOptionId}" does not belong to any market in this cluster.`,
      },
      { status: 400 }
    );
  }
  if (!stanceMarketForOption) {
    return NextResponse.json(
      {
        error: `stanceWinningOptionId "${stanceWinningOptionId}" does not belong to any market in this cluster.`,
      },
      { status: 400 }
    );
  }
  if (repoMarketForOption.id === stanceMarketForOption.id) {
    return NextResponse.json(
      {
        error:
          "repoWinningOptionId and stanceWinningOptionId must belong to different markets.",
      },
      { status: 400 }
    );
  }

  // Build the resolution map: marketId → winningOptionId.
  const resolutionMap: Array<{
    market: (typeof markets)[number];
    winningOptionId: string;
  }> = [
    { market: repoMarketForOption, winningOptionId: repoWinningOptionId },
    { market: stanceMarketForOption, winningOptionId: stanceWinningOptionId },
  ];

  // ---- Validate each market is resolvable ----------------------------------

  for (const { market } of resolutionMap) {
    if (!["OPEN", "CLOSED", "AWAITING_RESOLUTION"].includes(market.status)) {
      if (market.winningOptionId) {
        // Already resolved — idempotent: this is fine, we'll skip it below.
        continue;
      }
      return NextResponse.json(
        {
          error: `Market "${market.title}" is in status "${market.status}" and cannot be resolved.`,
        },
        { status: 409 }
      );
    }
  }

  // ---- Resolve each market (idempotent per market) -------------------------

  const settled: string[] = [];

  for (const { market, winningOptionId } of resolutionMap) {
    // Idempotency guard: skip if already resolved.
    if (market.winningOptionId) {
      continue;
    }

    await prisma.$transaction(async (tx) => {
      // Mirror the exact update shape from /api/markets/[marketId]/resolve-multi-choice.
      await tx.market.update({
        where: { id: market.id },
        data: {
          status: "RESOLVED",
          outcome: "YES", // sentinel — actual outcome tracked via winningOptionId
          winningOptionId,
          resolutionStatus: "FINALIZED",
          finalizationAt: new Date(),
          resolutionFinalizedById: actor!.id,
        },
      });

      // Mark the winning option.
      await tx.marketOption.update({
        where: { id: winningOptionId },
        data: { isWinner: true },
      });

      // Create/upsert the resolution record.
      await tx.marketResolution.upsert({
        where: { marketId: market.id },
        update: {
          outcome: "YES",
          sourceName: "Admin resolution",
          explanation: `RBI MPC pack resolved by ${actor!.role.toLowerCase()}.`,
          resolvedAt: new Date(),
          resolvedById: actor!.id,
        },
        create: {
          marketId: market.id,
          outcome: "YES",
          sourceName: "Admin resolution",
          explanation: `RBI MPC pack resolved by ${actor!.role.toLowerCase()}.`,
          resolvedAt: new Date(),
          resolvedById: actor!.id,
        },
      });

      // Settle positions using the existing shared helper.
      await settleMultiChoiceMarket(tx, market.id);
    });

    settled.push(market.id);
  }

  return NextResponse.json({ ok: true, settled });
}
