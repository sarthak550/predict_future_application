import Link from "next/link";

import { GlobalSymbolSearch } from "@/components/finance/global-symbol-search";
import { NotificationBell } from "@/components/finance/notification-bell";
import { SessionChip } from "@/components/finance/session-chip";

/**
 * Site-wide chrome for every public, unauthenticated, indexable Finance page
 * (app/page.tsx, app/analysts/**, app/opinions/**, app/pulse/**, app/calls/**,
 * app/portfolios/**). These pages render outside the (app) route group /
 * AppShell — that shell now only backs the (admin) console (see
 * components/layout/app-shell.tsx) — so this header needs to work standalone
 * for a signed-out visitor arriving from Google or a shared WhatsApp link.
 */
// Portfolios hidden 2026-07-25 (founder: launch later); Indices directory page
// removed same day (founder: search categories replace it — /indices/[slug]
// detail pages remain as search destinations).
// Methodology is deliberately NOT here (founder 2026-08-15: "methodology
// matters for analysts only" — keep the nav uncrowded). It surfaces
// prominently on /analysts' own header instead, plus the site footer,
// AnalystDisclaimerFooter, and every Low-sample badge.
// Screener IS here (Growth Loop Sprint G4, 2026-08-15) — a deliberate
// exception to the above curation discipline, not an oversight: Methodology
// is a trust/legal page (secondary, one click from where it matters);
// Screener is a primary discovery surface on par with Analysts/Opinions/
// Pulse — it's the USP wedge (graded-call signal no generic screener has),
// so it earns top-nav placement the same way those three did.
const NAV_LINKS = [
  { href: "/analysts", label: "Analysts" },
  { href: "/opinions", label: "Opinions" },
  { href: "/screener", label: "Screener" },
  { href: "/pulse", label: "Market Pulse" },
  { href: "/paper-trading", label: "Paper Trading" },
];

export function PublicHeader() {
  return (
    <header className="relative z-40 border-b border-ink-100 bg-white/70 backdrop-blur">
      {/* Full-width nav (logo left, links right) — content pages keep their own
          narrower max-w containers below; pinning the nav to max-w-5xl made it
          float oddly in the middle over the full-width terminal pages. */}
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-ink-900 text-sm font-semibold text-white">
            PF
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight text-ink-900">Predict Future</p>
            <p className="text-xs text-ink-400">Analyst Scorecard</p>
          </div>
        </Link>

        <div className="min-w-0 flex-1 px-2 sm:px-6">
          <GlobalSymbolSearch />
        </div>

        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-ink-500 transition hover:text-ink-900"
            >
              {link.label}
            </Link>
          ))}
          {/* Self-hides when signed out (see notification-bell.tsx) — safe to
              render unconditionally alongside SessionChip. */}
          <NotificationBell />
          <SessionChip />
        </nav>
      </div>
    </header>
  );
}
