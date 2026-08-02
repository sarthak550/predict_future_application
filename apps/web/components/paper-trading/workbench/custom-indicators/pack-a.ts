/**
 * TA Suite Sprint S2, T2 — custom pack A: main-pane-heavy indicators
 * (ICHIMOKU, SUPERTREND, VWAP, KELTNER, DONCHIAN, PIVOTS), registered via
 * klinecharts' `registerIndicator` (verified signature against
 * `dist/index.d.ts`'s `IndicatorTemplate` — same `{name, series, calcParams,
 * figures, calc, draw?}` shape every built-in above it in `dist/
 * index.esm.js` uses).
 *
 * **ICHIMOKU's `convertToPixel`-beyond-last-index verification (the named
 * hard prerequisite)** — done by READING `dist/index.esm.js`'s
 * `StoreImp.prototype.dataIndexToCoordinate` (line 13733) directly, not by
 * probing at runtime (no live browser/dev server available this session,
 * same static-verification posture S1 used for its own klinecharts internals
 * — see `project_ta_suite_s1` memory):
 *
 *   `dataIndexToCoordinate(dataIndex) { const deltaFromRight = dataCount +
 *   lastBarRightSideDiffBarCount - dataIndex; return Math.floor(totalBarSpace
 *   - (deltaFromRight - 0.5) * barSpace + 0.5); }`
 *
 * This is PURE LINEAR ARITHMETIC over `dataIndex` — no bounds check, no
 * clamp, no `NaN`/`undefined` branch for `dataIndex >= dataCount`. A
 * `dataIndex` 26 bars past the last candle produces a well-defined pixel x
 * exactly `26 * barSpace` further right than the last candle's own x
 * (`XAxisImp.prototype.convertToPixel` — `dist/index.esm.js:10838` — is a
 * thin wrapper calling this exact function). The forward-shifted cloud
 * therefore needs NO fallback/manual-projection path — the direct
 * `xAxis.convertToPixel(dataIndex + displacement)` call inside `draw()`
 * below is correct by construction, not by assumption. (Whether that pixel
 * lands ON-canvas depends on how much right-side margin the chart has
 * reserved — same as any TradingView-style forward-shifted cloud, the user
 * scrolls/pans to see more of it; this file adds a cheap manual x-bounds
 * cull purely as a perf guard, not a correctness one.)
 *
 * **`draw()` / default-figure interplay** (verified against
 * `IndicatorView.prototype.drawImp`, `dist/index.esm.js:7877-8055`):
 * `isCover = indicator.draw(...)` runs FIRST; if it returns `false`,
 * klinecharts THEN renders every entry in `figures[]` using the indicator's
 * own `result` array, on top of whatever `draw()` already painted. ICHIMOKU
 * exploits this deliberately: `draw()` paints ONLY the displaced cloud
 * (senkou spans A/B + fill) and the displaced chikou span — none of which
 * can be expressed as a plain `figures[]` entry (those render at the SAME
 * `dataIndex` as their data, no displacement support) — then returns
 * `false` so the UNDISPLACED tenkan/kijun lines render via the normal
 * `figures[]` path, letting klinecharts handle their hit-testing/tooltip
 * wiring for free.
 */
import type { IndicatorTemplate } from "klinecharts";
import { registerIndicator } from "klinecharts";

import { ema, wilderAtr, supertrend as computeSupertrend, sessionVwap, ichimokuLines, rollingHigh, rollingLow } from "@/lib/ta/math";

