/**
 * TA Suite Sprint S2, T3 — custom pack B: sub-pane indicators (ATRX,
 * STOCHRSI, WMA, VWMA, HMA, MFI, CMF, AROON). Pane placement is the CEO
 * brief's own explicit, twice-stated (brief + founder-locked plan) list —
 * WMA/VWMA/HMA are conventionally MAIN-pane price overlays elsewhere, kept
 * sub-pane here per that explicit instruction; flagged as a product-UX note
 * in this sprint's final report rather than silently overridden.
 */
import type { IndicatorTemplate } from "klinecharts";
import { registerIndicator } from "klinecharts";

import { rsi, sma, wilderAtr, wma, vwma, hma } from "@/lib/ta/math";

interface OhlcvCandle {
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** SMA over a sparse (leading-`undefined`-run) series, applied only to the DEFINED suffix and mapped back onto the original index space — see `stochrsi`'s own doc comment below for why this exists instead of a naive `sma(values.map(v => v ?? NaN), period)`. */
function compactSma(values: readonly (number | undefined)[], period: number, length: number): (number | undefined)[] {
  const compact: number[] = [];
  const compactIndexToOriginal: number[] = [];
  values.forEach((v, i) => {
    if (v !== undefined && Number.isFinite(v)) {
      compact.push(v);
      compactIndexToOriginal.push(i);
    }
  });
  const smoothed = sma(compact, period);
  const out: (number | undefined)[] = new Array(length).fill(undefined);
  smoothed.forEach((v, i) => {
    if (v !== undefined) out[compactIndexToOriginal[i]] = v;
  });
  return out;
}

// ── ATRX ──────────────────────────────────────────────────────────────────

export const atrx: IndicatorTemplate<{ atr?: number }, number> = {
  name: "ATRX",
  shortName: "ATRX",
  precision: 2,
  calcParams: [14],
  figures: [{ key: "atr", title: "ATR: ", type: "line" }],
  calc: (dataList, indicator) => {
    const [period] = indicator.calcParams;
    const atr = wilderAtr(dataList, period);
    return dataList.map((_, i) => ({ atr: atr[i] }));
  }
};

// ── STOCHRSI ──────────────────────────────────────────────────────────────

export const stochrsi: IndicatorTemplate<{ k?: number; d?: number }, number> = {
  name: "STOCHRSI",
  shortName: "STOCHRSI",
  precision: 2,
  calcParams: [14, 14, 3, 3],
  figures: [
    { key: "k", title: "K: ", type: "line" },
    { key: "d", title: "D: ", type: "line" }
  ],
  calc: (dataList, indicator) => {
    const [rsiPeriod, stochPeriod, kSmooth, dSmooth] = indicator.calcParams;
    const closes = dataList.map((c) => c.close);
    const rsiValues = rsi(closes, rsiPeriod);

    const stochRsiRaw: (number | undefined)[] = new Array(dataList.length);
    for (let i = 0; i < dataList.length; i++) {
      if (i < rsiPeriod + stochPeriod - 1) {
        stochRsiRaw[i] = undefined;
        continue;
      }
      const window = rsiValues.slice(i - stochPeriod + 1, i + 1) as number[];
      if (window.some((v) => v === undefined)) {
        stochRsiRaw[i] = undefined;
        continue;
      }
      const hi = Math.max(...window);
      const lo = Math.min(...window);
      const current = rsiValues[i]!;
      stochRsiRaw[i] = hi === lo ? 0 : ((current - lo) / (hi - lo)) * 100;
    }

    // `sma()`'s rolling window sum is a running total (`sum += v; sum -=
    // v[i-period]`) — feeding it a placeholder `NaN` for the leading
    // undefined run would poison that running sum PERMANENTLY (`NaN - x`
    // is always `NaN`, so it never "rolls out" of the window the way a
    // real numeric placeholder would). `compactSma` avoids this by
    // smoothing only over the DEFINED-value run, then mapping the result
    // back onto the original (sparse) index space — used for both the K
    // and D smoothing passes below (caught by this module's own dev-time
    // fixture: an earlier version fed `NaN` into K's `sma()` call directly
    // and every K/D value downstream came back `NaN`, silently, with no
    // thrown error).
    const kValues = compactSma(stochRsiRaw, kSmooth, dataList.length);
    const dValues = compactSma(kValues, dSmooth, dataList.length);

    return dataList.map((_, i) => ({ k: kValues[i], d: dValues[i] }));
  }
};

// ── WMA / VWMA / HMA ──────────────────────────────────────────────────────

export const wmaIndicator: IndicatorTemplate<{ wma?: number }, number> = {
  name: "WMA",
  shortName: "WMA",
  precision: 2,
  calcParams: [20],
  figures: [{ key: "wma", title: "WMA: ", type: "line" }],
  calc: (dataList, indicator) => {
    const [period] = indicator.calcParams;
    const values = wma(
      dataList.map((c) => c.close),
      period
    );
    return dataList.map((_, i) => ({ wma: values[i] }));
  }
};

export const vwmaIndicator: IndicatorTemplate<{ vwma?: number }, number> = {
  name: "VWMA",
  shortName: "VWMA",
  precision: 2,
  calcParams: [20],
  figures: [{ key: "vwma", title: "VWMA: ", type: "line" }],
  calc: (dataList, indicator) => {
    const [period] = indicator.calcParams;
    const values = vwma(
      dataList.map((c) => c.close),
      dataList.map((c) => c.volume ?? 0),
      period
    );
    return dataList.map((_, i) => ({ vwma: values[i] }));
  }
};

export const hmaIndicator: IndicatorTemplate<{ hma?: number }, number> = {
  name: "HMA",
  shortName: "HMA",
  precision: 2,
  calcParams: [9],
  figures: [{ key: "hma", title: "HMA: ", type: "line" }],
  calc: (dataList, indicator) => {
    const [period] = indicator.calcParams;
    const values = hma(
      dataList.map((c) => c.close),
      period
    );
    return dataList.map((_, i) => ({ hma: values[i] }));
  }
};

// ── MFI ───────────────────────────────────────────────────────────────────

export const mfi: IndicatorTemplate<{ mfi?: number }, number> = {
  name: "MFI",
  shortName: "MFI",
  precision: 2,
  calcParams: [14],
  figures: [{ key: "mfi", title: "MFI: ", type: "line" }],
  calc: (dataList, indicator) => {
    const [period] = indicator.calcParams;
    const typicalPrices = dataList.map((c) => (c.high + c.low + c.close) / 3);
    const rawFlow = dataList.map((c, i) => typicalPrices[i] * (c.volume ?? 0));

    return dataList.map((_, i) => {
      if (i < period) return {};
      let posSum = 0;
      let negSum = 0;
      for (let k = i - period + 1; k <= i; k++) {
        if (k === 0) continue; // no prior typical price to compare the very first loaded bar against.
        if (typicalPrices[k] > typicalPrices[k - 1]) posSum += rawFlow[k];
        else if (typicalPrices[k] < typicalPrices[k - 1]) negSum += rawFlow[k];
      }
      if (negSum === 0) return { mfi: 100 };
      const moneyRatio = posSum / negSum;
      return { mfi: 100 - 100 / (1 + moneyRatio) };
    });
  }
};

// ── CMF ───────────────────────────────────────────────────────────────────

export const cmf: IndicatorTemplate<{ cmf?: number }, number> = {
  name: "CMF",
  shortName: "CMF",
  precision: 4,
  calcParams: [20],
  figures: [{ key: "cmf", title: "CMF: ", type: "line" }],
  calc: (dataList, indicator) => {
    const [period] = indicator.calcParams;
    const mfv = dataList.map((c: OhlcvCandle) => {
      const range = c.high - c.low;
      const multiplier = range === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / range;
      return multiplier * (c.volume ?? 0);
    });
    const volumes = dataList.map((c) => c.volume ?? 0);

    let mfvSum = 0;
    let volSum = 0;
    return dataList.map((_, i) => {
      mfvSum += mfv[i];
      volSum += volumes[i];
      if (i >= period) {
        mfvSum -= mfv[i - period];
        volSum -= volumes[i - period];
      }
      if (i < period - 1) return {};
      return { cmf: volSum === 0 ? 0 : mfvSum / volSum };
    });
  }
};

// ── AROON ─────────────────────────────────────────────────────────────────

export const aroon: IndicatorTemplate<{ up?: number; down?: number }, number> = {
  name: "AROON",
  shortName: "AROON",
  precision: 2,
  calcParams: [25],
  figures: [
    { key: "up", title: "Up: ", type: "line" },
    { key: "down", title: "Down: ", type: "line" }
  ],
  calc: (dataList, indicator) => {
    const [period] = indicator.calcParams;
    return dataList.map((_, i) => {
      if (i < period) return {};
      let highIdx = i - period;
      let lowIdx = i - period;
      for (let k = i - period; k <= i; k++) {
        if (dataList[k].high >= dataList[highIdx].high) highIdx = k;
        if (dataList[k].low <= dataList[lowIdx].low) lowIdx = k;
      }
      const barsSinceHigh = i - highIdx;
      const barsSinceLow = i - lowIdx;
      return {
        up: ((period - barsSinceHigh) / period) * 100,
        down: ((period - barsSinceLow) / period) * 100
      };
    });
  }
};

let registered = false;
export function registerPackB(): void {
  if (registered) return;
  registered = true;
  registerIndicator(atrx);
  registerIndicator(stochrsi);
  registerIndicator(wmaIndicator);
  registerIndicator(vwmaIndicator);
  registerIndicator(hmaIndicator);
  registerIndicator(mfi);
  registerIndicator(cmf);
  registerIndicator(aroon);
}
