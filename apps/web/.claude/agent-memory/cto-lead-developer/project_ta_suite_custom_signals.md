---
name: project_ta_suite_custom_signals
description: TA Suite founder-feedback pass — third "Custom" section in the Signals table, a "+" builder for user-parameterized RSI(n)/EMA(n)/MACD(fast,slow,signal)/etc rules, ta:check drift-guard fixture (120/120). Builds on [[project_ta_suite_signals_panel_liveness_audit]].
metadata:
  type: project
---

Built as a direct assignment (not sprint-board pipeline), same posture as
every prior TA Suite pass. Founder ask: "custom strategy… a '+' button for
user to build and customise the parameters and allowing to name these
strategies — e.g. see what RSI(20) or Momentum(15) signals" — a third
collapsible section in `signals-table.tsx`, below Moving Averages/
Oscillators, deliberately never feeding the rating dial.

**The refactor that makes "no drift" provable, not just documented.**
`lib/ta/technicals.ts`'s 11 fixed-default `Rule` objects (RSI/STOCH/CCI/ADX/
AO/MTM/MACD/STOCHRSI/WR/BBP/UO) were each split into a generic
`evaluate*Rule(candles, closes, ...params)` function plus a thin wrapper
calling it with the original hardcoded literal (e.g. `RSI_RULE.evaluate =
(_c, closes) => evaluateRsiRule(closes, 14)`) — a zero-behavior-change
extraction, confirmed by `ta:check` staying green on every pre-existing
assertion with NO changes to expected values. `CUSTOMIZABLE_RULES` (new, 13
entries: SMA/EMA/RSI/STOCH/CCI/ADX/AO/MTM/MACD/STOCHRSI/WR/BBP/UO) calls
these SAME generic functions with user-chosen params — a custom RSI(14) row
is therefore provably identical to the standard table's own RSI(14) row,
not independently re-derived. New `evaluateCustomSignal(ruleId, params,
candles): DetailRow | undefined` is the single custom-row entry point;
returns `undefined` for an unknown ruleId or empty candles (caller drops/
shows nothing), a `skipped` row honestly for too-few bars, else the same
row shape `computeTechnicalDetail` produces.

