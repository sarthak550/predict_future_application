/**
 * `?firm=` URL for a given (already-canonicalized) firm display string — the
 * SAME param both the /analysts directory (components/finance/analyst-firm-
 * filter.tsx, app/analysts/page.tsx: `firmFilter = searchParams?.firm`,
 * matched by exact string equality against `analyst.organization`) and the
 * /opinions feed (lib/finance/opinionsQuery.ts's `firm` filter, matched by
 * canonical-organization resolution) read. Any surface linking an analyst's
 * firm elsewhere on the site must produce this same URL shape so the
 * destination is always "every call from this firm," per the founder's ask
 * (2026-08-08): seeing a firm name should lead somewhere, not just be a
 * label seen after clicking into a profile.
 *
 * `basePath` defaults to the global directory (/analysts). Pass "/opinions"
 * from a surface that is ITSELF the /opinions feed (e.g. the analyst column
 * in components/finance/expandable-calls-table.tsx when rendered there) so
 * clicking a firm filters the page the reader is already on instead of
 * navigating away from it — founder ask, 2026-08-08: "the firm based search
 * is available on Analyst page but not on Opinion page."
 */
export function firmHref(organization: string, basePath: "/analysts" | "/opinions" = "/analysts"): string {
  return `${basePath}?firm=${encodeURIComponent(organization)}`;
}
