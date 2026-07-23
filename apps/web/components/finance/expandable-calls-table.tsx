"use client";

/**
 * Expandable "Recent calls" table for the public analyst profile page.
 *
 * Each row toggles an inline detail panel (full quote, headline, verdict +
 * resolution note, dates, source link) instead of navigating. Rationale:
 * /calls/[id] only exists as a share artifact for GRADED calls — it redirects
 * PENDING/NOT_GRADED back to the profile, so linking every row there made
 * clicks on ungraded calls look like dead links. Graded rows still offer a
 * "Share this call" link to /calls/[id] inside the expanded panel.
 *
 * Dates arrive preformatted as strings — the server component owns formatting
 * so this stays a purely presentational client component.
 *
 * The `analyst` field is optional: the analyst-profile page (where every row
 * already belongs to the one profile being viewed) omits it, while /opinions
 * (a cross-analyst feed) supplies it to render an extra column linking to
 * /analysts/[slug].
 *
 * Return-to-call (Phase C.1): TakeASide's signed-out CTA links to
 * /sign-in?callbackUrl=<this page>&call=<id>. On landing back here, this
 * component reads ?call= from the URL, auto-expands that row, and scrolls it
 * into view — so a user who signed in specifically to vote on one call isn't
 * dropped back at the top of a long table.
 */

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { OpinionDirection, OpinionResolutionStatus } from "@prisma/client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { DirectionChip, VerdictBadge } from "@/components/finance/analyst-badges";
import { PaperTradeCta } from "@/components/finance/paper-trade-cta";
import { TakeASide } from "@/components/finance/take-a-side";

export type ExpandableCall = {
  id: string;
  quote: string;
  headline: string | null;
  instrument: string | null;
  /** Yahoo Finance ticker, e.g. "RELIANCE.NS" — feeds the "Paper trade this call" CTA (see components/finance/paper-trade-cta.tsx). Null/index/non-NSE tickers hide the CTA. */
  instrumentTicker: string | null;
  direction: OpinionDirection;
  sourceUrl: string;
  publishedAtLabel: string;
  resolutionStatus: OpinionResolutionStatus;
  resolutionNote: string | null;
  resolvedAtLabel: string | null;
  /** Present only when the table is rendering calls from more than one analyst. */
  analyst?: { name: string; slug: string | null };
};

const QUOTE_PREVIEW_LENGTH = 120;

