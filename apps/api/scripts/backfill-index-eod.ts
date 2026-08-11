/**
 * Index History Stage 2 (2026-08-11) — bounded backward-walking backfill for
 * IndexEodQuote (apps/api/lib/marketMoves/indexEod.ts's fetchIndexEodQuotes).
 * Same "walk archive dates backward, skip missing files gracefully" shape as
 * the cron route needs to run once per day going forward; this script gets
 * ~1 YEAR of history in before the cron ever ran.
 *
 * DRY RUN BY DEFAULT (prints what it would do, writes nothing) — pass --live
 * to actually persist, same convention as backfill-instrument-alias.ts.
 *
 * Resumable / idempotent: for each candidate session date, if EVERY index
 * name already ingested for the LATEST day this script has seen isn't a
 * reliable resume marker (index membership can shift day to day), so instead
 * this script checks per-DATE completion directly — a session date is
 * skipped as "already have it" only when at least MIN_ROWS_FOR_COMPLETE rows
 * already exist for that exact sessionDate in the DB (cheap COUNT, no
 * network fetch needed for already-backfilled days). Safe to Ctrl-C and
 * re-run at any time; already-written days are skipped fast, never
 * re-fetched or re-upserted.
 *
 * Politeness: one request per iteration with a fixed delay between them
 * (REQUEST_DELAY_MS) — this is a ~250-iteration walk over a single archives
 * host, not a burst; matches the "polite pacing" instruction in the assigning
 * brief. Weekends/holidays 404 immediately and cost only the delay, no retry
 * storm.
 *
 * Usage:
 *   npx tsx scripts/backfill-index-eod.ts                # dry run, ~250 sessions back from today
 *   npx tsx scripts/backfill-index-eod.ts --live          # actually persist
 *   npx tsx scripts/backfill-index-eod.ts --live --days=400   # deeper walk
 *   npx tsx scripts/backfill-index-eod.ts --live --start=2026-06-01  # walk back FROM a specific date instead of today
 */

import { fetchIndexEodQuotes, type FetchedIndexEodQuote } from "../lib/marketMoves/indexEod";
import { getIstSessionDate } from "../lib/marketMoves/marketHours";
import { prisma } from "../lib/prisma";

const LIVE = process.argv.includes("--live");

function argValue(flag: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return arg ? arg.slice(flag.length + 3) : null;
}

/** ~1 trading year of NSE sessions (250 trading days/year, walked over CALENDAR days including weekends/holidays that will just 404 fast). */
const DEFAULT_CALENDAR_DAYS_BACK = 380; // headroom over 250 trading days for weekends+holidays
const CALENDAR_DAYS_BACK = Number(argValue("days")) || DEFAULT_CALENDAR_DAYS_BACK;

const REQUEST_DELAY_MS = 600;
/** A session date already has "complete enough" data if at least this many index rows exist — well under the ~164 full universe (a partial historical file, or NSE's own list being slightly smaller on an older date, shouldn't force a re-fetch). */
const MIN_ROWS_FOR_COMPLETE = 50;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** IST-midnight-as-UTC session Date for `daysAgo` calendar days before `from`. Mirrors getIstSessionDate's own convention (see marketHours.ts) applied to an arbitrary date instead of "now". */
function istSessionDateDaysBefore(from: Date, daysAgo: number): Date {
  return new Date(from.getTime() - daysAgo * ONE_DAY_MS);
}

async function alreadyComplete(sessionDate: Date): Promise<boolean> {
  const count = await prisma.indexEodQuote.count({ where: { sessionDate } });
  return count >= MIN_ROWS_FOR_COMPLETE;
}

async function upsertDay(quotes: FetchedIndexEodQuote[], sessionDate: Date): Promise<number> {
  const rows = quotes.map((q) => ({
    sessionDate,
    indexName: q.indexName,
    open: q.open,
    high: q.high,
    low: q.low,
    close: q.close,
    changeAbs: q.changeAbs,
    changePercent: q.changePercent,
    volume: q.volume,
    turnoverCr: q.turnoverCr,
    peRatio: q.peRatio,
    pbRatio: q.pbRatio,
    dividendYield: q.dividendYield,
  }));
  const result = await prisma.indexEodQuote.createMany({ data: rows, skipDuplicates: true });
  return result.count;
}

async function main() {
  const startParam = argValue("start");
  const anchor = startParam ? getIstSessionDate(new Date(`${startParam}T12:00:00+05:30`)) : getIstSessionDate();

  console.log(
    `[backfill-index-eod] ${LIVE ? "LIVE" : "DRY RUN"} — walking back ${CALENDAR_DAYS_BACK} calendar days from ${anchor.toISOString().slice(0, 10)}`
  );
  if (!LIVE) {
    console.log("[backfill-index-eod] Dry run only — no IndexEodQuote rows written. Re-run with --live to persist.");
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

    const quotes = await fetchIndexEodQuotes(sessionDate).catch((err: unknown) => {
      console.error(`[backfill-index-eod] ${label} fetch threw unexpectedly:`, err);
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
      console.log(`[backfill-index-eod] ${label}: ${quotes.length} rows fetched, ${written} written`);
    } else {
      console.log(`[backfill-index-eod] ${label}: ${quotes.length} rows would be written (dry run)`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log(
    `[backfill-index-eod] done — sessions with data: ${sessionsFetched}, skipped (already complete): ${sessionsSkippedComplete}, no session/not published: ${sessionsNotPublished}, total rows written: ${LIVE ? totalRowsWritten : "0 (dry run)"}`
  );
}

main()
  .catch((err) => {
    console.error("[backfill-index-eod] fatal error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
