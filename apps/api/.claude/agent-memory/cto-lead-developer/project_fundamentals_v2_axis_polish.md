---
name: project_fundamentals_v2_axis_polish
description: Fundamentals Panel v2 founder chart-polish pass — nice-scale axis algorithm, declared-once axis units, auto-sized gutters, §01 height cut, §04 FY23 root-cause confirmed as a Yahoo hard cap
metadata:
  type: project
---

Founder iteration feedback on the shipped Fundamentals v2 (see
[[project_fundamentals_v2_sprint2]] for the section/palette/layout groundwork
this builds on) — five chart-polish fixes, all confined to
`apps/web/components/finance/combo-chart.tsx` and
`apps/web/components/finance/fundamentals-panel.tsx`, zero schema/apps-api
changes, zero instrument-page prop changes.

**§01 height**: `SECTION_H_HERO` 210 -> 170 (fundamentals-panel.tsx), stayed
full-width.

**Nice-scale algorithm (`computeNiceScale` in combo-chart.tsx)**: step drawn
from the 1/2/2.5/5 × 10^k family, domain snapped OUTWARD to whole step
multiples with 0 ALWAYS included (`min0 = Math.min(0, dataMin)`), searched
across a ±2-decade neighborhood of the naive rough-step to land a tick count
in [3,5] closest to a target of 4. Applied to primary AND secondary axes,
and to stacked mode's summed domain (reuses the exact same `primaryValues`
array the Sprint 2 stackedBars fix already computes — no stacked-specific
scale code needed). Verified against real RELIANCE.NS FY23-26 revenue+
netIncome data: old 2-tick scheme showed "₹10.57 L Cr" / "₹5.29 L Cr"
(arbitrary mid); new scheme shows unit "₹ L Cr" declared once + ticks
"0"/"5"/"10"/"15".

**Declared-once axis unit (`AxisFormat` type, exported from combo-chart.tsx)**:
`ComboChartProps.formatPrimaryAxis`/`formatSecondaryAxis` changed from plain
`(v) => string` formatters to FACTORIES `(domainMax) => {unit, tick}` —
combo-chart.tsx calls the factory ONCE per axis with that axis's own
nice-scale max (so the WHOLE axis picks one consistent magnitude band, e.g.
never crosses the lakh/crore boundary mid-axis), renders `unit` once at the
top of the gutter, and calls `tick(v)` per gridline for the short number.
Tooltip formatting (`ComboSeriesDef.formatValue`) is completely untouched —
these factories are axis-gutter-only. Three factories live in
fundamentals-panel.tsx: `makeMoneyAxisFormat(currencyCode)` (mirrors
`formatCompactCurrency`'s INR lakh/crore + USD T/B/M/K thresholds but
un-prefixed, 1dp, trimmed), `makePercentAxisFormat()`, `makeRatioAxisFormat()`.
Every section (§01,02,03,05,06,07) updated to pass these instead of its raw
`fmtMoney`/`fmtRupee`/`fmtPct`/`fmtRatio` formatter for the two axis props —
those raw formatters are UNCHANGED and still used for `s.formatValue`
(tooltip) and `tooltipDetail` strings, so nothing in the tooltip changed.

**Gutter auto-sizing (`computeGutterWidth`/`computeAxisPresentation` in
combo-chart.tsx)**: `LEFT_AXIS_W`/`RIGHT_AXIS_W` fixed constants deleted;
gutter width is now `clamp(maxLabelChars * 5.5 + 8, 28, 64)` viewBox units,
measured from the actual rendered tick+unit strings for THAT axis. A
defensive coarsen-to-3-ticks retry exists for the (unreached in every case
checked) scenario where even the 64-unit cap can't fit a label. This fixed a
REAL, confirmed clipping bug: the old fixed 44-unit left gutter only fit
~6.5 chars, but the old `formatCompactCurrency`-based tick label ("₹10.57 L
Cr", 11 chars) needed ~67 units — verified by direct calculation against
real RELIANCE data.

**§04 "MISSING FY23" root cause — CONFIRMED Yahoo hard-caps annual coverage
at 4 periods, branch chosen: keep the year visible + name it in the
footnote (NOT widen the lookback)**. Live probe 2026-08 against
`fundamentals-timeseries/RELIANCE.NS` with `period1 = now-8y` (vs the
existing 6y `ANNUAL_LOOKBACK_YEARS` in fundamentals.ts) on all 6 annual
balance-sheet keys (`annualTotalRevenue`, `annualNetPPE`,
`annualAccountsReceivable`, `annualInventory`, `annualTotalAssets`,
`annualStockholdersEquity`, `annualCurrentAssets`): STILL exactly 4 points
each, 2023-03-31..2026-03-31 — identical to the 6y result. `fundamentals.ts`
was NOT touched (widening would change nothing; a FY22 point is
categorically unavailable from this endpoint, not merely unrequested at the
current window). On closer trace, `alignByPeriod` + `ComboChart`'s
`categories.map` already rendered the earliest year as a visible x-axis
label with a null-gap line (categories are never data-gated) — the actual
gap was that NEITHER §04 nor §01's revenue-growth line explained WHY in
annual mode (§04 had a generic always-on footnote; §01 had a footnote ONLY
for the quarterly-all-null case). Added
`firstYearGrowthFootnote(periodEndIso)` (fundamentals-panel.tsx) — parses
the fiscal year and its prior year to produce e.g. "FY23 growth needs FY22
filings, which the data source doesn't provide." — wired into §04
unconditionally and into §01 whenever `mode==="annual" && hasGrowth`
(previously silent in that case).

**Axis rendering polish**: gridlines drawn at every nice tick (not just
max/mid) at `#f1f5f9`, EXCEPT whichever tick equals 0 (always present by
construction) which renders at the stronger `#e2e8f0` baseline color instead
of a separately-drawn always-on line. No separate tick marks (chose "none" —
full-width gridlines only, matching the pre-existing research-deck look).
Secondary axis deliberately still has NO gridlines of its own (label-only) —
a second gridline set on the same plot would be visual noise; only its tick
COUNT/spacing was upgraded to nice-scale (2 -> 3-5). `tabular-nums` class
added to all numeric tick `<text>` (unit annotations excluded, they're not
numeric). `PAD_TOP` raised 14 -> 18 to fit the new unit-annotation row above
the topmost gridline.

Gates verified: `tsc --noEmit` clean on apps/web (no packages touched, none
needed touching); `eslint` clean on both touched files; no other file in the
repo imports `ComboChart` (grepped — only fundamentals-panel.tsx does), so
the `formatPrimaryAxis`/`formatSecondaryAxis` signature change (plain
formatter -> factory) has exactly one call site to update and no
instrument-page blast radius. `FundamentalsPanelProps` (the instrument
page's actual contract) was not touched at all.
