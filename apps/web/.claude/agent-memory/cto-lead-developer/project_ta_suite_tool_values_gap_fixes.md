---
name: project_ta_suite_tool_values_gap_fixes
description: Tool-values-gap-fixes brief (2026-08-04) — closed 15 TradingView-parity gaps across measure/fib/gann/pattern tools, incl. cypher's correctness bug. Direct CEO-brief -> CTO -> QA handoff, no sprint-board.
metadata:
  type: project
---

Implemented the CEO's 4-ticket brief closing the 15 real value-display gaps
from the 87-tool audit (`audit_tool_values_gap_matrix.md` /
`cto_assignment_brief_tool_values_gaps.md`, both in the CEO's agent-memory).
Founder's repeat complaint: chart tools "have no utility unless we have them
with the values they show."

**T1** `overlays/measure.ts`: `dateRange`/`datePriceRange` append elapsed
calendar time; `longPosition`/`shortPosition` chip now shows ₹ risk/reward
(the `risk`/`reward` locals already existed, just weren't threaded into the
label — zero new math). **T2** `overlays/fibonacci.ts`: added missing %
labels to `fibFan`(+price)/`fibArc`/`fibCircle`/`fibSpeedResistanceFan`
(grid)/`fibSpeedResistanceArcs`/`fibWedge`, all via `formatUnsignedPercentLabel`
(never `formatPercentLabel` — a fib level has no direction, the `+` prefix
reads wrong). **T3** `overlays/gann.ts`: grid/corner labels on
`gannBox`/`gannSquare`/`gannSquareFixed` via new shared
`formatGannRangeRatioLabel`. **T4** `overlays/patterns.ts`: fixed `cypher`'s
ratio-base formula (correctness bug, not cosmetic — was dividing every leg by
the FIRST leg XA; correct is B=AB/XA, C=BC/AB, D=CD/XC, three DIFFERENT base
legs) and added per-leg ratio labels to `threeDrives` (each leg vs its own
immediately-preceding leg, not one fixed reference).

**Load-bearing discovery — `lib/ta/selfcheck.ts` CAN safely import from
`workbench/overlays/figure-kit.ts`.** `figure-kit.ts`'s only `klinecharts`
import is `import type { Coordinate, OverlayFigure }` — fully type-only, so
esbuild/tsx elides it entirely at compile time and the Node `ta:check`
process never touches the klinecharts runtime. This means any NEW pure
formula this program introduces should be added to `figure-kit.ts` (not
inline in a family file like `patterns.ts`/`gann.ts`, which DO import
`registerOverlay` as a runtime value from klinecharts and would NOT be
Node-safe to import into selfcheck.ts). Verified empirically: `ta:check` went
164 -> 182 (18 new assertions) importing `formatElapsedLabel`,
`computeCypherRatios`, `computeAdjacentLegRatios`, `formatGannRangeRatioLabel`
straight from `figure-kit.ts` with zero runtime issues. This is now the
established pattern for any future overlay-geometry ta:check fixture.

**New figure-kit.ts pure helpers** (all with hand-worked-example doc
comments): `formatElapsedLabel(ms)` — own bucket convention since TV's exact
string isn't literally quoted: <1d→"Nh", 1-7d→"Nd" (7 days deliberately stays
"7d" not "1w" — boundary is `abs <= WEEK` on the day branch), 8-59d→"Nw",
60-729d→"Nmo" (flat 30-day month), ≥730d→"N.Ny" (flat 365-day year); every
nonzero span rounds to a minimum of 1 unit, never floors to "0h".
`computeCypherRatios(values=[X,A,B,C,D])` — the T4.1 fix.
`computeAdjacentLegRatios(values)` — returns `values.length-2` ratios, one
per leg from index 2 onward, each vs its own immediate predecessor.
`formatGannRangeRatioLabel(bars, priceRange)` — shared verbatim by
`gannSquare` and `gannSquareFixed` so the two variants render byte-identical
corner text.

**Cypher worked example (hand-verified, also the ta:check fixture)**:
X=100,A=150,B=130,C=180,D=140 → XA=50,AB=20→B=0.400; BC=50→C=BC/AB=2.500 (old
buggy code would have shown 1.000, BC/XA); XC=80,CD=40→D=CD/XC=0.500 (old
buggy code would have shown 0.800, CD/XA).

**Verification, all clean**: `npm run ta:check` 182/182 (+18 from baseline
164, see [[project_scripting_ss1]]'s note on that baseline). `npx tsc
--noEmit` clean. `npm run build` succeeded. eslint clean on all 6 touched
files. `apps/api/scripts/verify-papertrading-engine.ts` 264/264 (no
order-engine interference, as expected — this brief never touches
papertrading math). `git diff apps/web/prisma/schema.prisma` is NOT empty but
that diff PRE-EXISTS this session (the SS1 `UserStrategyScript` model, see
[[project_scripting_ss1]]) — this brief itself made zero schema edits,
confirmed by diff-stat scoping to only the 6 touched overlay/selfcheck files.

**Files touched**: `apps/web/components/paper-trading/workbench/overlays/{measure,fibonacci,gann,patterns,figure-kit}.ts`,
`apps/web/lib/ta/selfcheck.ts`. Explicitly NOT touched (per brief, verified):
Lines family (`lines.ts`/`built-in-stats.ts`/`legacy-shapes.ts`'s `arrow`),
`sector` tool geometry, `lib/ta/user-scripts*`/`workbench/user-scripts/`,
click-to-trade popover code, `longPosition`/`shortPosition` qty/account-size
input (flagged back to CEO as a follow-on idea per the brief, not built).

Deferred by the brief itself, not a gap in this pass: P3 nice-to-haves
(fibTimezone/trendBasedFibTime date sub-labels, anchoredVWAP live value,
pitchfork median price), `sector`/Forecast geometry redesign (needs founder
sign-off), position-sizing on long/shortPosition.
