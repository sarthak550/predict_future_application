/**
 * User Strategy Scripting (SS1) — the pure, Node-testable script-execution
 * seam. Zero klinecharts/DOM/Worker import — same "lib/ta/ stays free of
 * any klinecharts/workbench import" rule `strategies.ts`'s own module doc
 * states (this file only ever gets imported, never imports a UI/chart
 * module itself). Imported from TWO disjoint runtime contexts: (a)
 * `strategy-worker.ts`, bundled into the Charting Workbench's async chunk
 * and executed inside a real browser Web Worker, and (b) `lib/ta/
 * selfcheck.ts`, executed directly in Node via `tsx` with zero mocking —
 * `runScriptSync`/`resolveSignalsAgainstBars` take no `self`, no
 * `postMessage`, nothing Worker-shaped, so every code path here is
 * Node-callable.
 *
 * ## SECURITY BOUNDARY (verbatim, reproduced from the CEO brief — do not
 * paraphrase when referencing this program elsewhere)
 *
 * Scripts execute exclusively inside the author's own browser tab, inside a
 * dedicated Web Worker with no DOM access by construction and an emptied
 * global scope (denylist-neutralized `fetch`/`XMLHttpRequest`/`WebSocket`/
 * `EventSource`/`navigator`/`importScripts`/`Worker`/`SharedWorker`/
 * `indexedDB`/`caches`/`postMessage`/`close`/`BroadcastChannel`/
 * `MessageChannel`/timers/`location`, applied via non-configurable
 * `Object.defineProperty` before any user code runs). `eval`/`Function` are
 * deliberately left reachable — security rests on the emptied environment,
 * not on banning language features that add nothing to block once the
 * environment has nothing dangerous left in it. The worst realistic outcome
 * of a hostile or buggy script is self-XSS-equivalent: the author can only
 * affect data and computation already available to their own authenticated
 * session, in their own tab, and only for the duration of that one run
 * (spawn-per-run, 3-second hard terminate). Scripts are NEVER executed
 * server-side, NEVER executed in any other user's browser, and NEVER shared,
 * imported, or run cross-account in this program's scope. Sharing a script
 * with another user, or running any script anywhere other than the author's
 * own client, REQUIRES a genuine server-side sandboxing solution (a real
 * isolate/container boundary, not a Worker denylist) and is explicitly OUT OF
 * SCOPE for this entire program.
 *
 * **This file's own role in that boundary**: `runScriptSync` below is pure
 * computation — it neither knows nor cares whether it's running in a
 * denylisted Worker or a bare Node process (selfcheck). The ACTUAL denylist
 * enforcement (the real, non-configurable `Object.defineProperty` calls
 * against the true global object) lives ONLY in `strategy-worker.ts`,
 * applied once at worker boot, before any message handler exists — see that
 * file's own module doc. What THIS file provides is a SECOND, independent,
 * lexical-scope-based layer: `buildWrappedSource()`'s template locally
 * shadows every denylisted name with `const <name> = undefined;` before the
 * user's own source runs (the exact same technique the `console` shim below
 * already uses to intercept `console.log` calls). This shadow layer is
 * useful and genuinely effective against a script that just references the
 * bare name (`typeof fetch`, `new WebSocket(...)`), and — unlike the
 * Worker-level denylist — it also runs identically in Node, which is what
 * lets `ta:check` exercise it with a real, non-fabricated assertion instead
 * of a live-browser-only proof. It is NOT a substitute for the Worker-level
 * denylist: a lexical shadow can be bypassed by a script reaching the real
 * global object indirectly (`globalThis.fetch`, `eval("fetch")`) — closing
 * THAT gap is exactly why the Worker-level pass targets the true global
 * object with non-configurable property descriptors. SS3's live-browser
 * security matrix is what actually proves the real boundary; this file's
 * own denylist-template fixture (`ta:check`) is explicitly a structural/
 * Node-side smoke test, not a security proof — see `selfcheck.ts`'s own
 * comment on that fixture.
 */
import * as acorn from "acorn";

import {
  rawScriptSignalListSchema,
  USER_SCRIPT_MAX_SIGNALS,
  type RawScriptSignal,
} from "@predict-future/validation/userScripts";

