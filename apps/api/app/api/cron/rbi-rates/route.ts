/**
 * GET/POST /api/cron/rbi-rates
 *
 * Fetches the current RBI policy rates from the public RBI site and refreshes the
 * `structuredData.currentRates` baseline on every OPEN poll pack (the RBI MPC packs).
 * Run daily — RBI only changes rates on MPC days (~6×/year), so this keeps the
 * prediction baseline current after each meeting without any admin typing.
 *
 * Protected by CRON_SECRET (Bearer or x-cron-secret header), same as other cron routes.
 * Robust: if the fetch/parse fails, it KEEPS the last-known-good rates (never overwrites
 * with null).
 */

import { NextResponse } from "next/server";

import { fetchRbiPolicyRates } from "@/lib/finance/rbiRates";
import { prisma } from "@/lib/prisma";

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

  const rates = await fetchRbiPolicyRates();
  if (!rates) {
    // Keep last-known-good; do not wipe baselines with a bad scrape.
    return NextResponse.json({ ok: false, reason: "rbi_fetch_failed", updated: 0 }, { status: 200 });
  }

  // Refresh the baseline on every OPEN poll pack (Phase 1: these are the RBI packs).
  const openPackPolls = await prisma.poll.findMany({
    where: { status: "OPEN", packId: { not: null } },
    select: { id: true, structuredData: true },
  });

  let updated = 0;
  for (const poll of openPackPolls) {
    const existing = (poll.structuredData as Record<string, unknown> | null) ?? {};
    await prisma.poll.update({
      where: { id: poll.id },
      data: { structuredData: { ...existing, currentRates: rates, ratesAsOf: rates.fetchedAt } },
    });
    updated++;
  }

  return NextResponse.json({ ok: true, repoRate: rates.policyRepoRate, fetchedAt: rates.fetchedAt, updated });
}

export const GET = run;
export const POST = run;