interface OhlcCandle {
  timestamp: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// ── Shared local helpers (indicator-specific plumbing — not promoted to
// `lib/ta/math.ts`). `rollingHigh`/`rollingLow` themselves WERE promoted
// (founder-feedback pass, 2026-08-03 — `indicator-signals.ts`/
// `technicals.ts` need the identical window-high/low primitive), imported
// above instead of defined locally. ─────────────────────────────────────

/** IST calendar date key (`YYYY-MM-DD`) for session-boundary detection — same "IST-midnight session math" convention as `reference_nse_data_gotchas` memory documents for the rest of the codebase. */
function istDateKey(timestampMs: number): string {
  return new Date(timestampMs).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** ISO week key (`YYYY-Www`, IST) for weekly pivot grouping — Monday-start weeks. */
function istWeekKey(timestampMs: number): string {
  const istString = new Date(timestampMs).toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const d = new Date(istString);
  const day = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

/** PIVOTS is interval-adaptive (classic prior-session pivots intraday, weekly pivots on `1d`) WITHOUT needing the nominal interval string threaded through `calcParams` — inferred directly from the loaded bars' own median gap, a self-contained, independently-verifiable signal (a 1d-interval dataset's bars are ~24h apart; anything intraday is far denser). Threshold: 20 hours catches 1d (and any coarser future interval) while never misfiring on the densest intraday interval this workbench offers (60m). */
function inferIsDailyBars(candles: readonly OhlcCandle[]): boolean {
  if (candles.length < 3) return false;
  const gaps: number[] = [];
  for (let i = 1; i < candles.length; i++) gaps.push(candles[i].timestamp - candles[i - 1].timestamp);
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return median >= 20 * 60 * 60 * 1000;
}

// ── ICHIMOKU ──────────────────────────────────────────────────────────────

interface IchimokuPoint {
  tenkan?: number;
  kijun?: number;
  senkouA?: number;
  senkouB?: number;
}

export const ichimoku: IndicatorTemplate<IchimokuPoint, number> = {
  name: "ICHIMOKU",
  shortName: "ICHIMOKU",
  series: "price",
  precision: 2,
  shouldOhlc: true,
  calcParams: [9, 26, 52],
  figures: [
    { key: "tenkan", title: "Conversion: ", type: "line" },
    { key: "kijun", title: "Base: ", type: "line" }
  ],
  calc: (dataList, indicator) => {
    const [tenkanPeriod, kijunPeriod, senkouBPeriod] = indicator.calcParams;
    return ichimokuLines(dataList, tenkanPeriod, kijunPeriod, senkouBPeriod);
  },
  createTooltipDataSource: ({ indicator, crosshair }) => {
    const dataIndex = crosshair.dataIndex ?? 0;
    const p = (indicator.result[dataIndex] ?? {}) as IchimokuPoint;
    const fmt = (v: number | undefined) => (v === undefined ? "-" : v.toFixed(indicator.precision));
    return {
      name: "ICHIMOKU",
      calcParamsText: `(${indicator.calcParams.join(",")})`,
      features: [],
      legends: [
        { title: "Conversion: ", value: fmt(p.tenkan) },
        { title: "Base: ", value: fmt(p.kijun) },
        { title: "Span A: ", value: fmt(p.senkouA) },
        { title: "Span B: ", value: fmt(p.senkouB) }
      ]
    };
  },
  draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
    const dataList = chart.getDataList() as OhlcCandle[];
    const result = indicator.result as IchimokuPoint[];
    const displacement = indicator.calcParams[1]; // kijun period, classic convention.

    const aPts: { x: number; y: number }[] = [];
    const bPts: { x: number; y: number }[] = [];
    for (let i = 0; i < result.length; i++) {
      const a = result[i]?.senkouA;
      const b = result[i]?.senkouB;
      if (a === undefined || b === undefined) continue;
      const x = xAxis.convertToPixel(i + displacement);
      if (x < -50 || x > bounding.width + 50) continue;
      aPts.push({ x, y: yAxis.convertToPixel(a) });
      bPts.push({ x, y: yAxis.convertToPixel(b) });
    }

    if (aPts.length > 1 && bPts.length > 1) {
      ctx.save();
      const bullish = aPts[aPts.length - 1].y <= bPts[bPts.length - 1].y;
      ctx.beginPath();
      ctx.moveTo(aPts[0].x, aPts[0].y);
      for (const p of aPts.slice(1)) ctx.lineTo(p.x, p.y);
      for (let k = bPts.length - 1; k >= 0; k--) ctx.lineTo(bPts[k].x, bPts[k].y);
      ctx.closePath();
      ctx.fillStyle = bullish ? "rgba(16,185,129,0.12)" : "rgba(244,63,94,0.12)";
      ctx.fill();

      ctx.lineWidth = 1;
      ctx.strokeStyle = "#10b981";
      ctx.beginPath();
      aPts.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();

      ctx.strokeStyle = "#f43f5e";
      ctx.beginPath();
      bPts.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "#7c3aed";
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < dataList.length; i++) {
      const x = xAxis.convertToPixel(i - displacement);
      if (x < -50 || x > bounding.width + 50) continue;
      const y = yAxis.convertToPixel(dataList[i].close);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();

    return false; // let default figure rendering draw tenkan/kijun on top.
  }
};

// ── SUPERTREND ────────────────────────────────────────────────────────────

interface SupertrendPoint {
  value?: number;
  trend?: 1 | -1;
  flip?: number;
}

/**
 * S3 refactor: the calculation itself now lives in `lib/ta/math.ts`'s
 * `supertrend()` — imported here as `computeSupertrend` — so the
 * `supertrendFlip` strategy (`lib/ta/strategies.ts`) computes flips from
 * the EXACT SAME function this chart indicator plots, not a
 * separately-maintained copy. Figure styling (flip-colored line + flip
 * markers) is unchanged.
 */
export const supertrend: IndicatorTemplate<SupertrendPoint, number> = {
  name: "SUPERTREND",
  shortName: "SUPERTREND",
  series: "price",
  precision: 2,
  shouldOhlc: true,
  calcParams: [10, 3],
  figures: [
    {
      key: "value",
      title: "SuperTrend: ",
      type: "line",
      styles: ({ data }) => ({ color: data.current?.trend === 1 ? "#10b981" : "#f43f5e" })
    },
    {
      key: "flip",
      title: "Flip: ",
      type: "circle",
      styles: ({ data }) => ({ color: data.current?.trend === 1 ? "#10b981" : "#f43f5e" })
    }
  ],
  calc: (dataList, indicator) => {
    const [period, multiplier] = indicator.calcParams;
    return computeSupertrend(dataList, period, multiplier);
  }
};

// ── VWAP ──────────────────────────────────────────────────────────────────

export const vwap: IndicatorTemplate<{ vwap?: number }, number> = {
  name: "VWAP",
  shortName: "VWAP",
  series: "price",
  precision: 2,
  shouldOhlc: true,
  calcParams: [],
  figures: [{ key: "vwap", title: "VWAP: ", type: "line" }],
  calc: (dataList) => sessionVwap(dataList).map((vwap) => ({ vwap }))
};

// ── KELTNER ───────────────────────────────────────────────────────────────

interface BandPoint {
  upper?: number;
  middle?: number;
  lower?: number;
}

export const keltner: IndicatorTemplate<BandPoint, number> = {
  name: "KELTNER",
  shortName: "KELTNER",
  series: "price",
  precision: 2,
  shouldOhlc: true,
  calcParams: [20, 2],
  figures: [
    { key: "upper", title: "Upper: ", type: "line" },
    { key: "middle", title: "Basis: ", type: "line" },
    { key: "lower", title: "Lower: ", type: "line" }
  ],
  calc: (dataList, indicator) => {
    const [period, multiplier] = indicator.calcParams;
    const closes = dataList.map((c) => c.close);
    const middle = ema(closes, period);
    const atr = wilderAtr(dataList, period);
    return dataList.map((_, i) => {
      const m = middle[i];
      const a = atr[i];
      if (m === undefined || a === undefined) return {};
      return { upper: m + multiplier * a, middle: m, lower: m - multiplier * a };
    });
  }
};

// ── DONCHIAN ──────────────────────────────────────────────────────────────

export const donchian: IndicatorTemplate<BandPoint, number> = {
  name: "DONCHIAN",
  shortName: "DONCHIAN",
  series: "price",
  precision: 2,
  shouldOhlc: true,
  calcParams: [20],
  figures: [
    { key: "upper", title: "Upper: ", type: "line" },
    { key: "middle", title: "Middle: ", type: "line" },
    { key: "lower", title: "Lower: ", type: "line" }
  ],
  calc: (dataList, indicator) => {
    const [period] = indicator.calcParams;
    const upper = rollingHigh(dataList, period);
    const lower = rollingLow(dataList, period);
    return dataList.map((_, i) => {
      const u = upper[i];
      const l = lower[i];
      if (u === undefined || l === undefined) return {};
      return { upper: u, middle: (u + l) / 2, lower: l };
    });
  }
};

// ── PIVOTS ────────────────────────────────────────────────────────────────

interface PivotPoint {
  pp?: number;
  r1?: number;
  s1?: number;
  r2?: number;
  s2?: number;
  r3?: number;
  s3?: number;
}

function classicPivots(high: number, low: number, close: number): PivotPoint {
  const pp = (high + low + close) / 3;
  const range = high - low;
  return {
    pp,
    r1: 2 * pp - low,
    s1: 2 * pp - high,
    r2: pp + range,
    s2: pp - range,
    r3: high + 2 * (pp - low),
    s3: low - 2 * (high - pp)
  };
}

export const pivots: IndicatorTemplate<PivotPoint, number> = {
  name: "PIVOTS",
  shortName: "PIVOTS",
  series: "price",
  precision: 2,
  shouldOhlc: true,
  calcParams: [],
  figures: [
    { key: "pp", title: "PP: ", type: "line" },
    { key: "r1", title: "R1: ", type: "line" },
    { key: "s1", title: "S1: ", type: "line" },
    { key: "r2", title: "R2: ", type: "line" },
    { key: "s2", title: "S2: ", type: "line" },
    { key: "r3", title: "R3: ", type: "line" },
    { key: "s3", title: "S3: ", type: "line" }
  ],
  calc: (dataList) => {
    const isDaily = inferIsDailyBars(dataList);
    const keyFn = isDaily ? istWeekKey : istDateKey;

    // Aggregate H/L/C per period (day or week), in first-seen order.
    const periodKeys: string[] = [];
    const periodAgg = new Map<string, { high: number; low: number; close: number }>();
    for (const c of dataList) {
      const key = keyFn(c.timestamp);
      const existing = periodAgg.get(key);
      if (!existing) {
        periodKeys.push(key);
        periodAgg.set(key, { high: c.high, low: c.low, close: c.close });
      } else {
        existing.high = Math.max(existing.high, c.high);
        existing.low = Math.min(existing.low, c.low);
        existing.close = c.close; // last-seen close within the period.
      }
    }
    const priorPeriodPivots = new Map<string, PivotPoint>();
    for (let k = 1; k < periodKeys.length; k++) {
      const prior = periodAgg.get(periodKeys[k - 1])!;
      priorPeriodPivots.set(periodKeys[k], classicPivots(prior.high, prior.low, prior.close));
    }

    return dataList.map((c) => priorPeriodPivots.get(keyFn(c.timestamp)) ?? {});
  }
};

let registered = false;
export function registerPackA(): void {
  if (registered) return;
  registered = true;
  registerIndicator(ichimoku);
  registerIndicator(supertrend);
  registerIndicator(vwap);
  registerIndicator(keltner);
  registerIndicator(donchian);
  registerIndicator(pivots);
}