import {
  aroon,
  awesomeOscillator,
  cci,
  dmi,
  ema,
  hma,
  ichimokuLines,
  macd,
  momentum,
  moneyFlowIndex,
  parabolicSar,
  rollingHigh,
  rollingLow,
  rsi,
  sessionVwap,
  sma,
  stdev,
  stochRsi,
  stochasticKdj,
  supertrend,
  vwma,
  williamsR,
  wilderAtr,
  wma,
} from "./math";
import { finalizeSignals, type StrategyCandle, type StrategySignal, type StrategySide } from "./strategies";

export type { RawScriptSignal };

/** The full outcome of one script run — the Worker's `postMessage` payload (minus resolved price/timestamp, see D3 in the module doc) and `runScriptSync`'s own Node-side return value share this exact shape. */
export type RawScriptOutcome =
  | { ok: true; signals: RawScriptSignal[]; logs: string[] }
  | { ok: false; error: { message: string; line?: number }; logs: string[] };

/** The documented, exact error message when a script doesn't define `run` — exported as a constant so `selfcheck.ts` asserts against this SAME string, never a hand-retyped copy that could drift. */
export const MISSING_RUN_FUNCTION_MESSAGE = "Script must define a top-level function named run(bars, ta, helpers).";

/** The honesty-law fallback when a script's `run()` return value doesn't structurally match `{index, side, note?}[]` — never a raw thrown exception, never a fabricated signal. */
export const INVALID_SCRIPT_RESULT_MESSAGE = "Script returned an invalid result.";

/**
 * SS3 — the signal-cap honesty log line QA flagged during SS1: D7's
 * truncate-not-reject contract silently drops everything past
 * `USER_SCRIPT_MAX_SIGNALS` with no visible trace anywhere the author can
 * see. A script that legitimately fires on every one of 25,000 bars "ran
 * successfully" per the documented contract, but the author has no way to
 * know their last N signals never made it to the chart/stats unless this is
 * said out loud. Pushed into the SAME `logs` array the console strip
 * already renders (`script-console.tsx` treats every entry uniformly, no
 * `line`/error styling needed for this one) — appended AFTER the script's
 * own `console.log` output, so it reads as the host's own closing note, not
 * something the script itself printed. Exported as a function (not a bare
 * string constant) since the exact counts are only known post-truncation —
 * `ta:check` asserts against this SAME function, never a hand-retyped copy.
 */
export function signalCapMessage(totalSignals: number, cap: number): string {
  return `Signal cap reached — showing the first ${cap.toLocaleString()} of ${totalSignals.toLocaleString()} signals.`;
}

/**
 * D9 — the reserved `PF_SIGNALS` `calcParams[0]` value that routes
 * `custom-indicators/pf-signals.ts`'s `calc()` into the precomputed-script
 * branch instead of the `STRATEGY_REGISTRY` template branch. Defined HERE
 * (not in `pf-signals.ts` itself, which imports `klinecharts`) so this
 * pure, Node-testable module stays the single source of truth and
 * `lib/ta/selfcheck.ts` can assert `SCRIPT_SENTINEL` is never a
 * `STRATEGY_REGISTRY` key without pulling `klinecharts` into a plain `tsx`
 * Node run — `pf-signals.ts` imports and re-exports this constant rather
 * than defining its own copy. Can never collide with a real strategy id:
 * every `STRATEGY_REGISTRY` key is a plain camelCase identifier
 * (`maCross`, `emaCross`, ...) and this value is neither camelCase nor a
 * valid identifier at all (leading + trailing double underscore).
 */
export const SCRIPT_SENTINEL = "__pf_script__";

// ── Denylist (shared key list; see this file's own module doc for what
// this layer does and does NOT protect against) ────────────────────────────

/**
 * The exact denylist target list (founder's own spec, reproduced verbatim
 * from the CEO brief). `strategy-worker.ts` imports this SAME array for its
 * real, `self`-targeting, non-configurable `Object.defineProperty` pass —
 * one source of truth for the key list, even though the two enforcement
 * sites (this file's lexical-shadow prologue vs. that file's real
 * global-object neutralization) are structurally different code.
 */
export const DENYLIST_KEYS = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "navigator",
  "importScripts",
  "Worker",
  "SharedWorker",
  "indexedDB",
  "caches",
  "postMessage",
  "close",
  "BroadcastChannel",
  "MessageChannel",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  "location",
] as const;

