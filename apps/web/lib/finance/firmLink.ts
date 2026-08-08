/**
 * Canonical /analysts?firm= URL for a given (already-canonicalized) firm
 * display string — the SAME `?firm=` param the directory's dropdown filter
 * reads (components/finance/analyst-firm-filter.tsx, app/analysts/page.tsx:
 * `firmFilter = searchParams?.firm`, matched by exact string equality
 * against `analyst.organization`). Any surface linking an analyst's firm
 * elsewhere on the site must produce this same URL shape so the destination
 * is always "every analyst from this firm," per the founder's ask
 * (2026-08-08): seeing a firm name should lead somewhere, not just be a
 * label seen after clicking into a profile.
 */
export function firmHref(organization: string): string {
  return `/analysts?firm=${encodeURIComponent(organization)}`;
}
