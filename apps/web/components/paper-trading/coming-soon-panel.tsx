import Link from "next/link";
import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Product-level derivatives gate (2026-08-11) — rendered by
 * `OptionsPageClient`/`FuturesPageClient` in place of the real trading
 * terminal whenever `lib/paperTrading/featureFlags.ts` reports that surface
 * as gated AND the caller has no existing position of that kind (see each
 * client's own gating logic — an existing position holder still sees the
 * real terminal so closing/square-off keeps working, per the founder's
 * explicit "never strand someone's money-state" directive). Same
 * Card/CardHeader/CardTitle/CardDescription visual idiom as this app's other
 * empty states (e.g. the dashboard's "Sign in to start paper trading" card)
 * — deliberately not a bespoke one-off style.
 */
export function ComingSoonPanel({ kind }: { kind: "options" | "futures" }) {
  const label = kind === "options" ? "Options" : "Futures";
  const blurb =
    kind === "options"
      ? "NIFTY/BANKNIFTY index options and F&O-eligible single-stock options — buy CE or PE, fully prepaid."
      : "Index futures — go long or short, margin-backed, marked to market daily.";

  return (
    <Card className="mx-auto w-full max-w-lg">
      <CardHeader>
        <Badge variant="accent" className="w-fit gap-1.5">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Coming soon
        </Badge>
        <CardTitle className="mt-1">{label} trading — coming soon</CardTitle>
        <CardDescription>
          {blurb} We&apos;re polishing this before opening it up — check back soon. Your equities paper trading account
          stays fully available in the meantime.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Link href="/paper-trading">
          <Button variant="primary">Back to Paper Trading</Button>
        </Link>
      </CardContent>
    </Card>
  );
}
