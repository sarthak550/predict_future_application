/**
 * Portfolios (P3.1 read-side, extended in P3.2 with the public directory/detail/
 * sitemap queries) — DB orchestration for apps/web/app/api/portfolios/* and the
 * public app/portfolios/** pages.
 *
 * All derived math (cash, holdings, NAV, return%) comes from the pure functions in
 * packages/business-rules/src/portfolios/engine.ts — Portfolio itself has no
 * mutable nav/cash/holdings columns (see the schema doc on model Portfolio).
 */

import type { EngineTransaction } from "@predict-future/business-rules/portfolios/engine";
import { deriveCash, deriveHoldings, valuePortfolio } from "@predict-future/business-rules/portfolios/engine";
import { isEligibleForPublicRanking } from "@predict-future/business-rules/portfolios/eligibility";

import { getPortfolioOwnerUserLabel } from "@/lib/portfolios/displayName";
import { getEtfNameMap, searchEtfRegistryByName } from "@/lib/finance/etfRegistry";
import { prisma } from "@/lib/prisma";

const EXECUTED_TX_SELECT = {
  symbol: true,
  side: true,
  quantity: true,
  priceAtTx: true,
  status: true
} as const;

/**
 * Latest known StockEodQuote.close per symbol (any session — not scoped to "today"),
 * used both as the estimate for pending-order cash reservation and for live NAV.
 * One row per requested symbol via DISTINCT ON (symbol) ORDER BY sessionDate DESC.
 */
export async function getLatestCloseBySymbol(symbols: string[]): Promise<Map<string, number>> {
  if (symbols.length === 0) return new Map();
  const rows = await prisma.stockEodQuote.findMany({
    where: { symbol: { in: symbols } },
    select: { symbol: true, close: true },
    orderBy: { sessionDate: "desc" },
    distinct: ["symbol"]
  });
  return new Map(rows.map((r) => [r.symbol, r.close]));
}

export async function symbolHasQuotes(symbol: string): Promise<boolean> {
  const row = await prisma.stockEodQuote.findFirst({ where: { symbol }, select: { id: true } });
  return row !== null;
}

interface ExecutedTxnAgg {
  /** min(executionSessionDate) across EXECUTED rows — the eligibility anchor. */
  firstExecutedAt: Date | null;
  executedCount: number;
}

/**
 * Batches the "first EXECUTED fill date + EXECUTED count" aggregate for a set of
 * portfolios in one groupBy — the exact anchor isEligibleForPublicRanking expects
 * (see packages/business-rules/src/portfolios/eligibility.ts: MUST be the first
 * EXECUTED transaction, never Portfolio.createdAt — anti-gaming).
 */
async function getExecutedTxnAggByPortfolio(portfolioIds: string[]): Promise<Map<string, ExecutedTxnAgg>> {
  if (portfolioIds.length === 0) return new Map();
  const rows = await prisma.portfolioTransaction.groupBy({
    by: ["portfolioId"],
    where: { portfolioId: { in: portfolioIds }, status: "EXECUTED" },
    _min: { executionSessionDate: true },
    _count: { _all: true }
  });
  return new Map(
    rows.map((row) => [row.portfolioId, { firstExecutedAt: row._min.executionSessionDate, executedCount: row._count._all }])
  );
}

const OWNER_SELECT = {
  ownerUser: { select: { username: true, displayMode: true } },
  ownerExpert: { select: { name: true, slug: true, avatarUrl: true, organization: true } }
} as const;

interface OwnerRow {
  ownerUserId: string | null;
  ownerUser: { username: string; displayMode: string } | null;
  ownerExpert: { name: string; slug: string | null; avatarUrl: string | null; organization: string } | null;
}

export interface PortfolioOwnerDisplay {
  ownerLabel: string;
  /** /analysts/[slug] for a SHADOW portfolio whose Expert has a slug; null otherwise. */
  ownerHref: string | null;
  ownerOrganization: string | null;
  ownerAvatarUrl: string | null;
}

/**
 * Resolves the public-facing owner label + link for a portfolio. USER-kind
 * portfolios respect the owning User's displayMode (ANONYMOUS -> pseudonym) via
 * getPortfolioOwnerUserLabel; SHADOW-kind portfolios show the Expert's real name
 * and link to their public /analysts/[slug] profile when one exists.
 */
