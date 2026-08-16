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
import { ArrowUpRight, ChevronDown, Share2 } from "lucide-react";
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
import { firmHref } from "@/lib/finance/firmLink";
import { PaperTradeCta } from "@/components/finance/paper-trade-cta";
import { SaveOpinionButton } from "@/components/finance/save-opinion-button";
import { TakeASide } from "@/components/finance/take-a-side";

export type ExpandableCall = {
  id: string;
  quote: string;
  headline: string | null;
  instrument: string | null;
  /** Yahoo Finance ticker, e.g. "RELIANCE.NS" — feeds the "Paper trade this call" CTA (see components/finance/paper-trade-cta.tsx). Null/index/non-NSE tickers hide the CTA. */
  instrumentTicker: string | null;
  /** Bare symbol for /instruments/[symbol] (e.g. "RELIANCE", "NIFTY") — set only when that page would actually resolve (lib/finance/instrumentLink.ts). Absent → the Instrument cell renders as plain text, never a link that could 404. Callers on the instrument's OWN page should leave this undefined for every row (every row would otherwise self-link to the page the reader is already on). */
  instrumentPageSymbol?: string | null;
  direction: OpinionDirection;
  sourceUrl: string;
  publishedAtLabel: string;
  resolutionStatus: OpinionResolutionStatus;
  resolutionNote: string | null;
  resolvedAtLabel: string | null;
  /** Present only when the table is rendering calls from more than one analyst. */
  analyst?: { name: string; slug: string | null; organization?: string };
};

const QUOTE_PREVIEW_LENGTH = 120;

