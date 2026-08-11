/**
 * Bonds informational-layer historical backfill (2026-08-12) — founder:
 * "there are no price history for bonds". BondEodQuote only started accruing
 * when the Bonds feature shipped (2026-07-26) — no backfill was ever run, so
 * /bonds/[symbol]'s spark chart has at most a handful of sessions in prod.
 * This script gets ~1 YEAR of history in, mirroring backfill-index-eod.ts's
 * bounded backward archive walk exactly (same shape, same politeness/resume
 * conventions) — see that script's doc comment for the full rationale.
 *
 * Row shape/parsing is NOT reimplemented here: this script calls
 * `fetchBhavcopyBonds` (lib/marketMoves/bhavcopy.ts), the exact same
 * fetch + DATE1-validate + parse + shapeBonds path the live EOD cron
 * (app/api/cron/market-moves-movers/route.ts) uses every day — so a
 * backfilled row is byte-for-byte what the daily pass would have written for
 * that session, including bondName.ts's GS/GB displayName derivation.
 *
 * DRY RUN BY DEFAULT (prints what it would do, writes nothing) — pass --live
 * to actually persist, same convention as backfill-index-eod.ts /
 * backfill-instrument-alias.ts.
 *
 * Resumable / idempotent: a session date is skipped as "already have it"
 * only when at least MIN_ROWS_FOR_COMPLETE BondEodQuote rows already exist
 * for that exact sessionDate (cheap COUNT, no network fetch needed for
 * already-backfilled days). Safe to Ctrl-C and re-run at any time. Unlike
 * the live cron's upsertBonds (a true upsert that recomputes displayName
 * every run so a parser fix retroactively relabels history), this script
 * uses createMany/skipDuplicates: a date that already has
 * MIN_ROWS_FOR_COMPLETE rows is skipped entirely (never re-fetched), so
 * re-running after a bondName.ts improvement will NOT relabel already-backfilled
 * rows — re-run the live cron's upsert path (or a dedicated relabel script)
 * for that; this script's job is purely to fill in missing history once.
 *
 * No fixed symbol universe is assumed: bond listings change over a year
 * (SGB tranches mature, new G-Secs get issued) and BondEodQuote's unique key
 * is (sessionDate, symbol), so each session's fetched rows are upserted
 * as-is regardless of which symbols appear.
 *
 * Politeness: one request per iteration with a fixed delay
 * (REQUEST_DELAY_MS) between them — same ~380-iteration walk over the same
 * single archives host backfill-index-eod.ts already walks; weekends/
 * holidays 404 immediately (via fetchBhavcopyBonds -> fetchBhavcopyRows's
 * DATE1 validation) and cost only the delay, no retry storm.
 *
 * Usage:
 *   npx tsx scripts/backfill-bond-eod.ts                      # dry run, ~380 calendar days back from today
 *   npx tsx scripts/backfill-bond-eod.ts --live                # actually persist
 *   npx tsx scripts/backfill-bond-eod.ts --live --days=400      # deeper walk
 *   npx tsx scripts/backfill-bond-eod.ts --live --start=2026-06-01  # walk back FROM a specific date instead of today
 */

import { fetchBhavcopyBonds, type FetchedBondQuote } from "../lib/marketMoves/bhavcopy";
import { getIstSessionDate } from "../lib/marketMoves/marketHours";
import { prisma } from "../lib/prisma";

const LIVE = process.argv.includes("--live");

function argValue(flag: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return arg ? arg.slice(flag.length + 3) : null;
}

/** ~1 trading year of NSE sessions (250 trading days/year, walked over CALENDAR days including weekends/holidays that will just 404 fast) — same headroom as backfill-index-eod.ts. */
const DEFAULT_CALENDAR_DAYS_BACK = 380;
const CALENDAR_DAYS_BACK = Number(argValue("days")) || DEFAULT_CALENDAR_DAYS_BACK;

const REQUEST_DELAY_MS = 600;

/**
 * A session date already has "complete enough" data if at least this many
 * bond rows exist. GS+GB together run ~89 rows/day in the current feed
 * (bhavcopy.ts's shapeBonds doc comment: "45+44 rows total"); 50 is well
 * under that full-day count (so a partial historical file or a slightly
 * smaller GS/GB universe on an older date doesn't force a re-fetch) while
 * still being far above what a truncated/broken fetch could plausibly leave
 * behind — the same headroom logic backfill-index-eod.ts uses for its own
 * MIN_ROWS_FOR_COMPLETE=50 against a ~164-row full universe.
 */
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
  const count = await prisma.bondEodQuote.count({ where: { sessionDate } });
  return count >= MIN_ROWS_FOR_COMPLETE;
}

async function upsertDay(bonds: FetchedBondQuote[], sessionDate: Date): Promise<number> {
  const rows = bonds.map((b) => ({
    sessionDate,
    symbol: b.symbol,
    series: b.series,
    displayName: b.displayName,
    prevClose: b.prevClose,
    close: b.close,
    changePercent: b.changePercent,
    volume: Math.round(b.volume),
  }));
  const result = await prisma.bondEodQuote.createMany({ data: rows, skipDuplicates: true });
  return result.count;
}

async function main() {
  const startParam = argValue("start");
  const anchor = startParam ? getIstSessionDate(new Date(`${startParam}T12:00:00+05:30`)) : getIstSessionDate();

  console.log(
    `[backfill-bond-eod] ${LIVE ? "LIVE" : "DRY RUN"} — walking back ${CALENDAR_DAYS_BACK} calendar days from ${anchor.toISOString().slice(0, 10)}`
  );
  if (!LIVE) {
    console.log("[backfill-bond-eod] Dry run only — no BondEodQuote rows written. Re-run with --live to persist.");
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

    const bonds = await fetchBhavcopyBonds(sessionDate).catch((err: unknown) => {
      console.error(`[backfill-bond-eod] ${label} fetch threw unexpectedly:`, err);
      return null;
    });

    if (!bonds) {
      sessionsNotPublished++;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    sessionsFetched++;
    if (LIVE) {
      const written = await upsertDay(bonds, sessionDate);
      totalRowsWritten += written;
      console.log(`[backfill-bond-eod] ${label}: ${bonds.length} rows fetched, ${written} written`);
    } else {
      console.log(`[backfill-bond-eod] ${label}: ${bonds.length} rows would be written (dry run)`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log(
    `[backfill-bond-eod] done — sessions with data: ${sessionsFetched}, skipped (already complete): ${sessionsSkippedComplete}, no session/not published: ${sessionsNotPublished}, total rows written: ${LIVE ? totalRowsWritten : "0 (dry run)"}`
  );
}

main()
  .catch((err) => {
    console.error("[backfill-bond-eod] fatal error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
