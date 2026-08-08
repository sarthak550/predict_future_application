import Link from "next/link";

/**
 * Sitewide footer — homepage redesign (2026-08-09, CEO brief T6). No footer
 * existed anywhere in apps/web before this; only per-page inline disclaimer
 * blocks (AnalystDisclaimerFooter / PaperTradingDisclaimerFooter /
 * PortfolioDisclaimerFooter), none of which double as navigation.
 *
 * Every link below resolves to a real, shipped page — verified against the
 * app directory 2026-08-09. Deliberately NO "About" / "Terms" / "Privacy"
 * links: those pages don't exist yet (house honesty law applies to
 * navigation, not just stats — see the CEO brief). A minimal stub pair is a
 * flagged fast-follow, not part of this ticket.
 *
 * Placement: homepage only for this sprint (mirrors the brief's "ship
 * homepage-only first" fallback) — wiring this into every public layout
 * (PublicHeader's sibling) is a fast follow, not scoped here.
 */
const FOOTER_COLUMNS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: "Analyst Scorecard",
    links: [
      { href: "/analysts", label: "Analysts" },
      { href: "/opinions", label: "Opinions" },
    ],
  },
  {
    heading: "Markets",
    links: [
      { href: "/pulse", label: "Market Pulse" },
      { href: "/bonds", label: "Bonds" },
    ],
  },
  {
    heading: "Trading",
    links: [
      { href: "/paper-trading", label: "Paper Trading" },
      { href: "/paper-trading/options", label: "Options" },
      { href: "/paper-trading/futures", label: "Futures" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-ink-100 bg-white/60">
      <div className="mx-auto max-w-[1800px] px-4 py-12 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.3fr_repeat(3,0.9fr)]">
          <div className="max-w-xs space-y-3">
            <Link href="/" className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-ink-900 text-sm font-semibold text-white">
                PF
              </div>
              <div>
                <p className="text-sm font-semibold leading-tight text-ink-900">Predict Future</p>
                <p className="text-xs text-ink-400">Analyst Scorecard</p>
              </div>
            </Link>
            <p className="text-sm leading-6 text-ink-500">
              We track what Indian market analysts said in public, grade every call against what actually
              happened, and give you the tools — live markets, instrument research, and India-cost-accurate
              paper trading — to check their work.
            </p>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <div key={column.heading} className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">{column.heading}</p>
              <ul className="space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-ink-600 transition hover:text-ink-900">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 space-y-3 border-t border-ink-100 pt-6">
          <p className="text-xs leading-6 text-ink-400">
            Not investment advice. Predict Future tracks what market analysts said in the press — every call
            links back to its original source — and grades hits and misses factually, so you can judge a track
            record for yourself. Paper Trading is a hypothetical simulator: virtual capital at real, delayed
            market prices, with itemized costs estimated at representative discount-broker rates that may not
            match your real broker. Past paper-trading performance does not guarantee future results.
          </p>
          <p className="text-xs text-ink-300">© {new Date().getFullYear()} Predict Future.</p>
        </div>
      </div>
    </footer>
  );
}