// ── buildWrappedSource / WRAP_LINE_OFFSET (D5) ──────────────────────────────

/**
 * `new Function(argNames..., body)` does NOT execute `body` starting at its
 * own line 1 — V8 internally wraps it as `function anonymous(<argNames>\n) {\n<body>\n}`
 * before parsing, which consumes exactly 2 lines ahead of the body's own
 * line 1, REGARDLESS of how many argument names are passed (they're all
 * joined onto the wrapper's own line 1). Verified empirically (Node v23,
 * V8): a body-relative throw on line 1 is reported as stack line 3; a
 * body-relative throw on line 2 is reported as stack line 4 — a stable +2
 * offset in both cases, independent of the 1 vs. 3 argument names tested.
 * This is a real, easy-to-miss source of a wrong `WRAP_LINE_OFFSET` if only
 * this file's OWN prologue lines are counted — it must be added to that
 * count, not assumed away.
 */
const FUNCTION_CTOR_IMPLICIT_LINE_OFFSET = 2;

/**
 * Fixed-line prologue: `"use strict"` + the `console` capturing shim (D6 —
 * a LOCAL const shadowing the real `console`, so lexical scoping alone
 * intercepts every `console.log` call the user's script makes) + the
 * denylist lexical-shadow layer (this file's own module doc — a SECOND,
 * Node-testable layer alongside `strategy-worker.ts`'s real Worker-level
 * denylist) + the `try {` that opens the user-source block. Every line here
 * is counted by `PROLOGUE_LINE_COUNT` below — never hand-typed at a call
 * site.
 */
const PROLOGUE = `"use strict";
const __pf_logs = [];
function __pf_stringify(value) {
  try {
    return typeof value === "string" ? value : String(value);
  } catch (stringifyError) {
    return "[unstringifiable value]";
  }
}
const console = {
  log: function () {
    if (__pf_logs.length < 500) {
      var __pf_args = Array.prototype.slice.call(arguments);
      __pf_logs.push(__pf_args.map(__pf_stringify).join(" "));
    }
  }
};
${DENYLIST_KEYS.map((key) => `const ${key} = undefined;`).join("\n")}
try {
`;

/**
 * `PROLOGUE`'s own line count (every `\n` in the template marks one line
 * boundary before the user's own first line begins) — computed from the
 * string itself, so a future edit to `PROLOGUE` can never silently
 * desynchronize `WRAP_LINE_OFFSET` from its actual content.
 */
const PROLOGUE_LINE_COUNT = PROLOGUE.split("\n").length - 1;

/**
 * The single constant every error-line correction in this program uses
 * (`toScriptError`). Derivation: `FUNCTION_CTOR_IMPLICIT_LINE_OFFSET` (V8's
 * own `new Function` wrapping, see that constant's doc) + `PROLOGUE_LINE_COUNT`
 * (this file's own prologue, see `PROLOGUE`'s doc). A script's own line `U`
 * is reported by V8 as wrapped-source line `U + WRAP_LINE_OFFSET`; correcting
 * back is `U = reportedLine - WRAP_LINE_OFFSET`.
 */
export const WRAP_LINE_OFFSET = FUNCTION_CTOR_IMPLICIT_LINE_OFFSET + PROLOGUE_LINE_COUNT;

/**
 * Fixed-line epilogue. `run` is looked up AFTER the user source has
 * executed (so a script can declare `run` anywhere among its own top-level
 * statements, not just first) — a missing/non-function `run` throws the
 * exact `MISSING_RUN_FUNCTION_MESSAGE` before ever attempting to call it
 * (D4). The wrapped function's actual RETURN VALUE is an envelope
 * `{__pfSignals, __pfLogs}`, not `run(...)`'s bare return value — this is
 * what lets `__pf_logs` (accumulated by the `console` shim above) escape
 * the `new Function(...)` call even on a successful run. On a THROWN error,
 * the `catch` block attaches `__pf_logs` onto the error object itself
 * (`e.__pfLogs`) before rethrowing, so partial log output from a script
 * that logs a few lines and then throws is never silently lost.
 */
