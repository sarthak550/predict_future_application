/**
 * One-time historical backfill for shadow portfolios (P3.3).
 *
 * Generates one SHADOW Portfolio per Expert with >=1 fully eligible graded
 * BULLISH call (see packages/business-rules/src/portfolios/shadow.ts for the
 * exact eligibility/simulation rules), backfilling whatever historical
 * StockEodQuote sessions are needed along the way. All the actual work
 * happens in apps/api/lib/portfolios/shadowGenerator.ts — this script is just
 * the CLI entrypoint + a per-expert summary printout.
 *
 * Usage (from apps/api):
 *   npx tsx scripts/backfill-shadow-portfolios.ts                        # dry run (default) — no writes
 *   npx tsx scripts/backfill-shadow-portfolios.ts --dry-run              # same, explicit
 *   npx tsx scripts/backfill-shadow-portfolios.ts --live                 # apply — writes quotes/portfolios/transactions
 *   npx tsx scripts/backfill-shadow-portfolios.ts --expert=<slug>        # limit to one expert (works with either mode)
 *   npx tsx scripts/backfill-shadow-portfolios.ts --live --expert=<slug>
 *
 * Safe to re-run: fully idempotent (see shadowGenerator.ts's Idempotency
 * doc) — a second --live run with nothing new to backfill writes zero rows.
 *
 * IMPORTANT: --dry-run still performs real (read-only) bhavcopy fetches
 * against NSE's public archives so it can preview a realistic plan — it does
 * NOT skip the network, only the database writes. Expect a dry run over the
 * full expert set to take roughly as long as the live run (same network
 * fetches), just without persisting anything.
 */

import { runShadowGeneration } from "../lib/portfolios/shadowGenerator";
import { prisma } from "../lib/prisma";

function parseArgs() {
  const args = process.argv.slice(2);
  const live = args.includes("--live");
  const dryRun = !live; // default true unless --live is explicitly passed
  const expertArg = args.find((a) => a.startsWith("--expert="));
  const expertSlug = expertArg ? expertArg.slice("--expert=".length) : undefined;
  return { dryRun, expertSlug };
}

async function main() {
  const { dryRun, expertSlug } = parseArgs();

  console.log(
    `[backfill-shadow-portfolios] Starting ${dryRun ? "DRY RUN (no writes; bhavcopy fetches still happen)" : "LIVE RUN"}` +
      `${expertSlug ? ` — limited to expert slug "${expertSlug}"` : " — all experts"}...`
  );

  const result = await runShadowGeneration({ dryRun, expertSlug });

  console.log("\n─── Per-expert summary ───────────────────────────────────────────");
  for (const e of result.perExpert) {
    console.log(
      `${e.expertName}${e.expertSlug ? ` (${e.expertSlug})` : ""}: ` +
        `${e.staticallyEligibleCallCount} statically-eligible call(s) -> ${e.plannedTransactionCount} planned txn(s) ` +
        `[${e.transactionsWritten} to write, ${e.transactionsAlreadyPresent} already present] ` +
        `portfolio=${e.portfolioAction}${e.portfolioSlug ? ` (${e.portfolioSlug})` : ""}`
    );
    for (const skip of e.skippedCalls) {
      console.log(`    skipped opinion=${skip.opinionId}: ${skip.reason}`);
    }
  }

  if (result.errors.length > 0) {
    console.log("\n─── Errors ────────────────────────────────────────────────────────");
    for (const err of result.errors) {
      console.log(`  expert=${err.expertName || "(lookup failed)"} (${err.expertId}): ${err.message}`);
    }
  }

  console.log("\n─── Totals ────────────────────────────────────────────────────────");
  console.log(`Mode:                          ${result.dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Experts scanned:               ${result.expertsScanned}`);
  console.log(`Experts w/ eligible call(s):   ${result.expertsWithStaticallyEligibleCalls}`);
  console.log(`Experts w/ a portfolio:        ${result.expertsWithPortfolios}`);
  console.log(`Portfolios created:            ${result.portfoliosCreated}${result.dryRun ? " (would create)" : ""}`);
  console.log(`Sessions fetched (network):    ${result.sessionsFetched}`);
  console.log(`Sessions with data:            ${result.sessionsWithData}`);
  console.log(`Quote rows inserted:           ${result.quoteRowsInserted}${result.dryRun ? " (would insert)" : ""}`);
  console.log(`Session-fetch budget exhausted: ${result.sessionFetchBudgetExhausted}`);
  console.log(`Transactions written:          ${result.transactionsWritten}${result.dryRun ? " (would write)" : ""}`);
  console.log(`Transactions already present:  ${result.transactionsAlreadyPresent}`);
  console.log(`Calls skipped (no quote/cash): ${result.transactionsSkipped}`);
  console.log(`Errors:                        ${result.errors.length}`);

  if (result.sessionFetchBudgetExhausted) {
    console.log(
      "\nNOTE: the per-run session-fetch budget was exhausted before every needed session could be " +
        "fetched. Re-run this script again (same command) to continue — already-fetched sessions are " +
        "cached in StockEodQuote and won't be re-fetched, so subsequent runs make forward progress."
    );
  }

  if (result.errors.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("[backfill-shadow-portfolios] Fatal error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
