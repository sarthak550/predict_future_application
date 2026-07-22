/**
 * Shared legal/framing disclaimer for every public Portfolios surface
 * (app/portfolios/**). Distinct copy from components/finance/disclaimer-footer's
 * AnalystDisclaimerFooter (which is specifically about graded analyst calls) —
 * portfolios are simulated paper-trading records, not statements someone made
 * in the press, so the framing has to say that explicitly.
 */
export function PortfolioDisclaimerFooter() {
  return (
    <p className="mt-10 border-t border-ink-100 pt-6 text-xs leading-6 text-ink-400">
      Model portfolio — hypothetical. Not investment advice. Every portfolio on Predict Future trades
      with simulated virtual capital (₹10,00,000 starting cash) at real, historical closing prices — no
      real money is ever involved. Orders fill at the next market close, not immediately. Past
      performance of a model portfolio does not guarantee future results.
    </p>
  );
}
