"use client";

/**
 * "Paper trade this call" (Paper Trading Phase 1 T7, extended Phase 3 T8) —
 * pre-fills /paper-trading's New Trade form per the CEO brief's direction
 * rules: BULLISH suggests a DELIVERY buy, BEARISH suggests an INTRADAY short
 * (the only way to "trade" a bearish call via equity, since delivery
 * short-selling isn't modeled). Hidden entirely for NEUTRAL (nothing
 * directional to trade) and for any call whose ticker isn't a tradeable NSE
 * cash symbol (index tickers like "^NSEI", non-NSE tickers, or no ticker at
 * all) — reuses the exact ticker->symbol mapping Portfolios' shadow-portfolio
 * generator already solved (packages/business-rules/src/portfolios/shadow.ts),
 * rather than re-deriving it.
 *
 * Phase 3 (T8) adds a SECOND, secondary link — "Trade options on this call" —
 * shown only when the resolved symbol is a live member of the F&O stock
 * universe (checked client-side against the same cached universe fetch the
 * options chain browser uses, see fnoUniverseClient.ts — hence this component
 * is now "use client", it wasn't before). Direction mapping:
 *   - BULLISH -> deep-links to the options chain in Stock mode, CE
 *     pre-selected — the options-native way to express the same bullish view
 *     the equity CTA already offers via a DELIVERY buy. Shown ALONGSIDE the
 *     equity CTA, no demotion — both are legitimate bullish strategies.
 *   - BEARISH -> deep-links with PE pre-selected. This is a materially
 *     BETTER bearish story than the equity CTA's INTRADAY short (a fully
 *     prepaid position, no shorting mechanics, no same-day-close friction) —
 *     so when F&O-eligible, the options link is shown as the RECOMMENDED
 *     path and the equity INTRADAY-short link is visually demoted with "or,
 *     if you don't want to trade options" copy, rather than being the only
 *     bearish option shown (pre-Phase-3 behavior, still used verbatim when
 *     the symbol isn't F&O-eligible).
 *
 * Shared by every ExpertOpinion render surface: components/finance/
 * expandable-calls-table.tsx (analyst profile + /opinions + instrument detail)
 * and app/calls/[id]/page.tsx (the single-call share page).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { OpinionDirection } from "@prisma/client";

import { mapTickerToNseSymbol } from "@predict-future/business-rules/portfolios/shadow";

import { Button } from "@/components/ui/button";
import { fetchFnoUniverseClient } from "@/lib/paperTrading/fnoUniverseClient";

export function PaperTradeCta({
  opinionId,
  direction,
  instrumentTicker
}: {
  opinionId: string;
  direction: OpinionDirection;
  instrumentTicker: string | null;
}) {
  const symbol = direction === "NEUTRAL" ? null : mapTickerToNseSymbol(instrumentTicker);
  const [fnoEligible, setFnoEligible] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    fetchFnoUniverseClient().then((universe) => {
      if (!cancelled) setFnoEligible(universe.some((entry) => entry.symbol === symbol));
    });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (direction === "NEUTRAL" || !symbol) return null;

  const side = direction === "BULLISH" ? "BUY" : "SELL";
  const productType = direction === "BULLISH" ? "DELIVERY" : "INTRADAY";
  const equityHref = `/paper-trading?symbol=${encodeURIComponent(symbol)}&side=${side}&productType=${productType}&linkedOpinionId=${encodeURIComponent(opinionId)}`;

  const optionType = direction === "BULLISH" ? "CE" : "PE";
  const optionsHref = `/paper-trading/options?underlying=${encodeURIComponent(symbol)}&optionType=${optionType}&linkedOpinionId=${encodeURIComponent(opinionId)}`;

  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

  // BEARISH + F&O-eligible: options (PE) is the recommended path, equity
  // INTRADAY-short is demoted. Every other case: equity CTA stays primary,
  // options CTA (if eligible) shown alongside as an additional option.
  const bearishOptionsRecommended = direction === "BEARISH" && fnoEligible;

  return (
    <div className="space-y-1.5 border-t border-ink-100 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {bearishOptionsRecommended ? (
          <>
            <Link href={optionsHref} onClick={stopPropagation}>
              <Button type="button" variant="secondary" size="sm" className="inline-flex items-center gap-1">
                Trade options on this call
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
            <Link href={equityHref} onClick={stopPropagation}>
              <Button type="button" variant="ghost" size="sm" className="inline-flex items-center gap-1">
                Paper trade this call
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </>
        ) : (
          <>
            <Link href={equityHref} onClick={stopPropagation}>
              <Button type="button" variant="secondary" size="sm" className="inline-flex items-center gap-1">
                Paper trade this call
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
            {fnoEligible && (
              <Link href={optionsHref} onClick={stopPropagation}>
                <Button type="button" variant="ghost" size="sm" className="inline-flex items-center gap-1">
                  Trade options on this call
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            )}
          </>
        )}
      </div>
      {direction === "BEARISH" && bearishOptionsRecommended && (
        <p className="text-xs text-ink-400">
          Buying a PE is a fully prepaid bearish position — no shorting mechanics needed, unlike an INTRADAY short.
          Or, if you don&apos;t want to trade options, the second link pre-fills a same-day INTRADAY short instead
          (delivery short-selling isn&apos;t allowed).
        </p>
      )}
      {direction === "BEARISH" && !bearishOptionsRecommended && (
        <p className="text-xs text-ink-400">
          Pre-fills a same-day INTRADAY short — delivery short-selling isn&apos;t allowed, so this is the only way
          to paper-trade a bearish call.
        </p>
      )}
    </div>
  );
}