function resolvePortfolioOwner(portfolio: OwnerRow): PortfolioOwnerDisplay {
  if (portfolio.ownerExpert) {
    return {
      ownerLabel: portfolio.ownerExpert.name,
      ownerHref: portfolio.ownerExpert.slug ? `/analysts/${portfolio.ownerExpert.slug}` : null,
      ownerOrganization: portfolio.ownerExpert.organization,
      ownerAvatarUrl: portfolio.ownerExpert.avatarUrl
    };
  }
  if (portfolio.ownerUser && portfolio.ownerUserId) {
    return {
      ownerLabel: getPortfolioOwnerUserLabel({ id: portfolio.ownerUserId, ...portfolio.ownerUser }),
      ownerHref: null,
      ownerOrganization: null,
      ownerAvatarUrl: null
    };
  }
  // Defensive fallback — schema allows both owner FKs to be null, though nothing
  // in P3.1/P3.2 creates a portfolio that way.
  return { ownerLabel: "Predict Future", ownerHref: null, ownerOrganization: null, ownerAvatarUrl: null };
}

export interface LivePortfolioState {
  cash: number;
  holdings: Map<string, { quantity: number; costBasis: number; avgCost: number }>;
}

/** Live cash + holdings derived from a portfolio's EXECUTED transaction history. */
export async function getLivePortfolioState(portfolioId: string, startingCapital: number): Promise<LivePortfolioState> {
  const executedRows = await prisma.portfolioTransaction.findMany({
    where: { portfolioId, status: "EXECUTED" },
    orderBy: { requestedAt: "asc" },
    select: EXECUTED_TX_SELECT
  });
  const transactions = executedRows as EngineTransaction[];
  return {
    cash: deriveCash(startingCapital, transactions),
    holdings: deriveHoldings(transactions)
  };
}

export interface PortfolioListItem {
  id: string;
  slug: string;
  name: string;
  visibility: "PUBLIC" | "PRIVATE";
  description: string | null;
  startingCapital: number;
  createdAt: Date;
  publicSince: Date | null;
  latestCachedValue: {
    sessionDate: Date;
    cash: number;
    holdingsValue: number;
    totalValue: number;
    returnPct: number;
  } | null;
  live: {
    cash: number;
    holdingsValue: number;
    totalValue: number;
    returnPct: number;
  };
}

/**
 * Own portfolios with both the latest nightly-cron cache row (may be stale by up to
 * a day, or absent for a brand-new portfolio) AND a live-computed snapshot (always
 * fresh — priced at each held symbol's latest known close).
 */
export async function listMyPortfolios(ownerUserId: string): Promise<PortfolioListItem[]> {
  const portfolios = await prisma.portfolio.findMany({
    where: { ownerUserId },
    orderBy: { createdAt: "desc" },
    include: {
      dailyValues: { orderBy: { sessionDate: "desc" }, take: 1 }
    }
  });

  const results: PortfolioListItem[] = [];
  for (const portfolio of portfolios) {
    const { cash, holdings } = await getLivePortfolioState(portfolio.id, portfolio.startingCapital);
    const closeBySymbol = await getLatestCloseBySymbol([...holdings.keys()]);
    const live = valuePortfolio(holdings, cash, closeBySymbol, portfolio.startingCapital);
    const latest = portfolio.dailyValues[0];

    results.push({
      id: portfolio.id,
      slug: portfolio.slug,
      name: portfolio.name,
      visibility: portfolio.visibility,
      description: portfolio.description,
      startingCapital: portfolio.startingCapital,
      createdAt: portfolio.createdAt,
      publicSince: portfolio.publicSince,
      latestCachedValue: latest
        ? {
            sessionDate: latest.sessionDate,
            cash: latest.cash,
            holdingsValue: latest.holdingsValue,
            totalValue: latest.totalValue,
            returnPct: latest.returnPct
          }
        : null,
      live
    });
  }
  return results;
}

