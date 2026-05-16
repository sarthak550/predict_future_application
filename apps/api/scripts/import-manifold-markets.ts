/**
 * import-manifold-markets.ts
 *
 * One-shot script that pages the Manifold Markets public API and imports
 * resolved BINARY markets into predict_future as read-only archived markets.
 *
 * Usage:
 *   cd apps/api
 *   npx tsx scripts/import-manifold-markets.ts [--dry-run] [--limit=500] [--min-traders=30]
 *
 * Flags:
 *   --dry-run        Print what would be imported without writing to the DB.
 *   --limit=N        Max markets to import (default: 500, max: 2000).
 *   --min-traders=N  Minimum uniqueBettorCount (default: 30).
 *
 * Attribution / legal:
 *   Manifold data is CC BY-NC 4.0. Attribution is displayed via the
 *   "Archived · Manifold" badge (originPlatform='manifold') and the
 *   resolutionSourceUrl linking to the canonical market page.
 *   Only question text, resolution outcome, and metadata are imported —
 *   no user identities, bet amounts, or trading history.
 */

import { prisma } from "../lib/prisma";
import {
  MarketCategory,
  MarketOutcome,
  MarketStatus,
  MarketTemplate,
  MarketType,
  MarketVisibility,
  PoolRewardMode,
  ResolutionMode,
  ResolutionSourceType,
  ResolutionStatus,
} from "@prisma/client";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { dryRun: boolean; limit: number; minTraders: number } {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  const limitArg = args.find((a) => a.startsWith("--limit="));
  const rawLimit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 500;
  const limit = Math.max(1, Math.min(2000, isNaN(rawLimit) ? 500 : rawLimit));

  const minTradersArg = args.find((a) => a.startsWith("--min-traders="));
  const rawMinTraders = minTradersArg
    ? parseInt(minTradersArg.split("=")[1], 10)
    : 30;
  const minTraders = Math.max(0, isNaN(rawMinTraders) ? 30 : rawMinTraders);

  return { dryRun, limit, minTraders };
}

// ---------------------------------------------------------------------------
// Manifold API types (only the fields we care about)
// ---------------------------------------------------------------------------

interface ManifoldMarket {
  id: string;
  question: string;
  slug: string;
  creatorUsername: string;
  textDescription?: string;
  isResolved: boolean;
  resolution?: string;
  resolutionTime?: number;
  closeTime?: number;
  mechanism?: string;
  outcomeType?: string;
  uniqueBettorCount?: number;
  groupSlugs?: string[];
}

// ---------------------------------------------------------------------------
// Category mapping
// ---------------------------------------------------------------------------

const NICHE_SKIP_TERMS = [
  "us-specific",
  "personal-",
  "will-i-",
  "will-my-",
  "lesswrong",
  "rationalist",
  "acx",
];

function mapCategory(market: ManifoldMarket): MarketCategory | null {
  const slugs = (market.groupSlugs ?? []).map((s) => s.toLowerCase());
  const titleLower = market.question.toLowerCase();
  const slugLower = market.slug.toLowerCase();

  // Check niche skip terms against slug and title
  for (const term of NICHE_SKIP_TERMS) {
    if (slugLower.includes(term) || titleLower.includes(term)) {
      return null;
    }
  }

  // Category rules — first match wins
  if (slugs.some((s) => s.includes("politics") || s.includes("elections") || s.includes("government"))) {
    return MarketCategory.GENERAL;
  }
  if (
    slugs.some(
      (s) =>
        s.includes("sports") ||
        s.includes("cricket") ||
        s.includes("football") ||
        s.includes("nba") ||
        s.includes("ipl")
    )
  ) {
    return MarketCategory.SPORTS;
  }
  if (
    slugs.some(
      (s) =>
        s.includes("technology") ||
        s.includes("ai") ||
        s.includes("crypto") ||
        s.includes("startups")
    )
  ) {
    return MarketCategory.TECH;
  }
  if (
    slugs.some(
      (s) =>
        s.includes("economics") ||
        s.includes("finance") ||
        s.includes("stocks") ||
        s.includes("markets")
    )
  ) {
    return MarketCategory.FINANCE;
  }
  if (
    slugs.some(
      (s) =>
        s.includes("entertainment") ||
        s.includes("movies") ||
        s.includes("tv") ||
        s.includes("oscars")
    )
  ) {
    return MarketCategory.ENTERTAINMENT;
  }

  // No matching category — skip
  return null;
}

