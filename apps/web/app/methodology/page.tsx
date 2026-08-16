import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchMethodologyData } from "@/lib/finance/methodology";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Methodology — How We Grade Analyst Calls | Predict Future",
  description:
    "How Predict Future extracts, grades, and discloses analyst market calls — the HIT/MISS rule, resolution windows, suppression, and known limitations, written for skeptics.",
  alternates: { canonical: "https://predictfuture.app/methodology" },
  robots: { index: true, follow: true },
};

/** Format an already-in-percent number (0-100), rounded to one decimal place. */
function pct1(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** Format an already-in-percent number (0-100), rounded to a whole number. */
function pct0(value: number): string {
  return `${Math.round(value)}%`;
}

export default async function MethodologyPage() {
  const data = await fetchMethodologyData();
  const { reconciliation, directionSplit, sampleSizeExample, trackedSources } = data;

  const notGradedShare =
    reconciliation.nonSuppressedTotal > 0
      ? (reconciliation.nonSuppressed.NOT_GRADED / reconciliation.nonSuppressedTotal) * 100
      : 0;
  const pendingShare =
    reconciliation.nonSuppressedTotal > 0
      ? (reconciliation.nonSuppressed.PENDING / reconciliation.nonSuppressedTotal) * 100
      : 0;

  return (
    <div className="space-y-8">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-semibold text-ink-900">Methodology</h1>
        <p className="mt-3 text-sm leading-6 text-ink-500">
          This page explains, in plain language, exactly how Predict Future decides an analyst call is a HIT or a
          MISS — and where the process is imperfect. It is written for skeptics, not for marketing: every number
          below is queried from the live database at the moment this page renders, not typed in by hand. If a claim
          here can&apos;t be independently checked, it doesn&apos;t belong on this page.
        </p>
      </div>

      {/* Section 1 — What gets graded */}
      <Card>
        <CardHeader>
          <CardTitle>1. What gets graded</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-ink-600">
          <p>
            An analyst opinion starts as a quote pulled from a tracked news source (see Section 5 for the current
            source list), tagged with a direction — bullish, bearish, or neutral — and, where possible, a specific
            tradeable instrument. Not every opinion we log is gradable: before grading ever starts, an AI pass checks
            whether the claim is specific and resolvable against real price data. Vague or non-directional commentary
            (general market color, macro opinions with no price call, valuation musing with no target) is excluded at
            this stage — it never gets a HIT or MISS, it simply isn&apos;t the kind of claim that can be checked.
          </p>
          <div className="grid gap-4 rounded-[20px] border border-ink-100 p-5 sm:grid-cols-3">
            <div>
              <p className="text-2xl font-semibold text-ink-900">{reconciliation.grandTotal.toLocaleString("en-IN")}</p>
              <p className="text-xs text-ink-400">opinions logged in total</p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink-900">{reconciliation.gradedCount.toLocaleString("en-IN")}</p>
              <p className="text-xs text-ink-400">
                currently graded (HIT or MISS) — {pct1(reconciliation.gradedPct)} of non-suppressed opinions
              </p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink-900">
                {reconciliation.nonSuppressed.PENDING.toLocaleString("en-IN")}
              </p>
              <p className="text-xs text-ink-400">
                still pending their resolution window — {pct1(pendingShare)} of non-suppressed opinions
              </p>
            </div>
          </div>
          <p>
            Most logged calls are still <strong>waiting for their window to elapse</strong>, not stuck or ignored —
            see Section 3 for how that window is set. A further {pct1(notGradedShare)} of non-suppressed opinions were
            reviewed and found not-gradable (Section 2) rather than published as a shaky HIT or MISS. The remainder
            were removed from the public record entirely — see Section 4 on suppression.
          </p>
        </CardContent>
      </Card>

      {/* Sections 2 + 3 side by side (founder 2026-08-16: the full-width
          cards left a dead right half — paired medium-length sections use
          the width instead). Stacks back to one column below lg. */}
      <div className="grid gap-8 lg:grid-cols-2 lg:items-stretch">
      {/* Section 2 — How HIT/MISS is decided */}
      <Card className="h-full">
        <CardHeader>
          <CardTitle>2. How HIT / MISS is decided</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-ink-600">
          <p>
            Once a call&apos;s resolution window has passed, we pull the instrument&apos;s real closing price and
            compare it against the price on the day the call was made. We use a{" "}
            <strong>1.5% noise floor</strong>: a bullish call needs the price to have actually risen more than about
            1.5% to count as right; a bearish call needs it to have fallen more than about 1.5%; a neutral call is
            right if the price stayed within roughly that band either way. Moves smaller than 1.5% are treated as{" "}
            <strong>&ldquo;too close to call&rdquo;</strong> — excluded from the record entirely, never counted as a
            win for anyone, directional or not.
          </p>
          <p>
            <strong>The quality gate.</strong> Every verdict is self-rated by the AI as high, medium, or low
            confidence. A HIT or MISS the AI itself is not confident about is <strong>never published</strong> as a
            HIT or MISS — it is downgraded and excluded instead. A wrong public verdict on someone&apos;s track
            record is worse than a slow one, so when the signal is genuinely ambiguous we would rather show nothing
            than guess.
          </p>
        </CardContent>
      </Card>

      {/* Section 3 — Resolution window */}
      <Card className="h-full">
        <CardHeader>
          <CardTitle>3. Resolution window</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-ink-600">
          <p>
            A call isn&apos;t graded early, and it isn&apos;t graded on some fixed company-wide schedule — it&apos;s
            graded once the <strong>analyst&apos;s own implied timeframe</strong> has actually passed, inferred from
            their language. A few examples of how that&apos;s read: &ldquo;the next few weeks&rdquo; grades in about
            3 weeks; a bare price target with no stated timeframe defaults to about 2 months out; an explicit
            year-end or named-quarter call grades on that real calendar date (e.g. &ldquo;by FY27&rdquo; grades March
            31, 2027). Multi-year, &ldquo;long term&rdquo; calls are tracked but not auto-graded — a claim that far
            out isn&apos;t something we can honestly check on a short window.
          </p>
        </CardContent>
      </Card>
      </div>

      <div className="grid gap-8 lg:grid-cols-2 lg:items-stretch">
      {/* Section 4 — Suppression */}
      <Card className="h-full">
        <CardHeader>
          <CardTitle>4. Suppression</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-ink-600">
          <p>
            Opinions can be manually removed from the public scorecard by the editorial/moderation team. This is a
            simple boolean fact about a row — suppressed or not — independent of whatever grading status it has
            underneath; a suppressed opinion doesn&apos;t disappear from our database, it&apos;s just excluded from
            every public number on this site.
          </p>
          <div className="rounded-[20px] border border-ink-100 p-5">
            <p className="text-2xl font-semibold text-ink-900">{pct1(reconciliation.suppressionRate)}</p>
            <p className="text-xs text-ink-400">
              of all logged opinions ({reconciliation.suppressedTotal.toLocaleString("en-IN")} of{" "}
              {reconciliation.grandTotal.toLocaleString("en-IN")}) are currently suppressed
            </p>
          </div>
          <p>
            <strong>Why opinions get suppressed.</strong> Based on what our own cleanup tooling actually does, the
            likely reasons are: duplicate or conflicting extraction (the same analyst quote pulled twice, or two
            directly contradictory reads of the same article — we suppress rather than guess which one is right),
            misattributed or unresolvable text (a quote that doesn&apos;t map to a real tradeable instrument), and
            junk or too-short extractions that don&apos;t clear a basic quality bar. Most suppressed rows —{" "}
            {pct1(reconciliation.suppressedTotal > 0 ? (reconciliation.suppressed.PENDING / reconciliation.suppressedTotal) * 100 : 0)}{" "}
            of them — were still awaiting grading when they were suppressed, so suppression is mostly a data-quality
            cleanup step, not a way of hiding unfavorable verdicts after the fact.
          </p>
          <p className="text-ink-500">
            <strong>Honest limitation:</strong> we do not currently store a reason code per suppressed opinion —
            suppression is a single removed/not-removed flag, with no itemized breakdown of which specific reason
            applied to which call. The categories above describe what our cleanup process does in general, not a
            verified reason for any one specific suppressed row.
          </p>
        </CardContent>
      </Card>
      {/* Section 6 — Data sources */}
      <Card className="h-full">
        <CardHeader>
          <CardTitle>5. Data sources</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-ink-600">
          <p>
            <strong>Price data</strong> comes from Yahoo Finance — end-of-day/delayed quotes, not tick-level or
            real-time data. <strong>Historical end-of-day price data</strong> for grading older calls is
            cross-checked against NSE/BSE bhavcopy archives. Neither source is instantaneous, and we don&apos;t claim
            otherwise anywhere on this site.
          </p>
          <p>
            <strong>Opinions are extracted only from a tracked allowlist of news sources</strong> — currently{" "}
            {trackedSources.length} domain{trackedSources.length === 1 ? "" : "s"}:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {trackedSources.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
          <p className="text-ink-500">
            This list will grow as coverage expands — it is queried live from the
            same allowlist constant the extraction pipeline itself gates on, so it can never silently go stale on
            this page.
          </p>
        </CardContent>
      </Card>

      </div>

      {/* Section 5 — Known limitations */}
      <Card className="border-amber-200">
        <CardHeader>
          <CardTitle>6. Known limitations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 text-sm leading-6 text-ink-600">
          {/* Two shorter limitations share a row; the era analysis (with its
              own stat grid) gets the full width below them. */}
          <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-ink-900">How we tag direction, and why bullish still leads</h3>
            <p>
              Of {directionSplit.total.toLocaleString("en-IN")} non-suppressed opinions, {pct1(directionSplit.bullishPct)}{" "}
              are tagged bullish, {pct1(directionSplit.bearishPct)} bearish, and {pct1(directionSplit.neutralPct)}{" "}
              neutral. Some of that gap is real: Indian brokerage research genuinely skews toward initiations,
              upgrades, and buy calls more than outright sell calls, and analysts hedge positive views in print far
              more often than negative ones — independent sentiment baselines run bullish-leaning too, just not
              always this wide. We work to keep our own extraction and counting process from adding to that
              real-world skew on top of it: the model is shown equally rigorous worked examples of bullish, bearish,
              and neutral calls, so it isn&apos;t primed to reach for one direction more readily than another; when a
              single article&apos;s signals are genuinely mixed, we tag whichever direction is actually dominant,
              with a true tie landing on neutral rather than being awarded to conviction; and every sentiment number
              on this site counts each analyst&apos;s latest stance on an instrument once, no matter how many times
              they&apos;ve repeated that same call across different articles — a restated view is still one opinion,
              not several. We validate this quote-by-quote against real published calls, not just by checking
              whether an aggregate percentage looks better. The number above will keep drifting as new opinions
              replace older ones in our rolling windows — it won&apos;t land at an even three-way split, and
              shouldn&apos;t, because the underlying commentary itself isn&apos;t evenly split either.
            </p>
          </div>

          <div className="space-y-2" id="sample-size">
            <h3 className="text-sm font-semibold text-ink-900">The sample-size caveat</h3>
            <p>
              A hit rate computed from only a handful of calls can look impressively high (or low) purely by chance.
              Take our own worked example: an analyst with {sampleSizeExample.hitCount} hits out of{" "}
              {sampleSizeExample.resolvedCount} graded calls has a headline rate of{" "}
              {pct0((sampleSizeExample.hitCount / sampleSizeExample.resolvedCount) * 100)} — but the real 95%
              confidence interval on that number, computed with a Wilson score interval, is roughly{" "}
              <strong>
                {sampleSizeExample.ci.lowerPct}–{sampleSizeExample.ci.upperPct}%
              </strong>
              . That is a huge range — wide enough that this analyst could plausibly be a genuine coin-flip or a
              genuinely strong performer, and {sampleSizeExample.resolvedCount} calls alone can&apos;t tell you
              which. Anywhere you see a percentage on this site with a{" "}
              <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
                Low sample
              </span>{" "}
              badge next to it, this is why — look for the confidence-interval range next to the number, not just the
              number itself.
            </p>
          </div>
          </div>

        </CardContent>
      </Card>

      <p className="max-w-3xl text-xs leading-6 text-ink-400">
        Have a question this page doesn&apos;t answer, or spot something that looks wrong? Every call on{" "}
        <Link href="/analysts" className="underline hover:text-ink-600">
          the scorecard
        </Link>{" "}
        links back to its original source article — that&apos;s the ultimate check on any number here.
      </p>
    </div>
  );
}
