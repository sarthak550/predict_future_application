/**
 * POST /api/cron/paper-trading-premium-snapshot-prune
 *
 * Trading Terminal UI Overhaul (Sprint A, T3) — deletes OptionPremiumSnapshot
 * rows older than 45 days. Kept as its OWN cron file rather than folded into
 * the capture cron, per this codebase's established one-mechanism-per-cron
 * convention (see the Phase 3 brief's cron-timing section, and every other
 * settle/prune pair in this domain — e.g. paper-trading-squareoff vs.
 * paper-trading-options-expiry are separate files despite both being
 * "closing leg" crons).
 *
 * Recommended cadence — once nightly, at a low-traffic hour:
 *   0 14 * * * curl -s -X POST https://<host>/api/cron/paper-trading-premium-snapshot-prune \
 *       -H "Authorization: Bearer $CRON_SECRET"
 * (14:00 UTC = 19:30 IST)
 *
 * Never throws: the delete is wrapped and any failure is reported in the JSON
 * response body instead of a 500, matching every other cron route's contract.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

const RETENTION_DAYS = 45;

function hasCronAccess(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

async function run(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deleted = await prisma.optionPremiumSnapshot.deleteMany({ where: { capturedAt: { lt: cutoff } } });
    return NextResponse.json({ ok: true, deletedCount: deleted.count, cutoff: cutoff.toISOString() });
  } catch (err) {
    console.error("[cron/paper-trading-premium-snapshot-prune] unexpected failure:", err);
    return NextResponse.json({ ok: false, error: "Unexpected failure." }, { status: 200 });
  }
}

export const GET = run;
export const POST = run;
