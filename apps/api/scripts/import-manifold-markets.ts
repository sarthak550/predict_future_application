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

function parseArgs(): { dryRun: boolean; limit: number; minTraders: number; includeOpen: boolean; openOnly: boolean } {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const includeOpen = args.includes("--include-open") || args.includes("--open-only");
  const openOnly = args.includes("--open-only");

  const limitArg = args.find((a) => a.startsWith("--limit="));
  const rawLimit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 500;
  const limit = Math.max(1, Math.min(2000, isNaN(rawLimit) ? 500 : rawLimit));

  const minTradersArg = args.find((a) => a.startsWith("--min-traders="));
  const rawMinTraders = minTradersArg
    ? parseInt(minTradersArg.split("=")[1], 10)
    : 10;
  const minTraders = Math.max(0, isNaN(rawMinTraders) ? 10 : rawMinTraders);

  return { dryRun, limit, minTraders, includeOpen, openOnly };
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
  probability?: number;
  volume?: number;
  resolutionProbability?: number;
  // Numeric / pseudo-numeric markets
  min?: number;
  max?: number;
  isLogScale?: boolean;
  resolutionValue?: number;
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

  // No matching category — fall back to GENERAL so we don't drop the market.
  return MarketCategory.GENERAL;
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
  const { dryRun, limit, minTraders, includeOpen, openOnly } = parseArgs();

  console.log("=== Manifold Markets Import ===");
  console.log(`  mode:        ${dryRun ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`  limit:       ${limit}`);
  console.log(`  min-traders: ${minTraders}`);
  console.log(`  include-open: ${includeOpen ? (openOnly ? "OPEN-ONLY" : "yes") : "no"}`);
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

      // Filter: resolved-only vs open-only vs both
      if (openOnly && m.isResolved) continue;
      if (!includeOpen && !m.isResolved) continue;

      // Filter: outcomeType must be BINARY, PSEUDO_NUMERIC, or NUMERIC
      const isBinary = m.outcomeType === "BINARY";
      const isNumeric = m.outcomeType === "PSEUDO_NUMERIC" || m.outcomeType === "NUMERIC";
      if (!isBinary && !isNumeric) {
        skippedResolution++;
        continue;
      }
      // Mechanism must be a known type.
      // BINARY markets use "cpmm-1"; PSEUDO_NUMERIC markets use "pseudonumeric";
      // multi-answer markets use "cpmm-multi-1".
      const allowedMechanism = isBinary
        ? m.mechanism === "cpmm-1"
        : isNumeric
          ? m.mechanism === "cpmm-1" || m.mechanism === "pseudonumeric"
          : m.mechanism === "cpmm-multi-1";
      if (!allowedMechanism) {
        skippedResolution++;
        continue;
      }

      // Resolved-state checks per market type
      if (m.isResolved) {
        if (isBinary && m.resolution !== "YES" && m.resolution !== "NO") {
          skippedResolution++;
          continue;
        }
        if (isNumeric && (m.resolutionValue == null || !isFinite(m.resolutionValue))) {
          skippedResolution++;
          continue;
        }
      }
      // For OPEN markets, require a closeTime in the future (else stale)
      if (!m.isResolved) {
        if (!m.closeTime || m.closeTime < Date.now()) {
          skippedResolution++;
          continue;
        }
      }
      // Numeric markets need min/max for a valid range
      if (isNumeric && (m.min == null || m.max == null || m.min >= m.max)) {
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
          resolution: m.resolution ?? "OPEN",
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
      const description = (m.textDescription?.trim() || m.question).slice(0, 2000);
      const isOpenImport = !m.isResolved;
      const marketType = isNumeric ? MarketType.NUMERIC : MarketType.BINARY;
      // For numeric markets we don't have YES/NO outcome — only actualValue
      const outcome: MarketOutcome | undefined = isOpenImport
        ? undefined
        : isBinary
          ? (m.resolution === "YES" ? MarketOutcome.YES : MarketOutcome.NO)
          : undefined;
      const actualValue = !isOpenImport && isNumeric ? m.resolutionValue ?? null : null;

      // Upsert market — RESOLVED for resolved imports, PENDING_REVIEW for open imports (admin approves)
      const market = await prisma.market.upsert({
        where: { externalId },
        create: {
          slug: marketSlug,
          title: m.question,
          description,
          category,
          template: MarketTemplate.CUSTOM,
          marketType,
          minValue: isNumeric ? m.min ?? null : null,
          maxValue: isNumeric ? m.max ?? null : null,
          actualValue,
          creatorId: botUserId,
          status: isOpenImport ? MarketStatus.PENDING_REVIEW : MarketStatus.RESOLVED,
          resolutionStatus: isOpenImport ? ResolutionStatus.OPEN : ResolutionStatus.FINALIZED,
          resolutionMode: ResolutionMode.SOURCE_BASED,
          resolutionSourceType: ResolutionSourceType.PRESS_RELEASE,
          resolutionSourceName: "Manifold Markets",
          resolutionSourceUrl: sourceUrl,
          resolutionRuleText: isOpenImport
            ? "Will sync with Manifold Markets on resolution."
            : "Resolved by Manifold Markets on original platform.",
          visibility: MarketVisibility.PUBLIC,
          poolRewardMode: PoolRewardMode.COMMISSION_BASED,
          outcome,
          closeAt,
          resolveAt: closeAt,
          approvedAt: isOpenImport ? null : new Date(),
          approvedById: isOpenImport ? null : botUserId,
          finalizationAt: isOpenImport ? null : resolvedAt,
          originPlatform: "manifold",
          externalId,
          externalProbability: m.resolutionProbability ?? m.probability ?? null,
          externalVolume: m.volume ?? null,
          externalTraderCount: m.uniqueBettorCount ?? null,
          // Mirror crowd data into native counters so card UI renders uniformly ($1 = 10 pts)
          totalVolume: m.volume != null ? Math.round(m.volume * 10) : 0,
          totalParticipants: m.uniqueBettorCount ?? 0,
        },
        update: {
          externalProbability: m.resolutionProbability ?? m.probability ?? null,
          externalVolume: m.volume ?? null,
          externalTraderCount: m.uniqueBettorCount ?? null,
          totalVolume: m.volume != null ? Math.round(m.volume * 10) : 0,
          totalParticipants: m.uniqueBettorCount ?? 0,
        },
        select: { id: true },
      });

      // Create MarketResolution row for resolved imports (binary uses outcome, numeric uses actualValue text)
      if (!isOpenImport) {
        const explanation = isNumeric
          ? `Imported from Manifold. Resolved value: ${m.resolutionValue}`
          : `Imported from Manifold. Original resolution: ${m.resolution}`;
        await prisma.marketResolution.upsert({
          where: { marketId: market.id },
          create: {
            marketId: market.id,
            outcome: outcome ?? MarketOutcome.UNRESOLVED,
            actualValue,
            sourceName: "Manifold Markets",
            sourceUrl,
            explanation,
            resolvedAt,
          },
          update: {},
        });
      }

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
