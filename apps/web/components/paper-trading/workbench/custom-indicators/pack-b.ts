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

import { wilderAtr, wma, vwma, hma, moneyFlowIndex, stochRsi as computeStochRsi, aroon as computeAroon } from "@/lib/ta/math";

interface OhlcvCandle {
  high: number;
  low: number;
  close: number;
  volume?: number;
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
  // Founder-feedback pass (2026-08-03): calc body promoted to `lib/ta/math.ts`'s
  // `stochRsi()` (the exact NaN-poisoning `compactSma` fix this comment used
  // to describe now lives there, generalized) — the `STOCHRSI` signal chip
  // and this chart indicator now share one implementation.
  calc: (dataList, indicator) => {
    const [rsiPeriod, stochPeriod, kSmooth, dSmooth] = indicator.calcParams;
    return computeStochRsi(
      dataList.map((c) => c.close),
      rsiPeriod,
      stochPeriod,
      kSmooth,
      dSmooth
    );
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
  // Founder-feedback pass (2026-08-03): calc body promoted to `lib/ta/math.ts`'s
  // `moneyFlowIndex()` — the `MFI` signal chip and this chart indicator now
  // share one implementation.
  calc: (dataList, indicator) => {
    const [period] = indicator.calcParams;
    return moneyFlowIndex(dataList, period).map((mfi) => ({ mfi }));
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
  // Founder-feedback pass (2026-08-03): calc body promoted to `lib/ta/math.ts`'s
  // `aroon()` — the `AROON` signal chip and this chart indicator now share
  // one implementation.
  calc: (dataList, indicator) => {
    const [period] = indicator.calcParams;
    return computeAroon(dataList, period);
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