export function ExpandableCallsTable({ calls }: { calls: ExpandableCall[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const showAnalystColumn = calls.some((call) => call.analyst);
  const columnCount = showAnalystColumn ? 7 : 6;
  const searchParams = useSearchParams();
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());

  useEffect(() => {
    const targetId = searchParams.get("call");
    if (!targetId || !calls.some((call) => call.id === targetId)) return;

    setOpenId(targetId);
    // Wait a tick for the expanded panel row to mount before scrolling to it.
    const raf = requestAnimationFrame(() => {
      rowRefs.current.get(targetId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(raf);
    // Only ever react to the initial ?call= on load, not every searchParams change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="overflow-x-auto">
      {/* table-fixed: every column gets an explicit width so no cell's content
          (e.g. a long analyst name) can stretch its column and squeeze the
          Call quote — long values wrap onto multiple lines within their column. */}
      <Table className="table-fixed">
        <TableHead>
          <TableRow>
            <TableHeaderCell className={showAnalystColumn ? "w-[38%]" : "w-[46%]"}>Call</TableHeaderCell>
            {showAnalystColumn && <TableHeaderCell className="w-[13%]">Analyst</TableHeaderCell>}
            <TableHeaderCell className="w-[12%]">Instrument</TableHeaderCell>
            <TableHeaderCell className="w-[10%]">Direction</TableHeaderCell>
            <TableHeaderCell className="w-[10%]">Date</TableHeaderCell>
            <TableHeaderCell className="w-[10%]">Verdict</TableHeaderCell>
            <TableHeaderCell className="w-[7%]">Source</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {calls.map((call) => {
            const isOpen = openId === call.id;
            const isGraded =
              call.resolutionStatus === "RESOLVED_HIT" || call.resolutionStatus === "RESOLVED_MISS";
            const needsTruncation = call.quote.length > QUOTE_PREVIEW_LENGTH;

            return (
              <Fragment key={call.id}>
                <TableRow
                  className="cursor-pointer select-none"
                  onClick={() => setOpenId(isOpen ? null : call.id)}
                  aria-expanded={isOpen}
                >
                  <TableCell className="pr-4">
                    <span className="inline-flex items-start gap-1.5 text-ink-700">
                      <ChevronDown
                        className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                      />
                      {/* Always show the short preview — the expanded panel below
                          owns the full quote, so un-truncating here would render
                          the same text twice. */}
                      <span>
                        &ldquo;
                        {needsTruncation
                          ? `${call.quote.slice(0, QUOTE_PREVIEW_LENGTH)}…`
                          : call.quote}
                        &rdquo;
                      </span>
                    </span>
                  </TableCell>
                  {showAnalystColumn && (
                    <TableCell className="pr-3">
                      {call.analyst?.slug ? (
                        <Link
                          href={`/analysts/${call.analyst.slug}`}
                          onClick={(e) => e.stopPropagation()}
                          className="block break-words font-medium text-ink-700 hover:text-signal-sky hover:underline"
                        >
                          {call.analyst.name}
                        </Link>
                      ) : (
                        <span className="block break-words text-ink-600">
                          {call.analyst?.name ?? "—"}
                        </span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="pr-3 text-ink-600">
                    <span className="block break-words">{call.instrument ?? "—"}</span>
                  </TableCell>
                  <TableCell>
                    <DirectionChip direction={call.direction} />
                  </TableCell>
                  <TableCell className="text-ink-500">
                    {call.publishedAtLabel}
                  </TableCell>
                  <TableCell>
                    <VerdictBadge status={call.resolutionStatus} />
                  </TableCell>
                  <TableCell>
                    <a
                      href={call.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-signal-sky hover:underline"
                    >
                      Source
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  </TableCell>
                </TableRow>

                {isOpen ? (
                  <TableRow
                    className="bg-ink-50/50"
                    ref={(el) => {
                      if (el) rowRefs.current.set(call.id, el);
                      else rowRefs.current.delete(call.id);
                    }}
                  >
                    <TableCell colSpan={columnCount} className="px-6 py-4">
                      <div className="space-y-3 text-sm">
                        {call.headline ? (
                          <p className="font-medium text-ink-900">{call.headline}</p>
                        ) : null}
                        <blockquote className="border-l-2 border-ink-200 pl-3 italic text-ink-700">
                          &ldquo;{call.quote}&rdquo;
                        </blockquote>
                        {isGraded && call.resolutionNote ? (
                          <p className="text-ink-600">
                            <span className="font-medium text-ink-800">How it resolved: </span>
                            {call.resolutionNote}
                            {call.resolvedAtLabel ? (
                              <span className="text-ink-500"> ({call.resolvedAtLabel})</span>
                            ) : null}
                          </p>
                        ) : null}
                        {!isGraded ? (
                          <p className="text-ink-500">
                            {call.resolutionStatus === "PENDING"
                              ? "This call hasn't reached its evaluation window yet — the verdict will appear here once it's graded."
                              : "This call couldn't be objectively graded against market data."}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-4 pt-1">
                          <a
                            href={call.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-signal-sky hover:underline"
                          >
                            Read the original article
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </a>
                          {isGraded ? (
                            <Link
                              href={`/calls/${call.id}`}
                              className="inline-flex items-center gap-1 text-signal-sky hover:underline"
                            >
                              Share this call
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            </Link>
                          ) : null}
                        </div>
                        <TakeASide opinionId={call.id} resolutionStatus={call.resolutionStatus} />
                        <PaperTradeCta opinionId={call.id} direction={call.direction} instrumentTicker={call.instrumentTicker} />
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