**One deliberate deviation, verified by test**: a custom row's `DetailRow.id`
is the RULE's id (e.g. `"RSI"`), not the standard table's per-period MA id
(`"EMA20"`) — a user can have two custom RSI rows at different periods, so
`id` is rule-family-scoped, `signals-table.tsx` substitutes the user's own
instance id/name when rendering. The `ta:check` cross-equality fixture for
EMA(20) excludes `id` from the comparison for exactly this reason (RSI's own
comparison needed no exclusion, since `RSI_RULE.id === "RSI"` already
matches the catalog's family id).

**StochRSI/ADX param-count simplification**: the brief's shorthand
`StochRSI(n)` collapses the underlying `stochRsi(closes, rsiPeriod,
stochPeriod, kSmooth, dSmooth)` to ONE customizable "length" applied to both
`rsiPeriod` and `stochPeriod` (kSmooth/dSmooth fixed at 3) — matches
TradingView's own default StochRSI settings panel convention. `ADX(n)`
similarly applies one length to both `dmi()`'s `period` and `adxPeriod`
args. `Stochastic(k,d,smooth)`'s three params are named after the underlying
function signature 1:1 (`%K Length`/`%K Smoothing`/`%D Smoothing`) rather
than the brief's literal `(k,d,smooth)` shorthand — documented as one
defensible reading of ambiguous terminology, same posture prior passes used
for pitchfork variants.

**Persistence**: `pf.workbench.customSignals` `{v:1, items:[{id,name,ruleId,
params}]}`, owned by the NEW `custom-signal-builder.tsx` (not a separate
registry file — co-located with the only place items are created, same
pattern `strategy-panel.tsx` uses for `pf.workbench.strategy`, as opposed to
`indicator-registry.ts`'s separate-file pattern — both exist in this
codebase, picked co-location since the builder is the item's sole creator).
Validated restore: unknown/removed `ruleId` drops the item, out-of-range
params clamp via `clampCustomRuleParams`, blank/corrupt name drops the item.
`chart-workbench.tsx` owns the `CustomSignalItem[]` state + restore-after-
mount effect + save-on-change effect (same posture as `indicators`/
`strategyId`) and the builder popover's open/closed state — `signals-
table.tsx` stays purely presentational, only capturing the "+"/edit button's
own `getBoundingClientRect()` and calling back up, same "+"/gear split
`indicator-active-strip.tsx` already uses for `IndicatorDialog`/
`IndicatorSettingsPopover`.

**Builder popover positioning — a deliberate combination of two existing
precedents, not a new mechanism**: `indicator-settings-popover.tsx`'s
`fixed inset-0` click-catcher + `absolute` anchored card (correct choice
for "anchored to a button inside a scrollable panel", as opposed to
`chart-order-intent-popover.tsx`'s chart-wrapper-relative `position:
absolute`, which assumes a `position: relative` chart ancestor that doesn't
exist here) PLUS `tool-flyout.tsx`'s `useLayoutEffect` viewport-fit vertical
shift (this card can be taller than the settings popover — rule select + up
to 3 params + name field + Save/Cancel — more likely to overflow near the
bottom of a narrow scrollable panel).

**Gates, all green**: tsc clean across apps/web + apps/api + all 4 packages;
eslint clean on every touched/new file; `npm run ta:check` 120/120 (up from
86/86 — 34 new assertions: RSI(14) exact-match, EMA(20) match-excluding-id,
RSI(20)≠RSI(14) params-actually-flow-through, RSI(20) label/reading carry
the custom period, Momentum(15) evaluates, RSI(200) honestly skips on an
80-bar window, out-of-range param clamps rather than crashing, unknown
ruleId drops, empty candles returns undefined, catalog has 13 unique ids
with every default within its own [min,max]); `verify-papertrading-engine.ts`
264/264 (untouched — no `packages/business-rules` import added, confirmed
`git status` on that package is empty); `next build` succeeds, First Load JS
for all 3 paper-trading terminal pages **identical to every prior sprint's
own baseline** (136/135/140 kB, confirmed via `app-build-manifest.json` zero
overlap between the async workbench chunk's 3 files and any terminal page's
sync list); `react-loadable-manifest.json` still exactly ONE dynamic-import
entry (3 chunk files, ~450 KB uncompressed total, up from the legends pass's
~416 KB — expected, given the new catalog + builder file); `grep klinecharts`
confirms `lib/ta/` stays klinecharts-import-free (comment/doc prose only)
and neither new/touched file (`signals-table.tsx`, `custom-signal-
builder.tsx`) has a real `from "klinecharts"` import.

**Not done this session** (same posture as every prior TA Suite pass):
live/interactive QA — no dev server/DB/authenticated session. Static
verification (tsc/eslint/build/engine/ta:check/manifest inspection/source-
reading) was exhaustive; the required next step before this ships is a live
pass: open the workbench, add a custom RSI(20) and a custom Momentum(15),
verify the reason-card hover text on each, edit one (confirm the builder
reopens pre-filled and the name stays as previously typed), remove one,
reload and confirm restore, and confirm the rating dial above is completely
unaffected regardless of what's in the Custom section.

**Files**: `lib/ta/technicals.ts` (11 oscillator rules refactored into
generic `evaluate*Rule()` + thin wrapper, `CustomRuleParamSpec`/
`CustomizableRuleDef` types, `CUSTOMIZABLE_RULES` 13-entry catalog,
`getCustomizableRule`/`defaultCustomRuleParams`/`clampCustomRuleParams`/
`evaluateCustomSignal`); `lib/ta/selfcheck.ts` (`checkCustomSignalFixtures`,
+34 assertions); `signals-table.tsx` (`CustomRowLine`/`CustomSection`, new
`SignalsTable` props); `custom-signal-builder.tsx` (new — `CustomSignalItem`
type, `pf.workbench.customSignals` load/save, `CustomSignalBuilder`
popover); `chart-workbench.tsx` (`customSignals` state + restore/persist
effects, `customSignalRows` memo, `customSignalBuilder` popover state +
render, 4 new handlers).