export interface PublicPortfolioListItem extends PortfolioOwnerDisplay {
  id: string;
  slug: string;
  name: string;
  kind: "USER" | "SHADOW";
  description: string | null;
  startingCapital: number;
  createdAt: Date;
  publicSince: Date | null;
  live: { cash: number; holdingsValue: number; totalValue: number; returnPct: number };
  executedTxnCount: number;
  firstExecutedTransactionAt: Date | null;
  /** Mirrors isEligibleForPublicRanking(firstExecutedTransactionAt, executedTxnCount). */
  eligible: boolean;
}

/**
 * Defensive cap on the public directory query — every row here does a live
 * valuation pass (see listMyPortfolios's identical N+1 pattern, which this
 * mirrors). Revisit with a materialized/cached ranking table if the public
 * portfolio count ever approaches this.
 */
const PUBLIC_DIRECTORY_LIMIT = 300;

/**
 * All PUBLIC portfolios (both eligible-for-ranking and "too new to rank"),
 * live-valued, for app/portfolios/page.tsx to sort/filter/section. Ranking
 * eligibility (isEligibleForPublicRanking) is computed here but NOT filtered
 * out — the directory page shows ineligible PUBLIC portfolios too, in a
 * separate unranked section, so callers must branch on `.eligible` themselves.
 */
export async function listPublicPortfolios(): Promise<PublicPortfolioListItem[]> {
  const portfolios = await prisma.portfolio.findMany({
    where: { visibility: "PUBLIC" },
    orderBy: { createdAt: "desc" },
    take: PUBLIC_DIRECTORY_LIMIT,
    include: OWNER_SELECT
  });
  if (portfolios.length === 0) return [];

  const aggByPortfolio = await getExecutedTxnAggByPortfolio(portfolios.map((p) => p.id));

  const results: PublicPortfolioListItem[] = [];
  for (const portfolio of portfolios) {
    const { cash, holdings } = await getLivePortfolioState(portfolio.id, portfolio.startingCapital);
    const closeBySymbol = await getLatestCloseBySymbol([...holdings.keys()]);
    const live = valuePortfolio(holdings, cash, closeBySymbol, portfolio.startingCapital);
    const agg = aggByPortfolio.get(portfolio.id) ?? { firstExecutedAt: null, executedCount: 0 };

    results.push({
      id: portfolio.id,
      slug: portfolio.slug,
      name: portfolio.name,
      kind: portfolio.kind,
      description: portfolio.description,
      startingCapital: portfolio.startingCapital,
      createdAt: portfolio.createdAt,
      publicSince: portfolio.publicSince,
      ...resolvePortfolioOwner(portfolio),
      live,
      executedTxnCount: agg.executedCount,
      firstExecutedTransactionAt: agg.firstExecutedAt,
      eligible: isEligibleForPublicRanking(agg.firstExecutedAt, agg.executedCount)
    });
  }
  return results;
}

export type PortfolioDetailAccess = "owner" | "public" | "denied" | "not-found";

export interface PortfolioTransactionHistoryRow {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  /** Only EXECUTED or CANCELLED — PENDING orders are never exposed here (see pendingTransactions). */
  status: "EXECUTED" | "CANCELLED";
  requestedAt: Date;
  executionSessionDate: Date | null;
  priceAtTx: number | null;
  note: string | null;
}

export interface PortfolioDetail extends PortfolioOwnerDisplay {
  id: string;
  slug: string;
  name: string;
  kind: "USER" | "SHADOW";
  visibility: "PUBLIC" | "PRIVATE";
  description: string | null;
  startingCapital: number;
  createdAt: Date;
  publicSince: Date | null;
  isOwner: boolean;
  holdings: { symbol: string; quantity: number; costBasis: number; avgCost: number; latestClose: number | null }[];
  live: { cash: number; holdingsValue: number; totalValue: number; returnPct: number };
  dailyValues: { sessionDate: Date; cash: number; holdingsValue: number; totalValue: number; returnPct: number }[];
  /** Owner-only — pending trading intentions are not exposed to public viewers. */
  pendingTransactions:
    | { id: string; symbol: string; side: "BUY" | "SELL"; quantity: number; requestedAt: Date }[]
    | null;
  executedTransactionCount: number;
  firstExecutedTransactionAt: Date | null;
  /** Mirrors isEligibleForPublicRanking — used for the "made public / eligible" framing on the detail page. */
  eligibleForRanking: boolean;
  /**
   * Immutable EXECUTED + CANCELLED transaction record, newest first. Exposed to
   * BOTH owner and public viewers (unlike pendingTransactions) — once an order
   * has settled or been cancelled it's no longer a live trading intention, so
   * the front-running concern that keeps pendingTransactions owner-only doesn't
   * apply here.
   */
  transactionHistory: PortfolioTransactionHistoryRow[];
}

