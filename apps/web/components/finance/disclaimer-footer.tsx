import Link from "next/link";

/**
 * Shared legal/framing disclaimer for every public Analyst Scorecard surface
 * (app/analysts/**, app/calls/**). Journalism/accountability framing — never
 * investment advice, never editorialized about misses.
 *
 * Trust Layer Sprint T3 (2026-08-15): links to /methodology, the honest, skeptic-first
 * explainer of exactly how grading/suppression/sample-size work — the natural place to
 * add it, since this footer already renders on every page that makes an accuracy claim.
 */
export function AnalystDisclaimerFooter() {
  return (
    <p className="mt-10 border-t border-ink-100 pt-6 text-xs leading-6 text-ink-400">
      Not investment advice. Predict Future tracks what market analysts said in the press —
      every call links back to its original source. Hits and misses are shown factually, based
      on what was said and when, so you can judge a track record for yourself. See our{" "}
      <Link href="/methodology" className="underline hover:text-ink-600">
        methodology
      </Link>{" "}
      for exactly how calls are graded.
    </p>
  );
}
