import Link from "next/link";

import { firmHref } from "@/lib/finance/firmLink";

/**
 * An analyst's firm, rendered as a link to every other analyst from that
 * same firm (`/analysts?firm=...`) — pairs with the "Name · Firm" inline
 * sweep across analyst-attribution surfaces (opinion cards, calls tables,
 * the directory, profile headers). Founder ask, 2026-08-08: "what if someone
 * wants to see other analysts of UTI AMC, we do not have any pipeline for
 * that."
 *
 * `linkable=false` renders plain text — used for FIRM-entity ("Market
 * Analysis from X") attributions, where "X" is the whole identity rather
 * than a firm a human analyst belongs to, so there's nothing meaningful to
 * filter to.
 */
export function FirmLink({
  organization,
  linkable = true,
  className,
}: {
  organization: string;
  linkable?: boolean;
  className?: string;
}) {
  if (!linkable) {
    return <span className={className}>{organization}</span>;
  }
  return (
    <Link href={firmHref(organization)} className={className}>
      {organization}
    </Link>
  );
}
