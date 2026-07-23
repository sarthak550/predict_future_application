/**
 * "Paper trade this call" (Paper Trading T7) — pre-fills /paper-trading's New
 * Trade form per the CEO brief's direction rules: BULLISH suggests a DELIVERY
 * buy, BEARISH suggests an INTRADAY short (the only way to "trade" a bearish
 * call, since delivery short-selling isn't modeled). Hidden entirely for NEUTRAL
 * (nothing directional to trade) and for any call whose ticker isn't a tradeable
 * NSE cash symbol (index tickers like "^NSEI", non-NSE tickers, or no ticker at
 * all) — reuses the exact ticker->symbol mapping Portfolios' shadow-portfolio
 * generator already solved (packages/business-rules/src/portfolios/shadow.ts),
 * rather than re-deriving it.
 *
 * Shared by every ExpertOpinion render surface: components/finance/
 * expandable-calls-table.tsx (analyst profile + /opinions + instrument detail)
 * and app/calls/[id]/page.tsx (the single-call share page).
 */
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { OpinionDirection } from "@prisma/client";

import { mapTickerToNseSymbol } from "@predict-future/business-rules/portfolios/shadow";

import { Button } from "@/components/ui/button";

export function PaperTradeCta({
  opinionId,
  direction,
  instrumentTicker
}: {
  opinionId: string;
  direction: OpinionDirection;
  instrumentTicker: string | null;
}) {
  if (direction === "NEUTRAL") return null;
  const symbol = mapTickerToNseSymbol(instrumentTicker);
  if (!symbol) return null;

  const side = direction === "BULLISH" ? "BUY" : "SELL";
  const productType = direction === "BULLISH" ? "DELIVERY" : "INTRADAY";
  const href = `/paper-trading?symbol=${encodeURIComponent(symbol)}&side=${side}&productType=${productType}&linkedOpinionId=${encodeURIComponent(opinionId)}`;

  return (
    <div className="space-y-1.5 border-t border-ink-100 pt-3">
      <Link href={href} onClick={(e) => e.stopPropagation()}>
        <Button type="button" variant="secondary" size="sm" className="inline-flex items-center gap-1">
          Paper trade this call
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Button>
      </Link>
      {direction === "BEARISH" && (
        <p className="text-xs text-ink-400">
          Pre-fills a same-day INTRADAY short — delivery short-selling isn&apos;t allowed, so this is the only way
          to paper-trade a bearish call.
        </p>
      )}
    </div>
  );
}