const EPILOGUE = `
if (typeof run !== "function") {
  throw new Error(${JSON.stringify(MISSING_RUN_FUNCTION_MESSAGE)});
}
var __pf_result = run(bars, ta, helpers);
return { __pfSignals: __pf_result, __pfLogs: __pf_logs };
} catch (__pf_caught) {
  if (__pf_caught && typeof __pf_caught === "object") { __pf_caught.__pfLogs = __pf_logs; }
  throw __pf_caught;
}
`;

/**
 * Produces the EXACT text both `strategy-worker.ts` (inside the real
 * Worker) and `runScriptSync` (Node or Worker) execute via `new
 * Function(...)` — there is exactly ONE template, so `WRAP_LINE_OFFSET` can
 * never drift between "what got tested in Node" and "what actually runs in
 * the Worker."
 */
export function buildWrappedSource(userSource: string): string {
  return `${PROLOGUE}${userSource}\n${EPILOGUE}`;
}

// ── Error line-correction (D5) ──────────────────────────────────────────────

/**
 * `new Function(...)`'s SyntaxErrors (a genuine parse failure, before any
 * code executes) carry NO usable line/column through the public Error API
 * in V8 — verified empirically: `.stack`, `.message`, and even a custom
 * `Error.prepareStackTrace` CallSite hook all come back empty for a parse
 * failure (there is no execution frame to report a position from — the
 * failure happens before the function's own frame exists). This is a real,
 * cross-engine JS platform limitation, not a V8-Node quirk to work around
 * with a different construction technique (indirect eval and a
 * `//# sourceURL` comment were both tested and behave identically).
 *
 * The fix: parse the user's OWN raw source directly with `acorn` (a tiny,
 * dependency-free, battle-tested ECMAScript parser already present in this
 * repo's hoisted `node_modules` as a transitive dependency of the build
 * tooling, now also a direct `apps/web` dependency) BEFORE ever building the
 * wrapped source or calling `new Function`. Acorn's own parse errors carry a
 * precise `{line, column}` — and because this parses `userSource` verbatim
 * (not the wrapped text), the reported line is ALREADY relative to the
 * user's own source, with no `WRAP_LINE_OFFSET` arithmetic needed for this
 * path at all. A script that is valid JS on its own (D4's `function
 * run(bars, ta, helpers) {...}` top-level declaration) parses here exactly
 * as `sourceType: "script"` expects — `import`/`export` are rejected at
 * this stage too, a free extra safety property alongside the runtime
 * denylist.
 */
