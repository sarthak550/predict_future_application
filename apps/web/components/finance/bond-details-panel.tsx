import type { BondSeries } from "@prisma/client";

import { Card, CardContent } from "@/components/ui/card";
import { parseGsBondFacts, parseGbBondFacts } from "@/lib/finance/bondDetails";

/**
 * Bond Details panel (Instrument Details Audit, 2026-08-12) — renders only
 * the facts that are DERIVABLE WITH CERTAINTY from the bond's own symbol
 * per the series' NSE naming convention (see lib/finance/bondDetails.ts).
 * No issue price, issue date, or per-tranche specifics — those aren't in
 * our data and are never fabricated. A symbol that doesn't match its
 * series' expected pattern renders nothing (same graceful-degrade rule as
 * bondName.ts's own display-name fallback).
 */
export function BondDetailsPanel({ symbol, series }: { symbol: string; series: BondSeries }) {
  if (series === "GS") {
    const facts = parseGsBondFacts(symbol);
    if (!facts) return null;
    return (
      <Card>
        <CardContent className="p-5">
          <p className="mb-3 text-lg font-semibold text-ink-900">Bond details</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <Fact label="Coupon rate" value={`${facts.couponPct.toFixed(2)}% p.a.`} />
            <Fact label="Maturity year" value={String(facts.maturityYear)} />
            <Fact label="Issuer" value={facts.issuer} />
            <Fact label="Category" value="Government Security (G-Sec)" />
          </div>
          <p className="mt-4 text-xs leading-5 text-ink-400">
            Central-government bond — principal and coupon carry a sovereign guarantee. Coupon rate and maturity year are
            derived from the bond&apos;s own NSE symbol, not a separate prospectus lookup.
          </p>
        </CardContent>
      </Card>
    );
  }

  const facts = parseGbBondFacts(symbol);
  if (!facts) return null;
  return (
    <Card>
      <CardContent className="p-5">
        <p className="mb-3 text-lg font-semibold text-ink-900">Bond details</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Fact label="Redemption month" value={facts.maturityMonth} />
          <Fact label="Redemption year" value={String(facts.maturityYear)} />
          <Fact label="Category" value="Sovereign Gold Bond (SGB)" />
        </div>
        <div className="mt-4 border-t border-ink-100 pt-4">
          <p className="mb-2 text-sm font-semibold text-ink-700">About Sovereign Gold Bonds</p>
          <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-ink-500">
            <li>Interest: 2.50% per annum on the issue price, paid semi-annually.</li>
            <li>Denominated in grams of gold.</li>
            <li>Tenor: 8 years from issue.</li>
            <li>Issued by the Reserve Bank of India on behalf of the Government of India.</li>
          </ul>
          <p className="mt-2 text-[11px] text-ink-400">
            General scheme terms shared by every SGB tranche — this tranche&apos;s specific issue price and issue date
            aren&apos;t in our data.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink-400">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold text-ink-900">{value}</p>
    </div>
  );
}
