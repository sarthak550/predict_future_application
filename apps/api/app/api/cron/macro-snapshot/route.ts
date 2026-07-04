/**
 * GET/POST /api/cron/macro-snapshot
 *
 * Fetches the current RBI policy rates + IMF macro projections and upserts
 * them into the `MacroSnapshot` singleton row.
 *
 * Keep-last-known-good strategy: only overwrite a field when the new fetch
 * returned a valid (non-null) value. This means a failed RBI scrape never
 * wipes the last good repo rate, and a failed IMF fetch never wipes GDP.
 *
 * Protected by CRON_SECRET (Bearer or x-cron-secret header), identical to
 * all other cron routes. Designed to run daily via box crontab:
 *   0 6 * * * curl -s -X POST https://<host>/api/cron/macro-snapshot \
 *       -H "Authorization: Bearer $CRON_SECRET"
 *
 * Prod note: run `prisma db push` (not migrate deploy) to land the
 * MacroSnapshot model before activating this cron.
 */

import { NextResponse } from "next/server";

import { fetchRbiPolicyRates } from "@/lib/finance/rbiRates";
import { fetchImfMacro } from "@/lib/finance/imfMacro";
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

  // Fetch both sources concurrently — neither blocks the other.
  const [rbiRates, imfMacro] = await Promise.all([
    fetchRbiPolicyRates(),
    fetchImfMacro(),
  ]);

  // Build the upsert payload: only include a field if the new fetch produced
  // a valid value. Prisma's upsert with partial update lets us skip fields
  // we don't want to touch — but `update` requires explicit fields, so we
  // build the update payload manually.
  const updatePayload: Record<string, unknown> = {};

  if (rbiRates) {
    if (rbiRates.policyRepoRate !== null)          updatePayload.repoRate    = rbiRates.policyRepoRate;
    if (rbiRates.cashReserveRatio !== null)         updatePayload.crr         = rbiRates.cashReserveRatio;
    if (rbiRates.statutoryLiquidityRatio !== null)  updatePayload.slr         = rbiRates.statutoryLiquidityRatio;
    if (rbiRates.standingDepositFacilityRate !== null) updatePayload.sdf      = rbiRates.standingDepositFacilityRate;
    if (rbiRates.marginalStandingFacilityRate !== null) updatePayload.msf     = rbiRates.marginalStandingFacilityRate;
    if (rbiRates.bankRate !== null)                 updatePayload.bankRate    = rbiRates.bankRate;
    updatePayload.rbiFetchedAt = new Date(rbiRates.fetchedAt);
  }

  if (imfMacro) {
    if (imfMacro.gdpGrowth !== null)      updatePayload.gdpGrowth      = imfMacro.gdpGrowth;
    if (imfMacro.gdpGrowthYear !== null)  updatePayload.gdpGrowthYear  = imfMacro.gdpGrowthYear;
    if (imfMacro.cpiInflation !== null)   updatePayload.cpiInflation   = imfMacro.cpiInflation;
    if (imfMacro.cpiInflationYear !== null) updatePayload.cpiInflationYear = imfMacro.cpiInflationYear;
    updatePayload.imfFetchedAt = new Date(imfMacro.fetchedAt);
  }

  if (Object.keys(updatePayload).length === 0) {
    // Both fetches failed — keep the existing row untouched.
    return NextResponse.json(
      { ok: false, reason: "both_sources_failed", rbi: false, imf: false },
      { status: 200 }
    );
  }

  // Upsert singleton row. On create, set all non-null values from the first run.
  // The `create` block uses the same fields as `update` — if a value is absent
  // it stays null in the DB (which is fine; the GET endpoint omits null fields).
  await prisma.macroSnapshot.upsert({
    where: { key: "singleton" },
    update: updatePayload,
    create: { key: "singleton", ...updatePayload },
  });

  return NextResponse.json({
    ok: true,
    rbi: rbiRates !== null,
    imf: imfMacro !== null,
    repoRate: rbiRates?.policyRepoRate ?? null,
    gdpGrowth: imfMacro?.gdpGrowth ?? null,
    gdpGrowthYear: imfMacro?.gdpGrowthYear ?? null,
    cpiInflation: imfMacro?.cpiInflation ?? null,
    cpiInflationYear: imfMacro?.cpiInflationYear ?? null,
  });
}

export const GET = run;
export const POST = run;
