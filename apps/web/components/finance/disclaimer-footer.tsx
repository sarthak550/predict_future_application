/**
 * Shared legal/framing disclaimer for every public Analyst Scorecard surface
 * (app/analysts/**, app/calls/**). Journalism/accountability framing — never
 * investment advice, never editorialized about misses.
 */
export function AnalystDisclaimerFooter() {
  return (
    <p className="mt-10 border-t border-ink-100 pt-6 text-xs leading-6 text-ink-400">
      Not investment advice. Predict Future tracks what market analysts said in the press —
      every call links back to its original source. Hits and misses are shown factually, based
      on what was said and when, so you can judge a track record for yourself.
    </p>
  );
}
