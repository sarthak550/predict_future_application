/**
 * reset-markets.ts
 *
 * One-shot operational script that clears the entire market backlog ahead of the
 * long-dated Manifold reseed (see import-manifold-markets.ts --open-only). It:
 *
 *   1. Backs up Market + every directly-dependent table (MarketPosition, MarketOption,
 *      Vote, MarketComment, MarketResolution, MultiChoicePosition,
 *      MarketProbabilitySnapshot, MarketReport) to a single timestamped JSON file.
 *      The run ABORTS with no further writes if the backup can't be written and
 *      read back successfully.
 *   2. Refunds every MarketPosition with settledAt IS NULL — including any sitting
 *      on an already-RESOLVED market that was never settled — by crediting the
 *      position owner's wallet and recording a MARKET_REFUND WalletTransaction.
 *      Idempotent: re-running skips any position that already has a MARKET_REFUND
 *      row (checked via the WalletTransaction @@unique([walletId, marketId, type,
 *      positionId]) constraint), so a crash mid-run is safe to resume.
 *   3. Deletes every Market row. Market's children all have onDelete: Cascade
 *      (positions, votes, comments, options, probabilitySnapshots, reports,
 *      resolution, multiChoicePositions — see prisma/schema.prisma), so this alone
 *      clears the whole backlog.
 *
 * SAFETY: this script is dry-run-safe BY DEFAULT. It only ever writes to the
 * database when invoked with the explicit --live flag. Every other invocation
 * (no flags, or --dry-run) only reads and prints counts.
 *
 * Run-once guard: if Market.count() === 0 when the script starts, it no-ops
 * immediately (nothing to reset) — safe to invoke twice in a row.
 *
 * Usage (run from apps/api):
 *   npx tsx scripts/reset-markets.ts                 # DRY RUN (default) — prints counts only
 *   npx tsx scripts/reset-markets.ts --dry-run        # same, explicit
 *   npx tsx scripts/reset-markets.ts --live           # backs up, refunds, deletes for real
 */

import fs from "fs/promises";
import path from "path";

import { prisma } from "../lib/prisma";