/**
 * Resolves access + builds the full detail payload in one pass. Returns access
 * "not-found" / "denied" with `detail: null` for the route handler to translate into
 * the right HTTP status without a second round trip.
 */
export async function getPortfolioDetail(
  portfolioId: string,
  viewerUserId: string | null
): Promise<{ access: PortfolioDetailAccess; detail: PortfolioDetail | null }> {
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId }, include: OWNER_SELECT });
  if (!portfolio) return { access: "not-found", detail: null };

  const isOwner = portfolio.ownerUserId !== null && portfolio.ownerUserId === viewerUserId;
  if (!isOwner && portfolio.visibility !== "PUBLIC") {
    return { access: "denied", detail: null };
  }

  const { cash, holdings } = await getLivePortfolioState(portfolio.id, portfolio.startingCapital);
  const closeBySymbol = await getLatestCloseBySymbol([...holdings.keys()]);
  const live = valuePortfolio(holdings, cash, closeBySymbol, portfolio.startingCapital);

  const dailyValueRows = await prisma.portfolioDailyValue.findMany({
    where: { portfolioId: portfolio.id },
    orderBy: { sessionDate: "asc" }
  });

  const aggByPortfolio = await getExecutedTxnAggByPortfolio([portfolio.id]);
  const agg = aggByPortfolio.get(portfolio.id) ?? { firstExecutedAt: null, executedCount: 0 };

  const transactionHistoryRows = await prisma.portfolioTransaction.findMany({
    where: { portfolioId: portfolio.id, status: { in: ["EXECUTED", "CANCELLED"] } },
    orderBy: { requestedAt: "desc" },
    select: {
      id: true,
      symbol: true,
      side: true,
      quantity: true,
      status: true,
      requestedAt: true,
      executionSessionDate: true,
      priceAtTx: true,
      note: true
    }
  });

  let pendingTransactions: PortfolioDetail["pendingTransactions"] = null;
  if (isOwner) {
    const rows = await prisma.portfolioTransaction.findMany({
      where: { portfolioId: portfolio.id, status: "PENDING" },
      orderBy: { requestedAt: "desc" },
      select: { id: true, symbol: true, side: true, quantity: true, requestedAt: true }
    });
    pendingTransactions = rows;
  }

  const detail: PortfolioDetail = {
    id: portfolio.id,
    slug: portfolio.slug,
    name: portfolio.name,
    kind: portfolio.kind,
    visibility: portfolio.visibility,
    description: portfolio.description,
    startingCapital: portfolio.startingCapital,
    createdAt: portfolio.createdAt,
    publicSince: portfolio.publicSince,
    isOwner,
    ...resolvePortfolioOwner(portfolio),
    holdings: [...holdings.entries()].map(([symbol, lot]) => ({
      symbol,
      quantity: lot.quantity,
      costBasis: lot.costBasis,
      avgCost: lot.avgCost,
      latestClose: closeBySymbol.get(symbol) ?? null
    })),
    live,
    dailyValues: dailyValueRows.map((row) => ({
      sessionDate: row.sessionDate,
      cash: row.cash,
      holdingsValue: row.holdingsValue,
      totalValue: row.totalValue,
      returnPct: row.returnPct
    })),
    pendingTransactions,
    executedTransactionCount: agg.executedCount,
    firstExecutedTransactionAt: agg.firstExecutedAt,
    eligibleForRanking: isEligibleForPublicRanking(agg.firstExecutedAt, agg.executedCount),
    transactionHistory: transactionHistoryRows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      side: row.side,
      quantity: row.quantity,
      status: row.status as "EXECUTED" | "CANCELLED",
      requestedAt: row.requestedAt,
      executionSessionDate: row.executionSessionDate,
      priceAtTx: row.priceAtTx,
      note: row.note
    }))
  };

  return { access: isOwner ? "owner" : "public", detail };
}

