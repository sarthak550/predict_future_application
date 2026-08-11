/**
 * Product-level derivatives gate (2026-08-11, founder decision, verbatim):
 * "We can gate Future and Options both for now." Equities paper trading is
 * NEVER touched by this file — it stays fully live in every environment
 * regardless of these flags.
 *
 * `PAPER_TRADING_OPTIONS_ENABLED` / `PAPER_TRADING_FUTURES_ENABLED` —
 * parsed `=== "true"` (this codebase's established boolean-env-gate
 * convention, matching `FEED_FILTER_SUMMARY_READY` in
 * apps/api/lib/{stories,news}/queries.ts and, same-day,
 * `PREMIUM_CAPTURE_ALL_EXPIRIES` in apps/api's premiumCapture.ts). Default
 * OFF — unset, empty, or anything other than the literal string `"true"`
 * all resolve to GATED, the safe/current-desired state today. Two separate
 * flags (not one combined "derivatives" flag) so Options and Futures can be
 * launched independently later without a code change, even though both
 * happen to be off together right now.
 *
 * SERVER-ONLY, BY DESIGN — these read plain (non-`NEXT_PUBLIC_`-prefixed)
 * env vars, which Next.js does NOT inline into the client bundle. Call
 * these ONLY from Server Components (`page.tsx` files) or Route Handlers,
 * then pass the resulting boolean down as a prop/response field. NEVER
 * import this module from a `"use client"` file directly — `process.env.X`
 * would silently resolve to `undefined` in the browser (not a build error,
 * just always-false), which happens to be a SAFE failure mode here (always
 * gated) but is still the wrong place to read it and would make the
 * client-rendered gate state permanently stale/wrong if the flag is ever
 * flipped without a redeploy. This is exactly why the flag is read
 * per-request in the Server Component tree (`app/paper-trading/options/
 * page.tsx`, `app/paper-trading/futures/page.tsx` — both already dynamic,
 * since every Paper Trading page requires an authenticated session) rather
 * than baked in at build time: flipping the env var + recreating the web
 * container (see LAUNCH PROCEDURE below) is enough, no rebuild needed.
 *
 * LAUNCH PROCEDURE (when the founder decides to turn Options and/or Futures
 * trading on): set `PAPER_TRADING_OPTIONS_ENABLED=true` and/or
 * `PAPER_TRADING_FUTURES_ENABLED=true` in the web container's env (same
 * `.env`/`.env.prod` convention every other prod env var in this app
 * already uses) on the EC2 box, then recreate the container — `docker rm` +
 * `docker run` (or the project's equivalent reship step), NOT a plain
 * `docker restart`: Docker snapshots env vars at container CREATION, so a
 * restart alone would keep serving the old (gated) value. No rebuild, no
 * code change, no migration — every code path for both the gated and live
 * states already ships in this same build either way. The SAME two flag
 * names, read server-side in apps/web's own order-placement routes
 * (`app/api/paper-trading/options/orders/route.ts` via
 * `lib/paperTrading/optionOrders.ts`, and the futures equivalent), must be
 * flipped in the SAME container's env for the UI gate and the
 * defense-in-depth order-rejection gate to agree — they are the same env
 * var read twice, not two separate settings to keep in sync by hand.
 */

export function isOptionsTradingEnabled(): boolean {
  return process.env.PAPER_TRADING_OPTIONS_ENABLED === "true";
}

export function isFuturesTradingEnabled(): boolean {
  return process.env.PAPER_TRADING_FUTURES_ENABLED === "true";
}