export function ExpandableCallsTable({
  calls,
  firmLinkBasePath = "/analysts",
}: {
  calls: ExpandableCall[];
  /**
   * Where the Analyst column's firm link points. Defaults to the global
   * /analysts directory (used by /instruments/[symbol] and the analyst
   * profile page). /opinions passes "/opinions" instead so clicking a firm
   * filters the feed the reader is already on rather than navigating away
   * from it — founder ask, 2026-08-08 (see lib/finance/firmLink.ts).
   */
  firmLinkBasePath?: "/analysts" | "/opinions";
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Saved Opinions (Ticket 3): ONE batch fetch of the signed-in user's saved
  // set for the whole table, not a per-row mount-fetch — see
  // save-opinion-button.tsx's own doc comment for the N+1 rationale. Starts
  // empty; every row's SaveOpinionButton re-syncs once this resolves.
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const showAnalystColumn = calls.some((call) => call.analyst);
  const columnCount = showAnalystColumn ? 7 : 6;
  const searchParams = useSearchParams();
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());

  useEffect(() => {
    let cancelled = false;

    // Saved Opinions (Ticket 3): ONE batch fetch of the signed-in user's
    // saved set for the whole table, sharing this same mount effect rather
    // than a second one — see save-opinion-button.tsx's doc comment for the
    // N+1-per-row rationale this avoids.
    fetch("/api/finance/opinions/saved-ids")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { ids: string[] } | null) => {
        if (!cancelled && data) setSavedIds(new Set(data.ids));
      })
      .catch(() => {
        // Offline — leave savedIds empty, every row's icon renders unsaved
        // until a real click (the route already degrades signed-out to []).
      });

    const targetId = searchParams.get("call");
    if (!targetId || !calls.some((call) => call.id === targetId)) {
      return () => {
        cancelled = true;
      };
    }

    setOpenId(targetId);
    // Wait a tick for the expanded panel row to mount before scrolling to it.
    const raf = requestAnimationFrame(() => {
      rowRefs.current.get(targetId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
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
          {/* Mobile (<sm): Direction + Date columns hide entirely (QA
              2026-08-16: at 390px the fixed percentage columns overflowed
              ~80px, pushing the Save/Share icons fully off-screen — the
              feature's main mobile surface was undiscoverable). Both hidden
              values still live in each row's own expanded panel, which is
              the designed mobile reading surface anyway. Header and body
              cells must hide in lockstep or table-fixed misaligns. */}
          <TableRow>
            <TableHeaderCell className={showAnalystColumn ? "w-[38%] sm:w-[38%]" : "w-[40%] sm:w-[46%]"}>Call</TableHeaderCell>
            {showAnalystColumn && <TableHeaderCell className="w-[15%] sm:w-[13%]">Analyst</TableHeaderCell>}
            <TableHeaderCell className="w-[15%] sm:w-[12%]">Instrument</TableHeaderCell>
            <TableHeaderCell className="hidden w-[10%] sm:table-cell">Direction</TableHeaderCell>
            <TableHeaderCell className="hidden w-[10%] sm:table-cell">Date</TableHeaderCell>
            <TableHeaderCell className="w-[16%] sm:w-[10%]">Verdict</TableHeaderCell>
            {/* "Actions", not "Source" — the cell has held source + share +
                save since 2026-08-16; on mobile the Source TEXT link folds
                into the expanded panel (it's already there) and only the
                icons render, so the freed width keeps them on-screen. */}
            <TableHeaderCell className="w-[18%] sm:w-[7%]">Actions</TableHeaderCell>
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
                      {call.analyst?.organization && (
                        <Link
                          href={firmHref(call.analyst.organization, firmLinkBasePath)}
                          onClick={(e) => e.stopPropagation()}
                          className="block truncate text-xs text-ink-400 hover:underline"
                        >
                          {call.analyst.organization}
                        </Link>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="pr-3 text-ink-600">
                    {call.instrumentPageSymbol ? (
                      <Link
                        href={`/instruments/${call.instrumentPageSymbol}`}
                        onClick={(e) => e.stopPropagation()}
                        className="block break-words font-medium text-ink-700 hover:text-signal-sky hover:underline"
                      >
                        {call.instrument ?? call.instrumentPageSymbol}
                      </Link>
                    ) : (
                      <span className="block break-words">{call.instrument ?? "—"}</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <DirectionChip direction={call.direction} />
                  </TableCell>
                  <TableCell className="hidden text-ink-500 sm:table-cell">
                    {call.publishedAtLabel}
                  </TableCell>
                  <TableCell>
                    <VerdictBadge status={call.resolutionStatus} />
                  </TableCell>
                  <TableCell>
                    {/* Founder 2026-08-16 ("the table is so cluttered"): the
                        Actions cell is three UNIFORM icons — source / save /
                        share — no text links competing with them. The full
                        "Read the original article" text link still lives in
                        every row's expanded panel. */}
                    {/* flex-wrap: on narrow mobile cells the three icons wrap
                        to a second line inside the cell instead of overflowing
                        the table horizontally (measured 16-25px overflow at
                        390px without it). Desktop fits one line. */}
                    <span className="inline-flex flex-wrap items-center gap-2 sm:gap-3">
                      <a
                        href={call.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Read the original article"
                        title="Read the original article"
                        className="text-ink-400 transition hover:text-signal-sky"
                      >
                        <ArrowUpRight className="h-4 w-4" />
                      </a>
                      {/* Save this call (Saved Opinions brief) — every row, pending
                          included: unlike Share2 below (gated on isGraded because
                          /calls/[id] has nothing to show for an ungraded call), a
                          save is just a bookmark row and has no such constraint. */}
                      <SaveOpinionButton opinionId={call.id} initialSaved={savedIds.has(call.id)} />
                      {/* Founder 2026-08-15: the share affordance was buried as a
                          text link inside the EXPANDED panel only — invisible
                          without clicking a row open. Graded calls now carry a
                          row-level share icon straight to the /calls/[id] share
                          page (which owns the native/WhatsApp/Twitter kit).
                          Graded-only: /calls redirects ungraded calls anyway. */}
                      {isGraded && (
                        <Link
                          href={`/calls/${call.id}`}
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Share this call"
                          title="Share this call"
                          className="text-ink-400 transition hover:text-signal-sky"
                        >
                          <Share2 className="h-4 w-4" />
                        </Link>
                      )}
                    </span>
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
