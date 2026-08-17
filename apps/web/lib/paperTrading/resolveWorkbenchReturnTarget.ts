/**
 * Validates the `?return=` deep-link param the "expand chart to workbench"
 * button (`components/finance/chart-expand-to-workbench-button.tsx`) attaches
 * to its `/paper-trading?...` link — Workstream E of the Workbench Symbol
 * Panel + Return-Minimize brief (2026-08-17): minimizing a workbench opened
 * from an instrument page should return there instead of landing on the bare
 * Paper Trading dashboard.
 *
 * Deliberately a SIBLING of `lib/auth/resolveRedirectTarget.ts`, not a reuse
 * of it — same underlying security property (same-origin relative path only,
 * `//` protocol-relative rejected, so this can never become an open
 * redirect) but a narrower acceptable-path set: `resolveRedirectTarget`
 * accepts ANY same-origin relative path (post-sign-in `callbackUrl`) and
 * falls back to `"/"` when invalid; this validator accepts ONLY the strict
 * `/instruments/<symbol>` shape (a single path segment, no further slashes,
 * no query/hash smuggled in) and has no safe generic fallback worth
 * inventing — an invalid or missing `return` resolves to `null`, meaning
 * "do nothing new," never a forced redirect.
 */
const INSTRUMENT_RETURN_PATH_PATTERN = /^\/instruments\/[^/?#]+$/;

export function resolveWorkbenchReturnTarget(returnParam: string | null | undefined): string | null {
  if (!returnParam) return null;
  return INSTRUMENT_RETURN_PATH_PATTERN.test(returnParam) ? returnParam : null;
}
