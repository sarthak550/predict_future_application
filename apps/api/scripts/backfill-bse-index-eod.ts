/**
 * BSE Expansion Phase 1 (2026-08-12) — bounded backward-walking backfill for
 * BseIndexEodQuote (apps/api/lib/marketMoves/bseIndexEod.ts's
 * fetchBseIndexEodQuotes). Same "walk archive dates backward, skip missing
 * days gracefully" shape as backfill-index-eod.ts (NSE), one exchange over.
 *
 * DRY RUN BY DEFAULT (prints what it would do, writes nothing) — pass --live
 * to actually persist, same convention as every other backfill script in
 * this directory.
 *
 * Resumable / idempotent: a session date is skipped as "already have it"
 * only when at least MIN_ROWS_FOR_COMPLETE rows already exist for that exact
 * sessionDate in the DB (cheap COUNT, no network fetch needed). Safe to
 * Ctrl-C and re-run at any time.
 *
 * Politeness: one request per iteration with a fixed delay between them
 * (REQUEST_DELAY_MS) — BSE's IndexArchDailyAll endpoint is single-day-only
 * (a multi-day fmdt/todt range was verified live to return an empty Table,
 * see bseIndexEod.ts's module doc), so there is no bulk-range shortcut;
 * this is a genuine day-by-day walk, same as the NSE backfill.
 *
 * Archive depth verified live 2026-08-12: 11-Aug-2025 (94 rows), 12-Aug-2024
 * (68 rows), and 01-Jun-2022 (64 rows) all returned real data — comfortably
 * deeper than the ~1-year default walk below.
 *
 * Usage:
 *   npx tsx scripts/backfill-bse-index-eod.ts                # dry run, ~380 calendar days back from today
 *   npx tsx scripts/backfill-bse-index-eod.ts --live          # actually persist
 *   npx tsx scripts/backfill-bse-index-eod.ts --live --days=400   # deeper walk
 *   npx tsx scripts/backfill-bse-index-eod.ts --live --start=2026-06-01  # walk back FROM a specific date instead of today
 */

import { fetchBseIndexEodQuotes, type FetchedBseIndexEodQuote } from "../lib/marketMoves/bseIndexEod";
import { getIstSessionDate } from "../lib/marketMoves/marketHours";
import { prisma } from "../lib/prisma";

const LIVE = process.argv.includes("--live");

function argValue(flag: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return arg ? arg.slice(flag.length + 3) : null;
}

/** ~1 trading year of BSE sessions, same headroom convention as backfill-index-eod.ts. */
const DEFAULT_CALENDAR_DAYS_BACK = 380;
const CALENDAR_DAYS_BACK = Number(argValue("days")) || DEFAULT_CALENDAR_DAYS_BACK;

const REQUEST_DELAY_MS = 600;
/** A session date is "complete enough" at this row count — well under the ~133 full universe observed live, but high enough that a genuine partial/error response won't be mistaken for done. */
const MIN_ROWS_FOR_COMPLETE = 30;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function istSessionDateDaysBefore(from: Date, daysAgo: number): Date {
  return new Date(from.getTime() - daysAgo * ONE_DAY_MS);
}

async function alreadyComplete(sessionDate: Date): Promise<boolean> {
  const count = await prisma.bseIndexEodQuote.count({ where: { sessionDate } });
  return count >= MIN_ROWS_FOR_COMPLETE;
}

async function upsertDay(quotes: FetchedBseIndexEodQuote[], sessionDate: Date): Promise<number> {
  const rows = quotes.map((q) => ({
    sessionDate,
    indexName: q.indexName,
    open: q.open,
    high: q.high,
    low: q.low,
    close: q.close,
    changeAbs: q.changeAbs,
    changePercent: q.changePercent,
    previousClose: q.previousClose,
    volume: q.volume,
    turnover: q.turnover,
    peRatio: q.peRatio,
    pbRatio: q.pbRatio,
    dividendYield: q.dividendYield,
  }));
  const result = await prisma.bseIndexEodQuote.createMany({ data: rows, skipDuplicates: true });
  return result.count;
}

async function main() {
  const startParam = argValue("start");
  const anchor = startParam ? getIstSessionDate(new Date(`${startParam}T12:00:00+05:30`)) : getIstSessionDate();

  console.log(
    `[backfill-bse-index-eod] ${LIVE ? "LIVE" : "DRY RUN"} — walking back ${CALENDAR_DAYS_BACK} calendar days from ${anchor.toISOString().slice(0, 10)}`
  );
  if (!LIVE) {
    console.log("[backfill-bse-index-eod] Dry run only — no BseIndexEodQuote rows written. Re-run with --live to persist.");
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

    const quotes = await fetchBseIndexEodQuotes(sessionDate).catch((err: unknown) => {
      console.error(`[backfill-bse-index-eod] ${label} fetch threw unexpectedly:`, err);
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
      console.log(`[backfill-bse-index-eod] ${label}: ${quotes.length} rows fetched, ${written} written`);
    } else {
      console.log(`[backfill-bse-index-eod] ${label}: ${quotes.length} rows would be written (dry run)`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log(
    `[backfill-bse-index-eod] done — sessions with data: ${sessionsFetched}, skipped (already complete): ${sessionsSkippedComplete}, no session/not published: ${sessionsNotPublished}, total rows written: ${LIVE ? totalRowsWritten : "0 (dry run)"}`
  );
}

main()
  .catch((err) => {
    console.error("[backfill-bse-index-eod] fatal error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
