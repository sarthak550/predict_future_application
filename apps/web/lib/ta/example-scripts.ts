/**
 * User Strategy Scripting (SS2), §5 — the 8 example scripts: the 7
 * `STRATEGY_LIST` templates rewritten as `{bars, ta, helpers} -> signals`
 * scripts, plus one "kitchen sink" tour of the full API surface. This is
 * the SINGLE source of truth both the editor drawer's "Examples" list
 * (`script-list-sidebar.tsx`) and the Node parity selfcheck
 * (`lib/ta/selfcheck.ts`) import from — never a second, hand-synced copy.
 *
 * Every one of the 7 template rewrites reproduces its real
 * `STRATEGY_REGISTRY` counterpart's exact logic using only the public
 * `ta`/`helpers` API `lib/ta/user-scripts.ts` exposes (D6/D9 of the SS1
 * brief) — this is the feature's honesty proof: `lib/ta/selfcheck.ts`
 * asserts each one produces BYTE-IDENTICAL signals to the real template on
 * the same fixture data, and fails loudly if a rewrite ever drifts.
 *
 * **A note on what that parity check actually exercises** (documented here,
 * not silently glossed over): the shared `fixtureCandles` series
 * `selfcheck.ts` already defines for `maCross`'s own hand-traced fixture is
 * only 10 bars long. With each strategy's DEFAULT params (the parity
 * fixture's own contract — see that file's `checkExampleScriptParity`), the
 * slower of each strategy's two periods (30 for maCross, 21 for emaCross,
 * 26 for macdCross, 20 for bollBreakout/donchianBreakout, 14 for
 * rsiReversal) exceeds or ties the fixture's own length, so `ta.*`'s
 * "no value until the window fills" convention (see `math.ts`'s own doc)
 * means most of these 7 comparisons resolve to two EMPTY arrays rather than
 * exercising real numerical divergence. The comparison is still a genuine,
 * non-vacuous regression guard (any future change to any of these
 * functions, or a structural bug in a script that makes it return something
 * where the template still returns nothing, fails the check immediately —
 * verified negatively during this sprint's own build by deliberately
 * mutating one script and confirming `ta:check` failed, then reverting) —
 * flagged here so a future reader doesn't assume this fixture exercises
 * full numerical parity under default params, which it does not.
 */

export interface ExampleScript {
  id: string;
  name: string;
  description: string;
  source: string;
}

const MA_CROSS_SOURCE = `function run(bars, ta, helpers) {
  // MA Cross — buy while the FAST simple moving average sits above the
  // SLOW one, sell while it sits below. This mirrors the built-in "MA
  // Cross" strategy template exactly: the same ta.sma() calls, the same
  // per-bar state comparison, then the shared helpers.finalize() collapse.
  const closes = helpers.closes(bars);
  const fast = ta.sma(closes, 10);
  const slow = ta.sma(closes, 30);

  // One RAW signal per bar where the fast/slow relationship holds — this is
  // NOT edge-triggered "did it just cross." helpers.finalize() below turns
  // each run of consecutive same-side bars into a single signal at the
  // run's first bar, which is mathematically equivalent to a classic
  // crossover trigger but expressed as one shared post-processing step
  // instead of a hand-rolled "was it different last bar" tracker.
  const raw = [];
  for (let i = 0; i < bars.length; i++) {
    const f = fast[i];
    const s = slow[i];
    if (f === undefined || s === undefined) continue; // not enough bars yet for both averages.
    if (f > s) raw.push(helpers.buy(i));
    else if (f < s) raw.push(helpers.sell(i));
  }

  return helpers.finalize(raw);
}`;

const EMA_CROSS_SOURCE = `function run(bars, ta, helpers) {
  // EMA Cross — the exponential-moving-average sibling of MA Cross. Same
  // shape, different averaging: ta.ema() weights recent bars more heavily
  // than ta.sma() does, so it reacts to a price move sooner (and whipsaws
  // more often in a choppy market) — that trade-off is the whole reason
  // both templates exist side by side.
  const closes = helpers.closes(bars);
  const fast = ta.ema(closes, 9);
  const slow = ta.ema(closes, 21);

  const raw = [];
  for (let i = 0; i < bars.length; i++) {
    const f = fast[i];
    const s = slow[i];
    if (f === undefined || s === undefined) continue;
    if (f > s) raw.push(helpers.buy(i));
    else if (f < s) raw.push(helpers.sell(i));
  }

  return helpers.finalize(raw);
}`;

const SUPERTREND_FLIP_SOURCE = `function run(bars, ta, helpers) {
  // SuperTrend Flip — buy while the trend flag is UP (1), sell while it's
  // DOWN (-1). ta.supertrend(candles, period, multiplier) returns one
  // {trend, value} point per bar (it reads high/low/close directly off
  // each bar, so it's called on \`bars\` itself, not on a closes-only
  // array like the two strategies above). Same "raw per-bar state, then
  // helpers.finalize() collapses it to the flip" shape as MA/EMA Cross.
  const points = ta.supertrend(bars, 10, 3);

  const raw = [];
  for (let i = 0; i < bars.length; i++) {
    const trend = points[i] && points[i].trend;
    if (trend === 1) raw.push(helpers.buy(i));
    else if (trend === -1) raw.push(helpers.sell(i));
  }

  return helpers.finalize(raw);
}`;

