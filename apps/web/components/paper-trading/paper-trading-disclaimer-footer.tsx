/**
 * Shared legal/framing disclaimer for every Paper Trading surface. Distinct copy
 * from Portfolios' PortfolioDisclaimerFooter — Paper Trading fills immediately at
 * a delayed live tick (not a historical close) and simulates real trading costs,
 * so the framing has to say both of those things explicitly, plus the "rates are
 * indicative" caveat the cost stack itself requires (see the CEO brief's costs
 * module spec).
 *
 * Phase 2 (T9) added the options-specific paragraph: fills sourced from a
 * semi-reliable free/unofficial NSE feed, and lot sizes are snapshotted
 * per-position at fill time (never live-updated retroactively on an existing
 * position, even if NSE later changes the lot size for that underlying).
 */
export function PaperTradingDisclaimerFooter() {
  return (
    <div className="mt-10 space-y-3 border-t border-ink-100 pt-6 text-xs leading-6 text-ink-400">
      <p>
        Paper trading — hypothetical. Not investment advice. Your Paper Trading account trades with simulated
        virtual capital (₹1,00,000 starting cash) at real, delayed market prices (up to ~60 seconds behind
        live) — no real money, shares, or broker is ever involved. Every itemized cost (brokerage, STT,
        exchange charges, SEBI fee, stamp duty, GST, DP charge) is a simulated estimate at representative
        discount-broker rates and may not match what your real broker would charge. Past paper-trading
        performance does not guarantee future results.
      </p>
      <p>
        Index options (NIFTY/BANKNIFTY): premiums and lot sizes are sourced from a semi-reliable free,
        unofficial NSE feed and can occasionally be unavailable or delayed. A contract&apos;s lot size is
        fixed (snapshotted) at the moment you trade it — if NSE later changes that underlying&apos;s lot size,
        your existing position keeps the lot size it was opened at. Only buying CE/PE is offered; writing
        (selling) options isn&apos;t simulated here because it needs real exchange margin we have no honest way
        to approximate.
      </p>
    </div>
  );
}
