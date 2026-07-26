import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PriceChart } from "@/components/finance/price-chart";
import { Card, CardContent } from "@/components/ui/card";
import { fetchBondDetail } from "@/lib/finance/bonds";
import { formatIstSessionDate } from "@/lib/utils";

export const revalidate = 900;

const SERIES_LABEL: Record<"GS" | "GB", string> = {
  GS: "Government Security",
  GB: "Sovereign Gold Bond",
};

function formatBondPrice(v: number): string {
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export async function generateMetadata({ params }: { params: { symbol: string } }): Promise<Metadata> {
  const bond = await fetchBondDetail(params.symbol);
  if (!bond) {
    return { title: "Bond — Predict Future", robots: { index: false, follow: true } };
  }

  const title = `${bond.displayName} (${bond.symbol}) — price & chart — Predict Future`;
  const description = `${bond.displayName} (${bond.symbol}) closed at ${formatBondPrice(bond.quote.close)} (${bond.quote.changePercent >= 0 ? "+" : ""}${bond.quote.changePercent.toFixed(2)}%) on ${formatIstSessionDate(bond.quote.sessionDate)}. NSE end-of-day close, informational only — not tradable on Predict Future.`;
  const url = `https://predictfuture.app/bonds/${bond.symbol}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: { title, description, type: "website", url },
    twitter: { card: "summary", title, description },
  };
}

export default async function BondDetailPage({ params }: { params: { symbol: string } }) {
  const bond = await fetchBondDetail(params.symbol);
  if (!bond) {
    notFound();
  }

  const isUp = bond.quote.changePercent >= 0;
  const firstIngestedDateLabel = bond.spark.length > 0 ? formatIstSessionDate(bond.spark[0].sessionDate) : null;

  return (
    <div className="space-y-8">
      <Link href="/bonds" className="text-sm font-medium text-ink-500 hover:text-ink-900">
        ← All bonds
      </Link>

      <Card className="overflow-hidden border-0 bg-ink-900 text-white">
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">
                {SERIES_LABEL[bond.series]} · NSE
              </p>
              <h1 className="mt-1 text-2xl font-semibold">{bond.displayName}</h1>
              <p className="mt-1 text-xs text-white/50">{bond.symbol}</p>
            </div>

            <div className="text-right">
              <p className="text-3xl font-semibold tabular-nums">{formatBondPrice(bond.quote.close)}</p>
              <p className={`mt-1 text-sm font-semibold ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                {isUp ? "+" : ""}
                {bond.quote.changePercent.toFixed(2)}% today
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-white/10 pt-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-white/50">Prev. Close</p>
              <p className="mt-0.5 font-medium">{formatBondPrice(bond.quote.prevClose)}</p>
            </div>
            <div>
              <p className="text-xs text-white/50">Volume</p>
              <p className="mt-0.5 font-medium">{Math.round(bond.quote.volume).toLocaleString("en-IN")}</p>
            </div>
            <div>
              <p className="text-xs text-white/50">As of</p>
              <p className="mt-0.5 font-medium">{formatIstSessionDate(bond.quote.sessionDate)} (EOD)</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Price history</p>
          <p className="mb-3 text-xs text-ink-400">
            {firstIngestedDateLabel
              ? `Since ${firstIngestedDateLabel} — Predict Future started tracking this bond then; there is no earlier history to show.`
              : "History builds daily as sessions close."}
          </p>
          <PriceChart
            symbol={bond.symbol}
            series={bond.spark.map((pt) => ({ date: formatIstSessionDate(pt.sessionDate), close: pt.close }))}
            defaultTimeframe="MAX"
          />
        </CardContent>
      </Card>

      <p className="border-t border-ink-100 pt-6 text-center text-xs leading-6 text-ink-400">
        Informational only — not tradable on Predict Future. Prices are end-of-day NSE closes, not intraday quotes.
      </p>
    </div>
  );
}
