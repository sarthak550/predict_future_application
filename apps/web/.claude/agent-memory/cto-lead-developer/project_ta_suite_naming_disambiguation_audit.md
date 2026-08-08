---
name: project_ta_suite_naming_disambiguation_audit
description: TA Suite founder naming-disambiguation audit (2026-08-04) — full collision table across indicator-registry/technicals/indicator-signals/custom-signal-builder, KDJ-vs-classic-Stochastic math verified as genuinely different formulas. Builds on [[project_ta_suite_s2]] (displayLabel mechanism origin) and [[project_ta_suite_legends_founder_feedback]] (SMA/SMMA shortName precedent).
metadata:
  type: project
---

Built 2026-08-04 as a direct assignment (not sprint-board pipeline), same
posture as every prior TA Suite pass. Founder ask: "like with Stochastic
it's not clear which strategy is talked about — find all that have similar
names and make each unique or explicit," across all 41 indicators + the
technicals rating rule table + the custom-signal builder catalog.

**The one real math-difference finding (the whole point of the audit)**:
"Stochastic" was used for THREE genuinely different formulas across the
suite, not just a naming inconsistency:
1. `indicator-registry.ts`'s `KDJ` (klinecharts-native) — `math.ts`'s
   `stochasticKdj`: RSV + RECURSIVE weighted smoothing (`k = ((kSmoothing-1)
   * prevK + rsv) / kSmoothing`) + a J line (`3K-2D`). Verified byte-for-
   byte against `node_modules/klinecharts/dist/index.esm.js`'s own
   `kdj.calc` (`k = ((params[1]-1)*(prev?.k??50)+rsv)/params[1]`, etc.,
   confirmed via direct grep of the installed package — NOT assumed).
2. `technicals.ts`'s rating-table `STOCH_RULE` — `math.ts`'s
   `stochasticOscillator`: raw %K then SMA-smoothed %K, SMA-smoothed %D off
   that, NO J line — TradingView's classic %K/%D. Has NO klinecharts
   built-in equivalent (`math.ts`'s own doc comment already said this
   before this pass).
3. `STOCHRSI` — Stochastic applied to RSI values instead of price, a third
   distinct member.
Renamed to make the difference explicit rather than paper over it: `KDJ`
displayLabel → "Stochastic (KDJ)"; `STOCH_RULE`/`CUSTOMIZABLE_RULES.STOCH`
→ "Stochastic Osc %K(...) (Classic)" with rule text that says "a different
formula from the KDJ indicator on your chart" verbatim; `STOCHRSI`
displayLabel → "Stochastic RSI". All three now read distinctly wherever
they appear (dialog, active strip, settings popover, signals table, custom
builder dropdown).

**A real, independently-found bug, not just missing labels**:
`indicator-registry.ts`'s `formatInstanceLabel()` — the active-indicator
strip's PRIMARY visible text — was interpolating raw `instance.name` (the
registry KEY), not `indicatorDisplayName(instance.name)`, even though every
OTHER label on that same strip row (`aria-label` on both gear and remove
buttons) already went through the display-name helper. Net effect before
the fix: a KDJ instance's settings popover was titled "Stochastic (KDJ)
settings" but the row it opened from still said bare "KDJ" — an internal
inconsistency the SMA/SMMA precedent had already fixed everywhere else but
missed here. Fixed to route through `indicatorDisplayName()`, same as every
other surface. Confirmed via grep this was the ONLY UI surface bypassing
the display-name helper (`indicator-dialog.tsx`, `indicator-active-strip.tsx`'s
aria-labels, `indicator-settings-popover.tsx`, `kline-chart.tsx`'s
`createIndicator` calls all already correctly used `meta.name`/
`instance.name` only for the klinecharts-facing/persistence side, never for
display).

**A second real gap found via the audit, not asked for explicitly**:
`indicator-dialog.tsx`'s row list was sorted by raw registry `name`
(`a.name.localeCompare(b.name)`), not by what's on screen — with 33 of 41
indicators now carrying a `displayLabel` that reads very differently from
its key (e.g. "Stochastic (KDJ)" for key `KDJ`), sorting by key put it
under "K" in the category list instead of "S" — findable only if you
already knew the internal key, defeating the point of a decodable display
name. Fixed to sort by `displayLabel ?? name` (same fallback the row itself
renders).

