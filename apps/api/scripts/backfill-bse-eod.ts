/**
 * BSE Expansion Phase 3A (2026-08-12) — bounded backward-walking backfill for
 * BseEodQuote (apps/api/lib/marketMoves/bseBhavcopy.ts's
 * fetchBseEquityEodQuotes). Same "walk archive dates backward, skip missing
 * days gracefully" shape as backfill-bse-index-eod.ts, one data type over.
 *
 * DRY RUN BY DEFAULT (prints what it would do, writes nothing) — pass --live
 * to actually persist, same convention as every other backfill script in
 * this directory.
 *
 * Resumable / idempotent: a session date is skipped as "already have it"
 * only when at least MIN_ROWS_FOR_COMPLETE rows already exist for that exact
 * sessionDate in the DB (cheap COUNT, no network fetch needed). Safe to
 * Ctrl-C and re-run at any time. The dedup filter is applied PER DAY, not
 * once — real listing/delisting/dual-listing-status changes shift BSE-only
 * membership over time (e.g. a stock IPOs on BSE only, then later
 * cross-lists on NSE), so re-deriving membership per session date (rather
 * than a single point-in-time snapshot) is deliberate, not wasted work.
 *
 * Politeness: one request per iteration with a fixed delay between them —
 * matches every other bhavcopy-style backfill in this codebase.
 *
 * Archive depth verified live 2026-08-12: real data at 2025-01-01 and
 * 2024-11-01; the SPA shell (not real data) at 2024-12-01 — BSE's UDiFF
 * migration boundary sits between Nov and Dec 2024, comfortably deeper than
 * the ~1-year default walk below.
 *
 * Usage:
 *   npx tsx scripts/backfill-bse-eod.ts                     # dry run, ~380 calendar days back from today
 *   npx tsx scripts/backfill-bse-eod.ts --live               # actually persist
 *   npx tsx scripts/backfill-bse-eod.ts --live --days=400    # deeper walk
 *   npx tsx scripts/backfill-bse-eod.ts --live --start=2026-06-01  # walk back FROM a specific date instead of today
 */

import { fetchBseEquityEodQuotes, type FetchedBseEodQuote } from "../lib/marketMoves/bseBhavcopy";
import { getIstSessionDate } from "../lib/marketMoves/marketHours";
import { prisma } from "../lib/prisma";

const LIVE = process.argv.includes("--live");

function argValue(flag: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return arg ? arg.slice(flag.length + 3) : null;
}

/** ~1 trading year of BSE sessions — same headroom convention as backfill-bse-index-eod.ts, and well inside the confirmed-live UDiFF archive depth. */
const DEFAULT_CALENDAR_DAYS_BACK = 380;
const CALENDAR_DAYS_BACK = Number(argValue("days")) || DEFAULT_CALENDAR_DAYS_BACK;

const REQUEST_DELAY_MS = 800;
/** A session date is "complete enough" at this row count — well under the ~2,034 BSE-only rows observed live on a normal trading day, but high enough that a genuine partial/error response won't be mistaken for done. */
const MIN_ROWS_FOR_COMPLETE = 200;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function istSessionDateDaysBefore(from: Date, daysAgo: number): Date {
  return new Date(from.getTime() - daysAgo * ONE_DAY_MS);
}

async function alreadyComplete(sessionDate: Date): Promise<boolean> {
  const count = await prisma.bseEodQuote.count({ where: { sessionDate } });
  return count >= MIN_ROWS_FOR_COMPLETE;
}

async function upsertDay(quotes: FetchedBseEodQuote[], sessionDate: Date): Promise<number> {
  const rows = quotes.map((q) => ({
    sessionDate,
    scripCode: q.scripCode,
    tickerSymbol: q.tickerSymbol,
    isin: q.isin,
    companyName: q.companyName,
    securityGroup: q.securityGroup,
    prevClose: q.prevClose,
    close: q.close,
    changePercent: q.changePercent,
    volume: q.volume,
  }));
  const result = await prisma.bseEodQuote.createMany({ data: rows, skipDuplicates: true });
  return result.count;
}

async function main() {
  const startParam = argValue("start");
  const anchor = startParam ? getIstSessionDate(new Date(`${startParam}T12:00:00+05:30`)) : getIstSessionDate();

  console.log(
    `[backfill-bse-eod] ${LIVE ? "LIVE" : "DRY RUN"} — walking back ${CALENDAR_DAYS_BACK} calendar days from ${anchor.toISOString().slice(0, 10)}`
  );
  if (!LIVE) {
    console.log("[backfill-bse-eod] Dry run only — no BseEodQuote rows written. Re-run with --live to persist.");
  }

  let sessionsFetched = 0;
  let sessionsSkippedComplete = 0;
  let sessionsNotPublished = 0;
  let totalRowsWritten = 0;

  for (let daysAgo = 0; daysAgo < CALENDAR_DAYS_BACK; daysAgo++) {
    const sessionDate = istSessionDateDaysBefore(anchor, daysAgo);
    const label = sessionDate.toISOString().slice(0, 10);

    if (LIVE && (await alreadyComplete(sessionDate))) {
      sessionsSkippedComplete++;
      continue;
    }

    const quotes = await fetchBseEquityEodQuotes(sessionDate).catch((err: unknown) => {
      console.error(`[backfill-bse-eod] ${label} fetch threw unexpectedly:`, err);
      return null;
    });

    if (!quotes) {
      sessionsNotPublished++;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    sessionsFetched++;
    if (LIVE) {
      const written = await upsertDay(quotes, sessionDate);
      totalRowsWritten += written;
      console.log(`[backfill-bse-eod] ${label}: ${quotes.length} BSE-only rows fetched, ${written} written`);
    } else {
      console.log(`[backfill-bse-eod] ${label}: ${quotes.length} BSE-only rows would be written (dry run)`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log(
    `[backfill-bse-eod] done — sessions with data: ${sessionsFetched}, skipped (already complete): ${sessionsSkippedComplete}, no session/not published: ${sessionsNotPublished}, total rows written: ${LIVE ? totalRowsWritten : "0 (dry run)"}`
  );
}

main()
  .catch((err) => {
    console.error("[backfill-bse-eod] fatal error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
