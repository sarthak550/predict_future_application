import Link from "next/link";

/**
 * S74-T4 — links both auth pages to /privacy and /terms. Placed directly
 * under the sign-in/sign-up card (the standard "by continuing you agree..."
 * pattern) rather than a full sitewide footer — these are minimal, centered
 * auth pages, not content pages with SiteFooter's nav columns.
 */
export function AuthLegalFooter() {
  return (
    <p className="mt-6 max-w-md text-center text-xs leading-5 text-ink-400">
      By continuing, you agree to our{" "}
      <Link href="/terms" className="font-medium text-ink-500 underline underline-offset-2 hover:text-ink-700">
        Terms of Service
      </Link>{" "}
      and{" "}
      <Link href="/privacy" className="font-medium text-ink-500 underline underline-offset-2 hover:text-ink-700">
        Privacy Policy
      </Link>
      .
    </p>
  );
}