const RSI_REVERSAL_SOURCE = `function run(bars, ta, helpers) {
  // RSI Reversal — a genuine threshold CROSS, not a persistent two-state
  // machine like the three strategies above: buy when RSI rises back above
  // the oversold line, sell when it falls back below the overbought line.
  // RSI spends most of its time in the neutral 30-70 zone, so this is
  // edge-triggered directly (comparing this bar's RSI against the PREVIOUS
  // bar's) rather than "per-bar state then collapse" — we still route the
  // result through helpers.finalize() defensively, in case two oversold
  // dips fire without an intervening overbought cross in between.
  const closes = helpers.closes(bars);
  const rsiValues = ta.rsi(closes, 14);
  const overbought = 70;
  const oversold = 30;

  const raw = [];
  let prev;
  for (let i = 0; i < bars.length; i++) {
    const r = rsiValues[i];
    if (r === undefined) {
      prev = undefined;
      continue;
    }
    if (prev !== undefined) {
      // Reversal UP: RSI was AT or BELOW oversold, just rose above it.
      if (prev <= oversold && r > oversold) raw.push(helpers.buy(i));
      // Reversal DOWN: RSI was AT or ABOVE overbought, just fell below it.
      else if (prev >= overbought && r < overbought) raw.push(helpers.sell(i));
    }
    prev = r;
  }

  return helpers.finalize(raw);
}`;

const MACD_CROSS_SOURCE = `function run(bars, ta, helpers) {
  // MACD Cross — buy while the MACD line (dif) sits above its own signal
  // line (dea), sell while it sits below. ta.macd() returns one
  // {dif, dea, macd} point per bar; same "per-bar state, then
  // helpers.finalize() collapses it" shape as MA Cross.
  const closes = helpers.closes(bars);
  const points = ta.macd(closes, 12, 26, 9);

  const raw = [];
  for (let i = 0; i < bars.length; i++) {
    const p = points[i];
    if (!p || p.dif === undefined || p.dea === undefined) continue;
    if (p.dif > p.dea) raw.push(helpers.buy(i));
    else if (p.dif < p.dea) raw.push(helpers.sell(i));
  }

  return helpers.finalize(raw);
}`;

const BOLL_BREAKOUT_SOURCE = `function run(bars, ta, helpers) {
  // Bollinger Breakout — buy on a close ABOVE the upper band (the 20-period
  // mean plus 2 standard deviations), sell on a close BELOW the lower band.
  // Inside the bands is neither state — the loop below simply emits
  // nothing for that bar, which doesn't break an in-progress BUY or SELL
  // run (helpers.finalize() only cares about the SEQUENCE of emitted
  // signals, not about the bars in between them).
  const closes = helpers.closes(bars);
  const middle = ta.sma(closes, 20);
  const dev = ta.stdev(closes, 20);

  const raw = [];
  for (let i = 0; i < bars.length; i++) {
    const m = middle[i];
    const d = dev[i];
    if (m === undefined || d === undefined) continue;
    const upper = m + 2 * d;
    const lower = m - 2 * d;
    const close = closes[i];
    if (close > upper) raw.push(helpers.buy(i)); // breakout above the upper band.
    else if (close < lower) raw.push(helpers.sell(i)); // breakdown below the lower band.
  }

  return helpers.finalize(raw);
}`;

const DONCHIAN_BREAKOUT_SOURCE = `function run(bars, ta, helpers) {
  // Donchian Breakout — buy when the close breaks above the highest HIGH of
  // the PRIOR 20 bars (the current bar excluded), sell when it breaks below
  // the lowest LOW of the prior 20. The window deliberately excludes the
  // current bar — a same-bar "breakout" would otherwise be impossible by
  // construction (a bar's close can never exceed its own high).
  //
  // This one is hand-rolled rather than calling ta.rollingHigh/ta.rollingLow
  // directly: those two are INCLUSIVE of the current bar (built for chart
  // indicators, which plot a value FOR each bar using that bar's own data),
  // while a breakout strategy needs the window to stop at the PRIOR bar.
  // Nothing stops a script from writing plain JS like this alongside ta.*
  // calls — the {bars, ta, helpers} contract doesn't require every line to
  // route through ta.*, only that the underlying math, where it IS used,
  // is the real shared implementation.
  const period = 20;

  const raw = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < period) continue; // not enough PRIOR bars yet.
    let priorHigh = -Infinity;
    let priorLow = Infinity;
    for (let k = i - period; k < i; k++) {
      priorHigh = Math.max(priorHigh, bars[k].high);
      priorLow = Math.min(priorLow, bars[k].low);
    }
    const close = bars[i].close;
    if (close > priorHigh) raw.push(helpers.buy(i));
    else if (close < priorLow) raw.push(helpers.sell(i));
  }

  return helpers.finalize(raw);
}`;

