/**
 * Shared legal/framing disclaimer for every Paper Trading surface. Distinct copy
 * from Portfolios' PortfolioDisclaimerFooter — Paper Trading fills immediately at
 * a delayed live tick (not a historical close) and simulates real trading costs,
 * so the framing has to say both of those things explicitly, plus the "rates are
 * indicative" caveat the cost stack itself requires (see the CEO brief's costs
 * module spec).
 */
export function PaperTradingDisclaimerFooter() {
  return (
    <p className="mt-10 border-t border-ink-100 pt-6 text-xs leading-6 text-ink-400">
      Paper trading — hypothetical. Not investment advice. Your Paper Trading account trades with simulated
      virtual capital (₹1,00,000 starting cash) at real, delayed market prices (up to ~60 seconds behind
      live) — no real money, shares, or broker is ever involved. Every itemized cost (brokerage, STT,
      exchange charges, SEBI fee, stamp duty, GST, DP charge) is a simulated estimate at representative
      discount-broker rates and may not match what your real broker would charge. Past paper-trading
      performance does not guarantee future results.
    </p>
  );
}
