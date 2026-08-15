/**
 * Growth Loop Sprint G0 (2026-08-15) — Plausible (hosted) analytics gate.
 *
 * Mirrors apps/web/lib/paperTrading/featureFlags.ts's established convention EXACTLY:
 * plain (non-`NEXT_PUBLIC_`-prefixed) env var, `=== "true"` check, default OFF, read
 * SERVER-ONLY from a Server Component (RootLayout). Unset/anything-but-`"true"` renders
 * ZERO script tag — not a disabled-but-present one — so local dev traffic can never
 * pollute prod analytics even by accident. See that file's own doc comment for the full
 * "why non-NEXT_PUBLIC_" rationale; it applies identically here.
 *
 * DOMAIN DISCREPANCY — investigated and resolved, not guessed (per the brief's explicit
 * instruction). `app/layout.tsx`'s `metadataBase` claims `https://predictfuture.app`, but
 * that domain has NO DNS record at all (`dig predictfuture.app` returns empty; a direct
 * curl fails to resolve) — it is aspirational, reserved for a future purchase, per
 * [[project_web_live_ec2]]'s own note: "predictfuture.app not owned yet." The site that
 * actually serves live traffic today is `predictfuture-web.duckdns.org` (verified 200 OK
 * 2026-08-15, DNS resolves to the EC2 box at 13.126.37.16) — THAT is the domain Plausible
 * must be configured against, or the dashboard would track a host nobody can reach.
 * ANALYTICS_DOMAIN therefore defaults to the duckdns host, not metadataBase's aspirational
 * one. If/when the founder buys predictfuture.app and cuts the site over, update
 * ANALYTICS_DOMAIN (and metadataBase, and every `https://predictfuture.app` canonical/OG
 * URL elsewhere in this app — out of scope for this sprint) together in the same change.
 */

const LIVE_PROD_DOMAIN = "predictfuture-web.duckdns.org";

export function isAnalyticsEnabled(): boolean {
  return process.env.ANALYTICS_ENABLED === "true";
}

export function getAnalyticsDomain(): string {
  return process.env.ANALYTICS_DOMAIN?.trim() || LIVE_PROD_DOMAIN;
}
