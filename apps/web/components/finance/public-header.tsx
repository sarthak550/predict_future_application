import Link from "next/link";

/**
 * Minimal chrome for public, unauthenticated, indexable pages (app/analysts/**,
 * app/calls/**). These pages render outside the (app) route group / AppShell —
 * they need to work for a signed-out visitor arriving from Google or a shared
 * WhatsApp link, so we keep the header to a brand mark + a link back into the app.
 */
export function PublicHeader() {
  return (
    <header className="border-b border-ink-100 bg-white/70 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-ink-900 text-sm font-semibold text-white">
            PF
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight text-ink-900">Predict Future</p>
            <p className="text-xs text-ink-400">Analyst Scorecard</p>
          </div>
        </Link>
        <Link
          href="/analysts"
          className="text-sm font-medium text-ink-500 transition hover:text-ink-900"
        >
          All analysts
        </Link>
      </div>
    </header>
  );
}