const BACKUP_DIR = path.join(__dirname, "..", "backups");
const REFUND_DESCRIPTION = "Market reset: automatic refund of open stake ahead of backlog reseed.";
const REFUND_BATCH_SIZE = 200;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { live: boolean } {
  const args = process.argv.slice(2);
  // Dry-run-safe by default: only --live performs writes. --dry-run is accepted as
  // an explicit no-op alias for self-documenting invocations.
  const live = args.includes("--live");
  return { live };
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

type BackupCounts = Record<string, number>;

async function countAllTables(): Promise<BackupCounts> {
  const [markets, positions, options, votes, comments, resolutions, multiChoicePositions, probabilitySnapshots, reports] =
    await Promise.all([
      prisma.market.count(),
      prisma.marketPosition.count(),
      prisma.marketOption.count(),
      prisma.vote.count(),
      prisma.marketComment.count(),
      prisma.marketResolution.count(),
      prisma.multiChoicePosition.count(),
      prisma.marketProbabilitySnapshot.count(),
      prisma.marketReport.count(),
    ]);

  return {
    Market: markets,
    MarketPosition: positions,
    MarketOption: options,
    Vote: votes,
    MarketComment: comments,
    MarketResolution: resolutions,
    MultiChoicePosition: multiChoicePositions,
    MarketProbabilitySnapshot: probabilitySnapshots,
    MarketReport: reports,
  };
}

function previewBackupPath(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(BACKUP_DIR, `market-reset-${timestamp}.json`);
}

/**
 * Dumps every row of Market + its 8 dependent tables to a single JSON file and
 * verifies the file round-trips (parses back with matching row counts) before
 * returning. Throws (aborting the whole run — see main()) if anything about the
 * backup can't be trusted.
 */
async function backupTables(): Promise<{ filePath: string; counts: BackupCounts }> {
  console.log("Backing up all market-related tables...");

  const [markets, positions, options, votes, comments, resolutions, multiChoicePositions, probabilitySnapshots, reports] =
    await Promise.all([
      prisma.market.findMany({}),
      prisma.marketPosition.findMany({}),
      prisma.marketOption.findMany({}),
      prisma.vote.findMany({}),
      prisma.marketComment.findMany({}),
      prisma.marketResolution.findMany({}),
      prisma.multiChoicePosition.findMany({}),
      prisma.marketProbabilitySnapshot.findMany({}),
      prisma.marketReport.findMany({}),
    ]);

  const counts: BackupCounts = {
    Market: markets.length,
    MarketPosition: positions.length,
    MarketOption: options.length,
    Vote: votes.length,
    MarketComment: comments.length,
    MarketResolution: resolutions.length,
    MultiChoicePosition: multiChoicePositions.length,
    MarketProbabilitySnapshot: probabilitySnapshots.length,
    MarketReport: reports.length,
  };

  const filePath = previewBackupPath();

  await fs.mkdir(BACKUP_DIR, { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify(
      {
        backedUpAt: new Date().toISOString(),
        counts,
        tables: {
          Market: markets,
          MarketPosition: positions,
          MarketOption: options,
          Vote: votes,
          MarketComment: comments,
          MarketResolution: resolutions,
          MultiChoicePosition: multiChoicePositions,
          MarketProbabilitySnapshot: probabilitySnapshots,
          MarketReport: reports,
        },
      },
      null,
      2
    ),
    "utf8"
  );

  // Verify: read the file back and confirm row counts match what we just wrote.
  // If this fails for any reason (disk full, truncated write, permissions), abort
  // before touching any wallet balances or deleting a single market.
  let verifiedCounts: BackupCounts;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { counts: BackupCounts };
    verifiedCounts = parsed.counts;
  } catch (err) {
    throw new Error(`Backup verification read/parse failed: ${(err as Error).message}`);
  }

  for (const [table, expected] of Object.entries(counts)) {
    if (verifiedCounts[table] !== expected) {
      throw new Error(
        `Backup verification failed: ${table} count mismatch (wrote ${expected}, read back ${verifiedCounts[table]}).`
      );
    }
  }

  console.log(`  Backup written and verified: ${filePath}`);
  return { filePath, counts };
}

// ---------------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------------

interface RefundSummary {
  refunded: number;
  alreadyRefunded: number;
  skippedNoWallet: number;
  totalAmount: number;
}

/**
 * Refunds every MarketPosition with settledAt IS NULL. In dry-run mode this only
 * reads and tallies — no wallet or WalletTransaction writes occur.
 */
async function refundUnsettledPositions(dryRun: boolean): Promise<RefundSummary> {
  const summary: RefundSummary = { refunded: 0, alreadyRefunded: 0, skippedNoWallet: 0, totalAmount: 0 };

  let cursor: string | undefined;

  while (true) {
    const batch = await prisma.marketPosition.findMany({
      where: { settledAt: null },
      take: REFUND_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      select: { id: true, marketId: true, userId: true, amount: true },
    });

    if (batch.length === 0) break;

    for (const position of batch) {
      summary.totalAmount += position.amount;

      if (dryRun) continue;

      const wallet = await prisma.wallet.findUnique({
        where: { userId: position.userId },
        select: { id: true },
      });

      if (!wallet) {
        console.error(`  [refund] SKIP position ${position.id}: user ${position.userId} has no wallet.`);
        summary.skippedNoWallet++;
        continue;
      }

      // Idempotency check — same pattern as createUniqueWalletTransaction in
      // lib/markets/payouts.ts. Safe to re-run this script after a crash.
      const existingRefund = await prisma.walletTransaction.findFirst({
        where: {
          walletId: wallet.id,
          marketId: position.marketId,
          type: "MARKET_REFUND",
          positionId: position.id,
        },
        select: { id: true },
      });

      if (existingRefund) {
        summary.alreadyRefunded++;
        continue;
      }

      await prisma.$transaction([
        prisma.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: position.amount } },
        }),
        prisma.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "MARKET_REFUND",
            amount: position.amount,
            marketId: position.marketId,
            positionId: position.id,
            description: REFUND_DESCRIPTION,
          },
        }),
      ]);

      summary.refunded++;
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < REFUND_BATCH_SIZE) break;
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { live } = parseArgs();
  const dryRun = !live;

  console.log("=== Market Reset (backup + refund + wipe) ===");
  console.log(`  mode: ${dryRun ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log("");

  // Run-once guard.
  const marketCount = await prisma.market.count();
  if (marketCount === 0) {
    console.log("No-op: Market.count() === 0 — nothing to reset. Safe to stop here.");
    return;
  }

  // Pre-flight counts, always computed (cheap — count() not findMany()).
  const [tableCounts, unsettledCount, unsettledOnResolvedCount, unsettledSum] = await Promise.all([
    countAllTables(),
    prisma.marketPosition.count({ where: { settledAt: null } }),
    prisma.marketPosition.count({ where: { settledAt: null, market: { status: "RESOLVED" } } }),
    prisma.marketPosition.aggregate({ where: { settledAt: null }, _sum: { amount: true } }),
  ]);
  const unsettledTotalAmount = unsettledSum._sum.amount ?? 0;

  console.log("Pre-flight counts:");
  for (const [table, count] of Object.entries(tableCounts)) {
    console.log(`  ${table.padEnd(28)} ${count}`);
  }
  console.log("");
  console.log(`  Positions to refund (settledAt IS NULL):              ${unsettledCount}`);
  console.log(`    ...of which on an already-RESOLVED market:          ${unsettledOnResolvedCount}`);
  console.log(`  Total points to refund:                               ${unsettledTotalAmount}`);
  console.log(`  Markets to delete:                                    ${tableCounts.Market}`);
  console.log("");

  if (dryRun) {
    console.log(`Backup target (not written in dry run): ${previewBackupPath()}`);
    console.log("");
    console.log("DRY RUN complete — no data was modified. Re-run with --live to execute.");
    return;
  }

  // ---- LIVE ----

  // 1. Backup. Abort the entire run if this fails or can't be verified.
  await backupTables();

  // 2. Refund every unsettled position.
  console.log("");
  console.log("Refunding unsettled positions...");
  const refundSummary = await refundUnsettledPositions(false);
  console.log(`  Refunded:        ${refundSummary.refunded}`);
  console.log(`  Already refunded (idempotent skip): ${refundSummary.alreadyRefunded}`);
  console.log(`  Skipped (no wallet): ${refundSummary.skippedNoWallet}`);
  console.log(`  Total points credited: ${refundSummary.totalAmount}`);

  if (refundSummary.skippedNoWallet > 0) {
    console.error(
      `  WARNING: ${refundSummary.skippedNoWallet} position(s) belonged to users with no wallet row — investigate before re-running.`
    );
  }

  // 3. Delete all markets. Cascades handle every dependent table.
  console.log("");
  console.log("Deleting all markets (cascades to positions/options/votes/comments/resolutions/etc.)...");
  const { count: deletedCount } = await prisma.market.deleteMany({});
  console.log(`  Deleted: ${deletedCount} markets`);

  // Post-condition check.
  const remaining = await prisma.market.count();
  if (remaining !== 0) {
    throw new Error(`Post-condition failed: Market.count() === ${remaining} after deleteMany, expected 0.`);
  }

  console.log("");
  console.log("Market reset complete. Market.count() === 0.");
}

main()
  .catch((err) => {
    console.error("[reset-markets] Fatal error:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
