import { NextRequest, NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { updateAnalystTiersBatch } from "@/lib/analysts";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/users/recalc-tiers
 *
 * Recomputes and persists AnalystTier for every user in the database.
 * Intended to be run once on deploy when the tier gate changes (e.g. from
 * accuracy-based to net-PnL-based thresholds).
 *
 * Auth: CRON_SECRET query param OR authenticated ADMIN user.
 * Idempotent: safe to call multiple times — tiers simply settle to the
 * correct value each run.
 *
 * Batches in pages of BATCH_SIZE to avoid loading the entire user table
 * into memory at once.
 *
 * Response: { updated: number, total: number, batches: number }
 */

const BATCH_SIZE = 200;

export async function POST(req: NextRequest) {
  // ── Auth: CRON_SECRET query param (for cron/deploy triggers) ──
  // Guard against a misconfigured/empty CRON_SECRET: an unset or empty env var
  // must NEVER grant access — always fall through to admin-session auth in that case.
  const secret = req.nextUrl.searchParams.get("secret");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || secret !== cronSecret) {
    // Fall back to admin session auth.
    const requestUserId = await getUserIdFromRequest(req);
    if (!requestUserId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const actor = await prisma.user.findUnique({
      where: { id: requestUserId },
      select: { role: true, isSuspended: true },
    });
    if (!actor || actor.isSuspended) {
      return NextResponse.json({ error: "Account cannot perform this action." }, { status: 403 });
    }
    if (actor.role !== "ADMIN") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }
  }

  let cursor: string | undefined = undefined;
  let totalUpdated = 0;
  let total = 0;
  let batches = 0;

  // Paginate through all users with a cursor to keep memory flat.
  while (true) {
    const queryArgs = {
      take: BATCH_SIZE,
      select: { id: true },
      orderBy: { id: "asc" as const },
      ...(cursor ? { skip: 1 as const, cursor: { id: cursor } } : {}),
    };
    const users: Array<{ id: string }> = await prisma.user.findMany(queryArgs);

    if (users.length === 0) break;

    const ids = users.map((u) => u.id);
    const updated = await updateAnalystTiersBatch(ids);

    totalUpdated += updated;
    total += ids.length;
    batches++;
    cursor = users[users.length - 1].id;

    if (users.length < BATCH_SIZE) break;
  }

  console.info(
    `[recalc-tiers] Completed — batches=${batches} total=${total} updated=${totalUpdated}`
  );

  return NextResponse.json({ updated: totalUpdated, total, batches });
}
