/**
 * import-manifold-markets.ts
 *
 * One-shot script that pages the Manifold Markets public API and imports
 * markets into predict_future as native-presenting admin-generated markets.
 *
 * Two import modes, selected by CLI flag:
 *   - Resolved (default): imports already-resolved BINARY/NUMERIC markets as
 *     read-only archived RESOLVED markets. Unaffected by this file's S-manifold-scrub
 *     changes — see the `isOpenImport` branches below.
 *   - Open (--include-open / --open-only): imports still-open, long-dated markets
 *     (closeTime >= now + --min-days-out, default 180 days) and auto-publishes them
 *     as status OPEN (mirrors the admin bulk-approve transition — see
 *     apps/api/app/api/admin/markets/bulk-approve/route.ts) so they appear in the feed
 *     immediately with no PENDING_REVIEW step.
 *
 * Usage:
 *   cd apps/api
 *   npx tsx scripts/import-manifold-markets.ts [--dry-run] [--limit=500] [--min-traders=30]
 *   npx tsx scripts/import-manifold-markets.ts --dry-run --open-only --min-days-out=180 --limit=200
 *
 * Flags:
 *   --dry-run          Print what would be imported without writing to the DB.
 *   --limit=N          Max markets to import (default: 500, max: 2000).
 *   --min-traders=N    Minimum uniqueBettorCount (default: 10).
 *   --include-open     Also import still-open markets (in addition to resolved).
 *   --open-only        Import ONLY still-open markets (skip resolved).
 *   --min-days-out=N   Open markets must close at least N days from now (default: 180).
 *                       Markets closing sooner are skipped and counted separately.
 *   --category-cap=N   Optional per-category cap on imports in a single run, to keep
 *                       the seeded backlog diverse instead of front-loading whichever
 *                       category the API happens to page through first.
 *
 * Zero-trace presentation:
 *   Imported markets are stamped with a clean in-house creator identity (see
 *   ensureBotUser below) and show "Hosted by @<that identity>" exactly like native
 *   markets — see apps/mobile/src/app/market/[id].tsx. originPlatform/externalId are
 *   retained as server-internal-only columns (never sent to clients — see
 *   apps/api/lib/markets/publicSelect.ts) so the daily resolution-sync cron
 *   (apps/api/app/api/cron/sync-manifold-resolutions) keeps working.
 *
 * Attribution / legal:
 *   Manifold data is CC BY-NC 4.0 (https://manifold.markets/terms). Only question
 *   text, resolution outcome, and aggregate metadata are imported — no user
 *   identities, bet amounts, or trading history. Attribution is retained
 *   server-side (originPlatform/externalId/resolutionSourceUrl on resolved imports)
 *   for internal audit and sync purposes even though it is not user-facing.
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

function parseArgs(): {
  dryRun: boolean;
  limit: number;
  minTraders: number;
  includeOpen: boolean;
  openOnly: boolean;
  minDaysOut: number;
  categoryCap: number | null;
} {
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

  const minDaysOutArg = args.find((a) => a.startsWith("--min-days-out="));
  const rawMinDaysOut = minDaysOutArg ? parseInt(minDaysOutArg.split("=")[1], 10) : 180;
  const minDaysOut = Math.max(0, isNaN(rawMinDaysOut) ? 180 : rawMinDaysOut);

  const categoryCapArg = args.find((a) => a.startsWith("--category-cap="));
  const rawCategoryCap = categoryCapArg ? parseInt(categoryCapArg.split("=")[1], 10) : NaN;
  const categoryCap = !isNaN(rawCategoryCap) && rawCategoryCap > 0 ? rawCategoryCap : null;

  return { dryRun, limit, minTraders, includeOpen, openOnly, minDaysOut, categoryCap };
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

// Clean in-house identity — this is the creator shown as "Hosted by @predictfuture"
// on every imported market (mirrors the native market host-attribution UI). Never
// attributes to Manifold or any external platform.
const IN_HOUSE_USERNAME = "predictfuture";
const IN_HOUSE_EMAIL = "desk@predictfuture.app";
// Pre-S-manifold-scrub identity. If found, it is renamed in place (not duplicated) so
// existing FK references (WalletTransaction rows, previously-imported markets, etc.)
// keep resolving correctly instead of pointing at an orphaned platform-branded account.
const LEGACY_USERNAMES = ["manifold-archive"];

async function ensureBotUser(): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { username: IN_HOUSE_USERNAME },
    select: { id: true },
  });
  if (existing) return existing.id;

  for (const legacyUsername of LEGACY_USERNAMES) {
    const legacy = await prisma.user.findUnique({
      where: { username: legacyUsername },
      select: { id: true },
    });
    if (legacy) {
      const renamed = await prisma.user.update({
        where: { id: legacy.id },
        data: { username: IN_HOUSE_USERNAME, email: IN_HOUSE_EMAIL },
        select: { id: true },
      });
      console.log(`  Renamed legacy bot identity "${legacyUsername}" → "${IN_HOUSE_USERNAME}"`);
      return renamed.id;
    }
  }

  // bcrypt hash of a placeholder password — pre-computed to avoid bcrypt dep at runtime.
  // The bot user never actually logs in; the password is never used.
  const { default: bcrypt } = await import("bcryptjs");
  const passwordHash = await bcrypt.hash("PfResearchDesk-1!", 10);

  const bot = await prisma.user.upsert({
    where: { username: IN_HOUSE_USERNAME },
    create: {
      email: IN_HOUSE_EMAIL,
      username: IN_HOUSE_USERNAME,
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
  const { dryRun, limit, minTraders, includeOpen, openOnly, minDaysOut, categoryCap } = parseArgs();
  const minCloseTime = Date.now() + minDaysOut * 24 * 60 * 60 * 1000;

  console.log("=== Manifold Markets Import ===");
  console.log(`  mode:         ${dryRun ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`  limit:        ${limit}`);
  console.log(`  min-traders:  ${minTraders}`);
  console.log(`  include-open: ${includeOpen ? (openOnly ? "OPEN-ONLY" : "yes") : "no"}`);
  if (includeOpen) {
    console.log(`  min-days-out: ${minDaysOut} (closeTime >= ${new Date(minCloseTime).toISOString()})`);
  }
  console.log(`  category-cap: ${categoryCap ?? "none"}`);
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
  let skippedTooSoon = 0;
  let skippedCategoryCap = 0;

  const categoryCounts = new Map<string, number>();
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
      // For OPEN markets, require a closeTime at least --min-days-out in the future.
      // This is the long-dated backlog requirement: short-fuse imports would just
      // recreate the stale-backlog problem this reseed is meant to fix.
      if (!m.isResolved) {
        if (!m.closeTime || m.closeTime < Date.now()) {
          skippedResolution++;
          continue;
        }
        if (m.closeTime < minCloseTime) {
          skippedTooSoon++;
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

      // Filter: optional per-category cap, so a single category doesn't crowd out
      // the rest of the seeded backlog just because the API paged through it first.
      if (categoryCap != null && (categoryCounts.get(category) ?? 0) >= categoryCap) {
        skippedCategoryCap++;
        continue;
      }

      passed++;
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);

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
      const now = new Date();

      // Resolution metadata: RESOLVED (archived) imports keep the existing
      // Manifold-attributed copy untouched (server-internal historical record — this
      // path is not part of the long-dated reseed and is out of scope for the
      // zero-trace scrub). OPEN imports — the long-dated auto-published backlog this
      // ticket adds — get platform-neutral copy since resolutionSourceName/RuleText
      // ARE sent to clients (see apps/api/app/api/markets/[marketId]/route.ts) and
      // must never mention the sourcing platform.
      const resolutionSourceName = isOpenImport ? "PredictFuture Research Desk" : "Manifold Markets";
      const resolutionSourceUrl = isOpenImport ? null : sourceUrl;
      const resolutionRuleText = isOpenImport
        ? "Resolves according to the outcome of the real-world event described above, as determined by PredictFuture's research desk from publicly available information."
        : "Resolved by Manifold Markets on original platform.";

      // Upsert market — RESOLVED for resolved imports; OPEN (auto-published, same
      // transition as admin bulk-approve) for open imports — no PENDING_REVIEW step.
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
          status: isOpenImport ? MarketStatus.OPEN : MarketStatus.RESOLVED,
          resolutionStatus: isOpenImport ? ResolutionStatus.OPEN : ResolutionStatus.FINALIZED,
          resolutionMode: ResolutionMode.SOURCE_BASED,
          resolutionSourceType: ResolutionSourceType.PRESS_RELEASE,
          resolutionSourceName,
          resolutionSourceUrl,
          resolutionRuleText,
          visibility: MarketVisibility.PUBLIC,
          poolRewardMode: PoolRewardMode.COMMISSION_BASED,
          outcome,
          closeAt,
          resolveAt: closeAt,
          approvedAt: now,
          approvedById: botUserId,
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
  console.log(`  Fetched from API:       ${fetched} markets`);
  console.log(`  Passed filters:         ${passed} markets`);
  if (!dryRun) {
    console.log(`  Imported (new):         ${imported} markets`);
    console.log(`  Skipped (duplicate):    ${skippedDuplicate} markets`);
  }
  console.log(`  Skipped (category):     ${skippedCategory} markets`);
  console.log(`  Skipped (resolution):   ${skippedResolution} markets`);
  console.log(`  Skipped (min-traders):  ${skippedTraders} markets`);
  console.log(`  Skipped (title len):    ${skippedTitle} markets`);
  if (includeOpen) {
    console.log(`  Skipped (too soon):     ${skippedTooSoon} markets (closeTime < ${minDaysOut}d out)`);
  }
  if (categoryCap != null) {
    console.log(`  Skipped (category cap): ${skippedCategoryCap} markets`);
  }

  console.log("");
  console.log("Category distribution of markets that passed all filters:");
  const sortedCategories = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sortedCategories) {
    console.log(`  ${cat.padEnd(16)} ${count}`);
  }

  if (passed < limit) {
    console.log("");
    console.log(
      `WARNING: only ${passed}/${limit} markets passed filters — the qualifying pool is smaller than the target.`
    );
    console.log(
      "  Per coordinator instruction: do NOT relax other filters (min-traders/title/category) to hit the target."
    );
    console.log(
      "  If more volume is needed, re-run with a larger --limit against a fresh cursor, or accept the smaller pool."
    );
  }

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