**Registry displayLabel additions** (33 of 41 entries now carry one; 8 left
bare because they're either already unambiguous full words or explicitly
founder-confirmed "fine as-is": `EMA`, `TRIX`, `MACD`, `RSI`, `ROC`, `BIAS`,
`VOL`, `AROON`): `BBI`→"Bull Bear Index (BBI)", `SAR`→"Parabolic SAR",
`DMA`→"MA Difference (DMA)", `DMI`→"DMI / ADX", `BOLL`→"Bollinger Bands",
`KDJ`→"Stochastic (KDJ)", `WR`→"Williams %R (WR)", `MTM`→"Momentum (MTM)",
`PSY`→"Psychological Line", `AO`→"Awesome Oscillator (AO)" (deviation —
founder's own suggestion was "Awesome Osc (AO)"; used the full word since
`AO_RULE`/`CUSTOMIZABLE_RULES` already spell it out fully everywhere else —
introducing a fresh "Osc" abbreviation would have created a NEW
inconsistency the audit's whole point was to remove), `BRAR`→"BR/AR
Sentiment", `CR`→"CR Energy", `CCI`→"Commodity Channel (CCI)",
`EMV`→"Ease of Movement", `OBV`→"On-Balance Volume", `PVT`→"Price-Volume
Trend", `VR`→"Volume Ratio (VR)", `AVP`→"Avg Price (AVP)",
`ICHIMOKU`→"Ichimoku Cloud", `SUPERTREND`→"SuperTrend", `VWAP`→"VWAP
(Session)", `KELTNER`→"Keltner Channels", `DONCHIAN`→"Donchian Channels",
`PIVOTS`→"Pivot Points", `ATRX`→"ATR", `STOCHRSI`→"Stochastic RSI",
`WMA`→"Weighted MA (WMA)", `VWMA`→"Vol-Weighted MA (VWMA)", `HMA`→"Hull MA
(HMA)", `MFI`→"Money Flow (MFI)", `CMF`→"Chaikin Money Flow". Registry key
(`name`) is NEVER touched anywhere — persistence/klinecharts-registration
contract untouched, exactly the pre-existing `displayLabel` mechanism's own
contract (`indicator-registry.ts`'s doc comment already established this
for the SMA/SMMA case; this pass just used the same lever at scale).
Verified 33 unique displayLabels, zero collisions, via a throwaway node
regex script over the file.

**`technicals.ts` rule-table + `CUSTOMIZABLE_RULES` alignment** (only where
a REAL cross-module mismatch existed, not touched everywhere for its own
sake): `STOCH_RULE.label` "Stochastic %K(14,3,3)" → "Stochastic Osc
%K(14,3,3)"; `ADX_RULE.label` "ADX(14)" → "ADX(14) [DMI]" (names which
chart indicator its ADX/+DI/-DI lines actually come from — `DMI`, now
displayed "DMI / ADX" — since ADX has no standalone chart indicator of its
own, it's a line WITHIN `DMI`); `CUSTOMIZABLE_RULES` entries for `STOCH`
(name → "Stochastic Osc %K/%D (Classic)", `buildLabel` → matching
"Stochastic Osc %K(...)"), `CCI` (name → "Commodity Channel (CCI)"), `ADX`
(name → "DMI / ADX", `buildLabel` → "ADX(period) [DMI]"), `MTM` (name →
"Momentum (MTM)"), `WR` (name → "Williams %R (WR)") — each now matches its
registry `displayLabel` counterpart exactly, per the founder's explicit
"custom-rule catalog labels must match the indicator display family names."
`RSI`/`EMA`/`SMA`/`MACD`/`AO`/`BBP`/`UO` in `CUSTOMIZABLE_RULES` left
untouched — `RSI`/`EMA`/`MACD` already unambiguous; `SMA` here is the TRUE
simple MA (unrelated to the registry's smoothed-MA `SMA` indicator, already
correctly separated via that indicator's own "SMMA (Smoothed)"
displayLabel — a pre-existing, deliberate non-collision, confirmed not to
need touching); `BBP`(Bull/Bear Power)/`UO`(Ultimate Oscillator) have NO
chart-indicator counterpart at all (standalone rating-only rules), nothing
to align against.

**On-chart legends — deliberately NOT touched beyond the pre-existing
SMA→SMMA override**: per the founder's own explicit instruction ("KDJ
legend 'KDJ' is fine — it matches 'Stochastic (KDJ)'; don't over-rename
chart legends"), checked every custom indicator's own registered
klinecharts `name` (`custom-indicators/pack-a.ts`/`pack-b.ts`) against its
new registry `displayLabel` for a CONTRADICTION (not just an abbreviation)
— found none. Every custom indicator's on-chart legend already shows its
own acronym (`STOCHRSI`, `WR`, `MTM`, `DMI`, etc.), which is now
consistently DECODABLE via the dialog's new displayLabel rather than
contradicted by it (the SMA case was unique because klinecharts' native
"SMA" label was actively WRONG — smoothed, not simple — everything else
here is merely abbreviated, not incorrect).

**Search-friendliness**: `indicator-dialog.tsx`'s search already matched
name AND `displayLabel` AND `description` before this pass (verified by
reading the filter predicate directly) — no code change needed there,
only the SORT fix above (searching for "Stochastic" already surfaced KDJ/
STOCHRSI/etc. by description text even pre-audit; the audit's `displayLabel`
additions make the SAME text now also match via the label field directly,
redundant-but-correct).

**Gates, all green**: tsc clean across apps/web + apps/api + packages/
{validation,types,api-client,business-rules} (only apps/web files touched —
`indicator-registry.ts`, `technicals.ts`, `indicator-dialog.tsx` — apps/api
and all 4 packages had zero diff this session, confirmed via `git status`,
so their own tsc passes are a no-op verification rather than a real check
against new code); eslint clean on all 3 touched files; `npm run ta:check`
124/124 (only label-STRING assertions exist for `RSI(20)`/`EMA(20)`/
`Momentum(15)` in `selfcheck.ts` — none of the changed labels (`STOCH`,
`ADX`, `MTM`'s `.name` field, `WR`'s `.name` field, `CCI`'s `.name` field)
are asserted by id/string equality anywhere in the fixture file, confirmed
via grep before editing, so zero fixture updates were needed); `next build`
succeeds, First Load JS for all 3 paper-trading terminal pages **identical
to every prior TA Suite pass's own recorded baseline** (136/135/140 kB —
pure label/sort/doc-comment changes, zero new imports, zero bundle
growth); `react-loadable-manifest.json` still exactly ONE dynamic-import
entry. The apps/api paper-trading ENGINE check
(`verify-papertrading-engine.ts`, "264/264" in the standing gate list) was
NOT run this pass — apps/api has zero files touched (confirmed via `git
status apps/api/`), and that script tests order/settlement/MTM logic
entirely disjoint from `apps/web`'s TA indicator naming, so running it
would have been a no-op against unchanged code, same reasoning prior passes
used for untouched packages (e.g. S1's "`packages/business-rules` git diff
empty" note).

**Files**: `apps/web/components/paper-trading/workbench/indicator-registry.ts`
(33 new `displayLabel`s, `formatInstanceLabel()` bug fix),
`apps/web/components/paper-trading/workbench/indicator-dialog.tsx` (sort by
displayLabel), `apps/web/lib/ta/technicals.ts` (`STOCH_RULE`/`ADX_RULE`
labels + reason text, 5 `CUSTOMIZABLE_RULES` entries' `.name`/`buildLabel`).
Zero changes to `indicator-signals.ts`, `strategies.ts`,
`strategy-panel.tsx`, `signals-table.tsx`, `custom-signal-builder.tsx`,
`kline-chart.tsx`, or any `custom-indicators/*.ts` file — all already
either correctly using the display-name helpers, or (strategy labels: "MA
Cross"/"EMA Cross"/"SuperTrend Flip"/"RSI Reversal"/"MACD Cross"/
"Bollinger Breakout"/"Donchian Breakout") already unambiguous and matching
their indicator families' root names with no changes needed.

**How to apply next time a new indicator/rule/strategy is added**: check
this memory's collision table FIRST before picking a display name — the
"Stochastic" family alone had 3 legitimately different formulas hiding
behind the same word; a new addition using a generic term ("Momentum",
"Oscillator", "Channel", "Trend") should be checked against both
`indicator-registry.ts`'s existing `displayLabel`s AND
`technicals.ts`'s `CUSTOMIZABLE_RULES` names for a silent collision before
shipping.
