/**
 * Sprint 72 seed — writes the first MacroSnapshot row so the India Macro panel
 * is not empty before the first daily cron fires.
 *
 * Run this ONCE against prod after the schema push (`prisma db push`):
 *   cd apps/api && npx tsx scripts/seed_macro_snapshot.ts
 *
 * Idempotent: uses the same upsert-singleton pattern as the cron. Safe to re-run.
 * Keep-last-known-good: only sets fields for which a valid value was fetched.
 */

import { fetchRbiPolicyRates } from "../lib/finance/rbiRates";
import { fetchImfMacro } from "../lib/finance/imfMacro";
import { prisma } from "../lib/prisma";

async function main() {
  console.log("[seed_macro_snapshot] Fetching RBI rates + IMF macro...");

  const [rbiRates, imfMacro] = await Promise.all([
    fetchRbiPolicyRates(),
    fetchImfMacro(),
  ]);

  if (rbiRates) {
    console.log(
      `[seed_macro_snapshot] RBI: Repo=${rbiRates.policyRepoRate}% CRR=${rbiRates.cashReserveRatio}% SLR=${rbiRates.statutoryLiquidityRatio}%`
    );
  } else {
    console.warn("[seed_macro_snapshot] RBI fetch failed — RBI fields will remain null");
  }

  if (imfMacro) {
    console.log(
      `[seed_macro_snapshot] IMF: GDP=${imfMacro.gdpGrowth}% (${imfMacro.gdpGrowthYear}) CPI=${imfMacro.cpiInflation}% (${imfMacro.cpiInflationYear})`
    );
  } else {
    console.warn("[seed_macro_snapshot] IMF fetch failed — IMF fields will remain null");
  }

  if (!rbiRates && !imfMacro) {
    console.error("[seed_macro_snapshot] Both sources failed. Nothing written.");
    process.exit(1);
  }

  // Build upsert payload with keep-last-known-good: only include fields where
  // the fetch returned a valid value.
  const payload: Record<string, unknown> = {};

  if (rbiRates) {
    if (rbiRates.policyRepoRate !== null)             payload.repoRate    = rbiRates.policyRepoRate;
    if (rbiRates.cashReserveRatio !== null)            payload.crr         = rbiRates.cashReserveRatio;
    if (rbiRates.statutoryLiquidityRatio !== null)     payload.slr         = rbiRates.statutoryLiquidityRatio;
    if (rbiRates.standingDepositFacilityRate !== null) payload.sdf         = rbiRates.standingDepositFacilityRate;
    if (rbiRates.marginalStandingFacilityRate !== null) payload.msf        = rbiRates.marginalStandingFacilityRate;
    if (rbiRates.bankRate !== null)                    payload.bankRate    = rbiRates.bankRate;
    payload.rbiFetchedAt = new Date(rbiRates.fetchedAt);
  }

  if (imfMacro) {
    if (imfMacro.gdpGrowth !== null)       payload.gdpGrowth      = imfMacro.gdpGrowth;
    if (imfMacro.gdpGrowthYear !== null)   payload.gdpGrowthYear  = imfMacro.gdpGrowthYear;
    if (imfMacro.cpiInflation !== null)    payload.cpiInflation   = imfMacro.cpiInflation;
    if (imfMacro.cpiInflationYear !== null) payload.cpiInflationYear = imfMacro.cpiInflationYear;
    payload.imfFetchedAt = new Date(imfMacro.fetchedAt);
  }

  await prisma.macroSnapshot.upsert({
    where: { key: "singleton" },
    update: payload,
    create: { key: "singleton", ...payload },
  });

  console.log("[seed_macro_snapshot] MacroSnapshot upserted successfully.");
}

main()
  .catch((err) => {
    console.error("[seed_macro_snapshot] Fatal error:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