// ---------------------------------------------------------------------------
// Manifold API pagination
// ---------------------------------------------------------------------------

const MANIFOLD_BASE = "https://api.manifold.markets/v0";
const PAGE_SIZE = 1000;
const PAGE_DELAY_MS = 300; // polite delay between pages

async function fetchPage(before?: string): Promise<ManifoldMarket[]> {
  const url = new URL(`${MANIFOLD_BASE}/markets`);
  url.searchParams.set("limit", String(PAGE_SIZE));
  if (before) url.searchParams.set("before", before);

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    throw new Error(`Manifold API error ${resp.status}: ${await resp.text()}`);
  }
  return resp.json() as Promise<ManifoldMarket[]>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Bot user upsert
// ---------------------------------------------------------------------------

async function ensureBotUser(): Promise<string> {
  // bcrypt hash of "ManifoldArchive1!" — pre-computed to avoid bcrypt dep at runtime.
  // The bot user never actually logs in; the password is a placeholder.
  const { default: bcrypt } = await import("bcryptjs");
  const passwordHash = await bcrypt.hash("ManifoldArchive1!", 10);

  const bot = await prisma.user.upsert({
    where: { username: "manifold-archive" },
    create: {
      email: "archive@manifold.internal",
      username: "manifold-archive",
      passwordHash,
      role: "ADMIN",
      wallet: {
        create: {
          balance: 0,
          startingBalance: 0,
        },
      },
      stats: {
        create: {},
      },
    },
    update: {},
    select: { id: true },
  });

  return bot.id;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { dryRun, limit, minTraders } = parseArgs();

  console.log("=== Manifold Markets Import ===");
  console.log(`  mode:        ${dryRun ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`  limit:       ${limit}`);
  console.log(`  min-traders: ${minTraders}`);
  console.log("");

  const botUserId = dryRun ? "<dry-run>" : await ensureBotUser();

  // Counters
  let fetched = 0;
  let passed = 0;
  let imported = 0;
  let skippedDuplicate = 0;
  let skippedCategory = 0;
  let skippedResolution = 0;
  let skippedTraders = 0;
  let skippedTitle = 0;

  const dryRunSample: Array<{ title: string; category: string; traders: number; resolution: string }> = [];

  let cursor: string | undefined;
  let keepPaging = true;

  while (keepPaging && passed < limit) {
    const page = await fetchPage(cursor);

    if (page.length === 0) break;
    fetched += page.length;

    for (const m of page) {
      if (passed >= limit) {
        keepPaging = false;
        break;
      }

      // Filter: isResolved
      if (!m.isResolved) continue;

      // Filter: resolution must be YES or NO
      if (m.resolution !== "YES" && m.resolution !== "NO") {
        skippedResolution++;
        continue;
      }

      // Filter: mechanism and outcomeType
      if (m.mechanism !== "cpmm-1" || m.outcomeType !== "BINARY") {
        skippedResolution++;
        continue;
      }

      // Filter: min traders
      if ((m.uniqueBettorCount ?? 0) < minTraders) {
        skippedTraders++;
        continue;
      }

      // Filter: title length
      const titleLen = m.question.length;
      if (titleLen < 20 || titleLen > 300) {
        skippedTitle++;
        continue;
      }

      // Filter: category mapping
      const category = mapCategory(m);
      if (!category) {
        skippedCategory++;
        continue;
      }

      passed++;

      const externalId = `manifold:${m.id}`;
      const sourceUrl = `https://manifold.markets/${m.creatorUsername}/${m.slug}`;
      const marketSlug = `manifold-${m.slug}`.slice(0, 191); // Postgres varchar safety

      if (dryRun) {
        dryRunSample.push({
          title: m.question,
          category,
          traders: m.uniqueBettorCount ?? 0,
          resolution: m.resolution,
        });
        continue;
      }

      // Check duplicate (idempotency)
      const existing = await prisma.market.findUnique({ where: { externalId }, select: { id: true } });
      if (existing) {
        skippedDuplicate++;
        continue;
      }

      const closeAt = m.closeTime ? new Date(m.closeTime) : new Date();
      const resolvedAt = m.resolutionTime ? new Date(m.resolutionTime) : closeAt;
      const outcome = m.resolution === "YES" ? MarketOutcome.YES : MarketOutcome.NO;
      const description = (m.textDescription?.trim() || m.question).slice(0, 2000);

      // Upsert market
      const market = await prisma.market.upsert({
        where: { externalId },
        create: {
          slug: marketSlug,
          title: m.question,
          description,
          category,
          template: MarketTemplate.CUSTOM,
          marketType: MarketType.BINARY,
          creatorId: botUserId,
          status: MarketStatus.RESOLVED,
          resolutionStatus: ResolutionStatus.FINALIZED,
          resolutionMode: ResolutionMode.SOURCE_BASED,
          resolutionSourceType: ResolutionSourceType.PRESS_RELEASE,
          resolutionSourceName: "Manifold Markets",
          resolutionSourceUrl: sourceUrl,
          resolutionRuleText: "Resolved by Manifold Markets on original platform.",
          visibility: MarketVisibility.PUBLIC,
          poolRewardMode: PoolRewardMode.COMMISSION_BASED,
          outcome,
          closeAt,
          resolveAt: closeAt,
          approvedAt: new Date(),
          approvedById: botUserId,
          finalizationAt: resolvedAt,
          originPlatform: "manifold",
          externalId,
        },
        update: {},
        select: { id: true },
      });

      // Create MarketResolution row
      await prisma.marketResolution.upsert({
        where: { marketId: market.id },
        create: {
          marketId: market.id,
          outcome,
          sourceName: "Manifold Markets",
          sourceUrl,
          explanation: `Imported from Manifold. Original resolution: ${m.resolution}`,
          resolvedAt,
        },
        update: {},
      });

      imported++;

      if (imported % 50 === 0) {
        console.log(`  ... imported ${imported} markets so far`);
      }
    }

    if (page.length < PAGE_SIZE) {
      // Last page
      break;
    }

    cursor = page[page.length - 1]?.id;
    await sleep(PAGE_DELAY_MS);
  }

  // Print results
  console.log("");
  if (dryRun) {
    console.log("Import complete (DRY RUN — nothing written):");
  } else {
    console.log("Import complete:");
  }
  console.log(`  Fetched from API:     ${fetched} markets`);
  console.log(`  Passed filters:        ${passed} markets`);
  if (!dryRun) {
    console.log(`  Imported (new):        ${imported} markets`);
    console.log(`  Skipped (duplicate):   ${skippedDuplicate} markets`);
  }
  console.log(`  Skipped (category):    ${skippedCategory} markets`);
  console.log(`  Skipped (resolution):  ${skippedResolution} markets`);
  console.log(`  Skipped (min-traders): ${skippedTraders} markets`);
  console.log(`  Skipped (title len):   ${skippedTitle} markets`);

  if (dryRun && dryRunSample.length > 0) {
    console.log("");
    console.log("Sample of markets that would be imported (first 10):");
    const sample = dryRunSample.slice(0, 10);
    for (const s of sample) {
      console.log(`  [${s.category}] (${s.resolution}, ${s.traders} traders) ${s.title}`);
    }
  }
}

main()
  .catch((err) => {
    console.error("[import-manifold] Fatal error:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
