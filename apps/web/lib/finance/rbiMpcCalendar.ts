/**
 * RBI Monetary Policy Committee (MPC) meeting calendar.
 *
 * Founder ask 2026-08-12: mobile used to show "next RBI policy change" dates
 * (its "Rates & Events" / "Policy calendar" pill in finance-mode.tsx), missing
 * on web. Investigated mobile's actual implementation before porting it: that
 * pill is NOT a hardcoded schedule — it's driven by admin-created prediction-
 * market "flagship events" (`ApiFlagshipEvent`, types RBI/BUDGET/GST/GLOBAL/
 * FED/OTHER), i.e. it only shows a date when an admin has manually built an
 * RBI-decision poll for that meeting. That system is tied to the poll/market
 * feature the founder has deprioritized (see "AI news polls cut" / "Analyst
 * Scorecard pivot" history) and would show NOTHING on a quiet day with no
 * admin-authored poll — not a real substitute for "when's the next rate
 * decision". So this is a fresh, small, hand-maintained module instead: RBI is
 * legally required (Section 45ZI, RBI Act 1934) to publish each fiscal year's
 * full 6-meeting calendar in advance (usually announced in March, ahead of the
 * April-start fiscal year) — a genuinely authoritative, citable source, unlike
 * a scrape target. This differs from `rbiRates.ts`'s live-scraped CURRENT
 * rates (which only change ON a decision day and can't be pre-published) —
 * this file is the pre-published SCHEDULE of when the next change might be
 * announced, not a rate value itself.
 *
 * Mobile's calendar also never carried inflation-print or other macro-release
 * dates (no such event type exists in EVENT_TYPE_COLORS) — per the standing
 * honesty rule, this module stays scoped to what was verified to exist:
 * MPC meeting dates only. Do not add CPI/GDP/Budget print dates here without
 * an equally authoritative, citable source.
 *
 * FY 2026-27 calendar announced 2026-03-23, cross-checked against two
 * independent reports of the same RBI release (both list identical dates):
 *   - https://upstox.com/news/market-news/latest-updates/rbi-releases-mpc-calendar-for-fy-27-check-next-monetary-policy-date-and-full-schedule/article-191134/
 *   - https://www.angelone.in/news/economy/rbi-releases-mpc-meeting-calendar-for-fy27-what-you-need-to-know
 *
 * HONESTY RULE: only officially-announced dates go in this file. Never
 * extrapolate/project a future fiscal year's dates from the historical
 * bi-monthly cadence — RBI's own meeting-to-meeting gaps aren't perfectly
 * regular, and Section 45ZI compliance means the real announcement is always
 * worth waiting for instead of guessing.
 *
 * ANNUAL UPDATE CHORE: RBI typically announces the next fiscal year's
 * calendar in mid-to-late March. Once `getUpcomingMpcMeetings()` starts
 * returning an empty array (all FY2026-27 meetings have passed — i.e. from
 * 2027-02-06 onward), append the FY2027-28 calendar to `MPC_CALENDAR` below
 * as soon as RBI publishes it and update `MPC_CALENDAR_SOURCE`. Until then
 * the UI is designed to degrade to an honest "not yet announced" state — see
 * `PolicyCalendarCard` in components/finance/economy-section.tsx.
 */

export type MpcMeeting = {
  /** 1-6, this fiscal year's meeting sequence. */
  seq: number;
  fiscalYear: string;
  /** First day of the 3-day meeting, IST calendar date (YYYY-MM-DD). */
  startDate: string;
  /** Last day of the 3-day meeting — the policy decision is announced this day, IST calendar date (YYYY-MM-DD). */
  decisionDate: string;
};

const MPC_CALENDAR: MpcMeeting[] = [
  { seq: 1, fiscalYear: "FY2026-27", startDate: "2026-04-06", decisionDate: "2026-04-08" },
  { seq: 2, fiscalYear: "FY2026-27", startDate: "2026-06-03", decisionDate: "2026-06-05" },
  { seq: 3, fiscalYear: "FY2026-27", startDate: "2026-08-03", decisionDate: "2026-08-05" },
  { seq: 4, fiscalYear: "FY2026-27", startDate: "2026-10-05", decisionDate: "2026-10-07" },
  { seq: 5, fiscalYear: "FY2026-27", startDate: "2026-12-02", decisionDate: "2026-12-04" },
  { seq: 6, fiscalYear: "FY2026-27", startDate: "2027-02-03", decisionDate: "2027-02-05" },
];

export const MPC_CALENDAR_SOURCE = {
  fiscalYear: "FY2026-27",
  announcedOn: "2026-03-23",
  legalBasis: "Section 45ZI, RBI Act 1934",
  citationUrl:
    "https://upstox.com/news/market-news/latest-updates/rbi-releases-mpc-calendar-for-fy-27-check-next-monetary-policy-date-and-full-schedule/article-191134/",
};

/** IST calendar date (YYYY-MM-DD) for an instant — same +5:30 offset convention apps/mobile's finance-mode.tsx uses for its own IST day-boundary math. */
function istDateOnly(d: Date): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Meetings whose decision date has not yet passed (IST calendar date),
 * ascending. Pure/no I/O — safe to call directly from a server component's
 * render with zero added cost to the page's data-fetching Promise.all.
 */
export function getUpcomingMpcMeetings(now: Date = new Date()): MpcMeeting[] {
  const todayIst = istDateOnly(now);
  return MPC_CALENDAR.filter((m) => m.decisionDate >= todayIst).sort((a, b) =>
    a.decisionDate.localeCompare(b.decisionDate)
  );
}

/** Whole-day distance (IST calendar days) from `now` to `dateStr` (YYYY-MM-DD). Both sides pinned to UTC midnight of their respective calendar date, so this is a pure calendar-day diff, immune to DST/local-tz drift. */
export function daysUntil(dateStr: string, now: Date = new Date()): number {
  const todayIst = istDateOnly(now);
  const a = new Date(`${todayIst}T00:00:00Z`).getTime();
  const b = new Date(`${dateStr}T00:00:00Z`).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

/** "Today" / "Tomorrow" / "in N days" — mirrors mobile's getCountdownLabel cadence for the same kind of event countdown. */
export function countdownLabel(dateStr: string, now: Date = new Date()): string {
  const days = daysUntil(dateStr, now);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}