/**
 * Slug-keyed variant of getPortfolioDetail for the public app/portfolios/[slug]
 * page and its opengraph-image sibling. `viewerUserId` is always null on the
 * ISR public page (no session is read there — see that page's doc comment), so
 * in practice this only ever resolves to "public" or "denied"/"not-found".
 */
export async function getPortfolioDetailBySlug(
  slug: string,
  viewerUserId: string | null
): Promise<{ access: PortfolioDetailAccess; detail: PortfolioDetail | null }> {
  const portfolio = await prisma.portfolio.findUnique({ where: { slug }, select: { id: true } });
  if (!portfolio) return { access: "not-found", detail: null };
  return getPortfolioDetail(portfolio.id, viewerUserId);
}

export interface PublicEligiblePortfolioSitemapEntry {
  slug: string;
  lastModified: Date;
}

/**
 * Lean slug list for sitemap.ts — PUBLIC + eligible-for-ranking only (mirrors
 * the exact same isEligibleForPublicRanking gate the directory page uses),
 * WITHOUT the live-valuation N+1 pass listPublicPortfolios does (a sitemap only
 * needs slug + lastModified, not price data).
 */
export async function listPublicEligiblePortfolioSlugsForSitemap(): Promise<PublicEligiblePortfolioSitemapEntry[]> {
  const portfolios = await prisma.portfolio.findMany({
    where: { visibility: "PUBLIC" },
    select: { id: true, slug: true, publicSince: true, createdAt: true }
  });
  if (portfolios.length === 0) return [];

  const aggByPortfolio = await getExecutedTxnAggByPortfolio(portfolios.map((p) => p.id));

  return portfolios
    .filter((p) => {
      const agg = aggByPortfolio.get(p.id) ?? { firstExecutedAt: null, executedCount: 0 };
      return isEligibleForPublicRanking(agg.firstExecutedAt, agg.executedCount);
    })
    .map((p) => ({ slug: p.slug, lastModified: p.publicSince ?? p.createdAt }));
}

export interface SymbolSearchResult {
  symbol: string;
  companyName: string;
  close: number;
  sessionDate: Date;
}

/**
 * Symbol/company search over StockEodQuote's latest available session. Web has no
 * access to apps/api's fetchEquityNames equity-master fallback (server-only, lives
 * in apps/api) — DISTINCT StockEodQuote symbols is a fine substitute here since it's
 * also the exact universe portfolios can actually trade (a symbol with no quote
 * history can't be priced, so it couldn't be validated for a BUY/SELL anyway).
 */
export async function searchSymbols(query: string, limit = 20): Promise<SymbolSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const latestSession = await prisma.stockEodQuote.findFirst({
    orderBy: { sessionDate: "desc" },
    select: { sessionDate: true }
  });
  if (!latestSession) return [];

  // Founder 2026-08-12: ETFs must be findable by their real fund NAMES here
  // too, not just tickers — StockEodQuote.companyName for an ETF is the
  // ticker duplicated (bhavcopy carries no fund names), so a name query
  // ("nippon", "bees", the tracked index's name) could never match through
  // this table alone. Registry name-matches are merged in as extra symbol
  // candidates, and matched ETFs get the registry's real securityName as
  // their display companyName. Same treatment the public
  // /api/instruments/search got (see that route's fund-category comment).
  const [nameMatchedEtfs, etfNames] = await Promise.all([
    searchEtfRegistryByName(trimmed, limit),
    getEtfNameMap()
  ]);

  const rows = await prisma.stockEodQuote.findMany({
    where: {
      sessionDate: latestSession.sessionDate,
      OR: [
        { symbol: { startsWith: trimmed.toUpperCase() } },
        { companyName: { contains: trimmed, mode: "insensitive" } },
        ...(nameMatchedEtfs.length > 0 ? [{ symbol: { in: nameMatchedEtfs.map((e) => e.symbol) } }] : [])
      ]
    },
    select: { symbol: true, companyName: true, close: true, sessionDate: true },
    orderBy: { symbol: "asc" },
    take: limit
  });
  return rows.map((r) =>
    etfNames.has(r.symbol.toUpperCase()) && r.companyName === r.symbol
      ? { ...r, companyName: etfNames.get(r.symbol.toUpperCase())! }
      : r
  );
}