function checkSyntax(userSource: string): { message: string; line?: number } | undefined {
  try {
    acorn.parse(userSource, { ecmaVersion: 2022, sourceType: "script" });
    return undefined;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      const loc = (error as SyntaxError & { loc?: { line?: number; column?: number } }).loc;
      return { message: error.message, line: typeof loc?.line === "number" ? loc.line : undefined };
    }
    return { message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Extracts a body-relative line number from a THROWN (not parse-time)
 * error's `.stack` — reliable for this case (unlike the syntax-error case
 * above) because the throw happens DURING execution, so V8 has a real call
 * frame to report. `new Function`-created code shows up in the stack as
 * `<anonymous>:LINE:COL` (Node v23/V8, verified empirically) — scans every
 * stack line for the FIRST one containing this pattern (so an error thrown
 * a few frames deep, e.g. inside a helper the script itself defined, is
 * still located correctly) and takes the LAST `LINE:COL` match on that
 * line (a frame can legitimately contain two occurrences — one for its own
 * "eval at ..." caller position, one for its own position — the position
 * we want is always the trailing one).
 */
function extractLineFromErrorStack(stack: string | undefined): number | undefined {
  if (!stack) return undefined;
  for (const line of stack.split("\n")) {
    const matches = [...line.matchAll(/<anonymous>:(\d+):(\d+)/g)];
    if (matches.length > 0) {
      const lineNumber = Number(matches[matches.length - 1][1]);
      if (Number.isFinite(lineNumber)) return lineNumber;
    }
  }
  return undefined;
}

/**
 * Converts a thrown runtime error into the documented `{message, line?}`
 * shape, subtracting `WRAP_LINE_OFFSET` so the reported line is relative to
 * the user's OWN source, never the internal wrapped text. `line` is
 * `undefined` (never a wrong/fabricated number) whenever the stack doesn't
 * contain a locatable wrapped-source frame — same "never crash, never
 * fabricate" honesty law every other `lib/ta/` module in this codebase
 * already follows for its own edge cases.
 */
export function toScriptError(err: unknown, lineOffset: number): { message: string; line?: number } {
  if (err instanceof Error) {
    const rawLine = extractLineFromErrorStack(err.stack);
    const line = rawLine !== undefined ? Math.max(1, rawLine - lineOffset) : undefined;
    return { message: err.message || "Script threw an error.", line };
  }
  return { message: typeof err === "string" ? err : "Script threw a non-Error value." };
}

// ── The `ta` / `helpers` API surface (D6) ───────────────────────────────────

/**
 * Every function `ta.<name>(...)` exposes is the REAL `lib/ta/math.ts`
 * export, verbatim — the exact set named in the CEO brief's own Verified
 * Ground Truth (23 functions, plus `OhlcvLike` as the shared candle shape),
 * each bound to accept the SAME argument shape its own `math.ts` signature
 * already takes (closes array, candles array, or candles+period, per
 * function). This is WYSIWYG with what the chart's own indicators plot —
 * `math.ts`'s own module doc states the same law for chart indicators, this
 * just extends it to scripts. Frozen, module-level, built once — these are
 * stateless pure functions, no per-run construction needed (unlike
 * `helpers`, which closes over a fresh `logs` array per run).
 */
export const TA_NAMESPACE = Object.freeze({
  sma,
  ema,
  wilderAtr,
  stdev,
  rsi,
  macd,
  wma,
  hma,
  vwma,
  supertrend,
  rollingHigh,
  rollingLow,
  sessionVwap,
  parabolicSar,
  stochasticKdj,
  williamsR,
  cci,
  dmi,
  awesomeOscillator,
  momentum,
  moneyFlowIndex,
  stochRsi,
  ichimokuLines,
  aroon,
});

export type ScriptTaNamespace = typeof TA_NAMESPACE;

export interface ScriptHelpers {
  buy(index: number, note?: string): RawScriptSignal;
  sell(index: number, note?: string): RawScriptSignal;
  /**
   * Wraps `strategies.ts`'s REAL `finalizeSignals` — this is what makes a
   * script rewriting e.g. `maCross` (SS2's template-parity fixtures) able
   * to reach byte-identical parity with the real template without a second
   * hand-rolled dedup implementation. Safe cast: `finalizeSignals` only
   * ever reads `.index`/`.side` internally (verified from its own source in
   * `./strategies` — it sorts by `.index` and compares `.side`, never
   * touches `.price`/`.timestamp`), so routing script-produced `{index,
   * side, note?}` tuples through it — deliberately WITHOUT price/timestamp,
   * see this module's own `RawScriptOutcome` doc — is safe at runtime even
   * though the imported type signature is `StrategySignal[]`.
   */
  finalize(signals: readonly RawScriptSignal[]): RawScriptSignal[];
  /** Convenience: `bars.map((b) => b.close)` — the single most common shape `ta.*` functions want. Not required by any locked decision, added per D6's "additional convenience helpers... CTO's call." */
  closes(bars: readonly StrategyCandle[]): number[];
}

function finalizeRawScriptSignals(raw: readonly RawScriptSignal[]): RawScriptSignal[] {
  return finalizeSignals(raw as unknown as StrategySignal[]) as unknown as RawScriptSignal[];
}

function buildHelpers(): ScriptHelpers {
  return {
    buy(index: number, note?: string): RawScriptSignal {
      return note !== undefined ? { index, side: "BUY", note } : { index, side: "BUY" };
    },
    sell(index: number, note?: string): RawScriptSignal {
      return note !== undefined ? { index, side: "SELL", note } : { index, side: "SELL" };
    },
    finalize: finalizeRawScriptSignals,
    closes(bars: readonly StrategyCandle[]): number[] {
      return bars.map((b) => b.close);
    },
  };
}

// ── runScriptSync (D1) ───────────────────────────────────────────────────────

interface WrappedRunEnvelope {
  __pfSignals: unknown;
  __pfLogs: unknown;
}

function isWrappedRunEnvelope(value: unknown): value is WrappedRunEnvelope {
  return typeof value === "object" && value !== null && "__pfSignals" in value && "__pfLogs" in value;
}

function normalizeLogs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * The pure, Node-testable core: no `self`, no `postMessage`, no Worker —
 * 100% callable from a plain Node process (`selfcheck.ts`) with zero
 * mocking, and the EXACT SAME function `strategy-worker.ts` calls inside
 * the real sandboxed Worker (see D1 in the CEO brief). Never throws — every
 * failure mode (a syntax error, a thrown runtime error, a malformed return
 * value) resolves to a clean `{ok: false, error, logs}`, per this
 * codebase's established honesty law (never crash the caller, never
 * fabricate a result).
 */