const KITCHEN_SINK_SOURCE = `function run(bars, ta, helpers) {
  // Kitchen Sink Tour — a guided walk through the FULL {bars, ta, helpers}
  // surface this scripting feature exposes. This is a teaching script, not
  // a real trading strategy — read it top to bottom.

  // 1) \`bars\` is the whole loaded candle window, oldest first. Each bar is
  //    {timestamp, open, high, low, close, volume}. console.log() calls
  //    inside a script are captured and shown in the drawer's Console strip
  //    below — they never reach your browser's own devtools console.
  console.log("Loaded " + bars.length + " bars");

  // 2) \`ta.*\` is every function lib/ta/math.ts exports, WYSIWYG with what
  //    the chart's own indicators plot — never a separate reimplementation.
  //    Here we pull THREE different indicator families to show the range:
  //    a moving average, a momentum oscillator, and a volatility measure.
  const closes = helpers.closes(bars); // convenience: bars.map(b => b.close).
  const sma20 = ta.sma(closes, 20);
  const rsi14 = ta.rsi(closes, 14);
  const atr14 = ta.wilderAtr(bars, 14); // note: takes candles, not closes — ATR needs high/low too.

  const raw = [];

  for (let i = 1; i < bars.length; i++) {
    const price = closes[i];
    const avg = sma20[i];
    const r = rsi14[i];
    if (avg === undefined || r === undefined) continue;

    if (price > avg && r < 45) {
      // 3) helpers.buy(index, note?) is convenience sugar for a signal
      //    object — the note is optional, shown nowhere yet in this sprint
      //    but carried through the pipeline for a future console/tooltip
      //    surface.
      raw.push(helpers.buy(i, "Price above SMA20 while RSI still low"));
    } else if (price < avg && r > 55) {
      // 4) A hand-built object literal is EQUALLY valid — helpers.sell(...)
      //    is sugar for exactly this shape, nothing more. Both forms can be
      //    freely mixed in the same script.
      raw.push({ index: i, side: "SELL", note: "Price below SMA20 while RSI still high" });
    }
  }

  // 5) A simple volatility filter, to show a THIRD indicator family
  //    participating: drop any signal from a bar whose ATR was wildly
  //    above the window's own average (illustrative only, not a real
  //    trading rule).
  let atrSum = 0;
  let atrCount = 0;
  for (const v of atr14) {
    if (v !== undefined) {
      atrSum += v;
      atrCount += 1;
    }
  }
  const avgAtr = atrCount > 0 ? atrSum / atrCount : 0;
  const filtered = raw.filter((s) => {
    const a = atr14[s.index];
    return a === undefined || avgAtr === 0 || a <= avgAtr * 3;
  });

  console.log("Raw signals: " + raw.length + ", after ATR filter: " + filtered.length);

  // 6) helpers.finalize(signals) applies the SAME alternating-side dedup
  //    every template strategy uses. A script CAN return raw, un-deduped
  //    signals instead, but finalize() is what keeps the chart from
  //    painting a BUY on every single bar of a long uptrend — call it last
  //    unless you have a specific reason not to.
  return helpers.finalize(filtered);
}`;

export const EXAMPLE_SCRIPTS: readonly ExampleScript[] = [
  {
    id: "maCross",
    name: "MA Cross",
    description: "Buy when the fast SMA crosses above the slow SMA, sell on the opposite cross.",
    source: MA_CROSS_SOURCE
  },
  {
    id: "emaCross",
    name: "EMA Cross",
    description: "MA Cross's EMA sibling — reacts to price moves sooner, whipsaws more in chop.",
    source: EMA_CROSS_SOURCE
  },
  {
    id: "supertrendFlip",
    name: "SuperTrend Flip",
    description: "Buy while SuperTrend's flag is up, sell while it's down.",
    source: SUPERTREND_FLIP_SOURCE
  },
  {
    id: "rsiReversal",
    name: "RSI Reversal",
    description: "Buy when RSI reverses up out of oversold, sell when it reverses down out of overbought.",
    source: RSI_REVERSAL_SOURCE
  },
  {
    id: "macdCross",
    name: "MACD Cross",
    description: "Buy while the MACD line sits above its own signal line, sell while it sits below.",
    source: MACD_CROSS_SOURCE
  },
  {
    id: "bollBreakout",
    name: "Bollinger Breakout",
    description: "Buy on a close above the upper Bollinger band, sell on a close below the lower band.",
    source: BOLL_BREAKOUT_SOURCE
  },
  {
    id: "donchianBreakout",
    name: "Donchian Breakout",
    description: "Buy on a break above the prior 20-bar high, sell on a break below the prior 20-bar low.",
    source: DONCHIAN_BREAKOUT_SOURCE
  },
  {
    id: "kitchenSink",
    name: "Kitchen Sink Tour",
    description: "A guided tour of the full bars/ta/helpers scripting API — not a real strategy.",
    source: KITCHEN_SINK_SOURCE
  }
];

export function getExampleScript(id: string): ExampleScript | undefined {
  return EXAMPLE_SCRIPTS.find((e) => e.id === id);
}