export function runScriptSync(userSource: string, bars: readonly StrategyCandle[]): RawScriptOutcome {
  const syntaxError = checkSyntax(userSource);
  if (syntaxError) {
    return { ok: false, error: syntaxError, logs: [] };
  }

  const wrapped = buildWrappedSource(userSource);
  const helpers = buildHelpers();

  let raw: unknown;
  try {
    // eslint-disable-next-line no-new-func -- deliberate: this IS the sandboxed script-execution seam (see module doc's SECURITY BOUNDARY section).
    const fn = new Function("bars", "ta", "helpers", wrapped);
    raw = fn(bars, TA_NAMESPACE, helpers);
  } catch (err: unknown) {
    const logs = normalizeLogs((err as { __pfLogs?: unknown } | null | undefined)?.__pfLogs);
    return { ok: false, error: toScriptError(err, WRAP_LINE_OFFSET), logs };
  }

  const logs = isWrappedRunEnvelope(raw) ? normalizeLogs(raw.__pfLogs) : [];
  const signalsValue = isWrappedRunEnvelope(raw) ? raw.__pfSignals : undefined;

  const parsed = rawScriptSignalListSchema.safeParse(signalsValue);
  if (!parsed.success) {
    return { ok: false, error: { message: INVALID_SCRIPT_RESULT_MESSAGE }, logs };
  }

  // D7: truncate, never reject — a script producing more signals than the
  // chart can usefully render still "ran successfully." An explicit slice
  // AFTER structural validation (never a zod `.max()` bound — see
  // `rawScriptSignalListSchema`'s own doc comment for why).
  const exceedsCap = parsed.data.length > USER_SCRIPT_MAX_SIGNALS;
  const signals = exceedsCap ? parsed.data.slice(0, USER_SCRIPT_MAX_SIGNALS) : parsed.data;
  // SS3 honesty log line — see `signalCapMessage`'s own doc. Appended after
  // the script's own console output, never replacing it.
  const outLogs = exceedsCap ? [...logs, signalCapMessage(parsed.data.length, USER_SCRIPT_MAX_SIGNALS)] : logs;

  return { ok: true, signals, logs: outLogs };
}

// ── resolveSignalsAgainstBars (D3) ──────────────────────────────────────────

/**
 * Resolves a script's raw `{index, side, note?}` tuples into real
 * `StrategySignal`s — `price`/`timestamp` are taken DIRECTLY from the
 * caller's own `bars[index]`, NEVER from anything the script returned (a
 * script's `RawScriptSignal` deliberately has no `price`/`timestamp` field
 * at all — see `RawScriptOutcome`'s own doc — so there is nothing to trust
 * even if a script tried). An out-of-range `index` (negative, non-integer,
 * `>= bars.length`) is DROPPED silently — never coerced, clamped, or
 * crashed on. `note` is intentionally dropped here: `StrategySignal` (the
 * shared type every strategy, template or script, produces) has no `note`
 * field, and this sprint doesn't touch `strategies.ts` to add one — a
 * console/notes UI for scripts is SS2 scope.
 *
 * **Caller contract**: resolve against the `bars` array captured AT
 * DISPATCH time (the same snapshot sent to the worker), never a `bars`
 * value re-read after the run started — see `script-runner.ts`'s own doc
 * for why (an interval switch mid-run must not misattribute prices to the
 * wrong candles).
 */
export function resolveSignalsAgainstBars(rawSignals: readonly RawScriptSignal[], bars: readonly StrategyCandle[]): StrategySignal[] {
  const out: StrategySignal[] = [];
  for (const raw of rawSignals) {
    if (!Number.isInteger(raw.index) || raw.index < 0 || raw.index >= bars.length) continue;
    const bar = bars[raw.index];
    out.push({ index: raw.index, timestamp: bar.timestamp, side: raw.side as StrategySide, price: bar.close });
  }
  return out;
}
