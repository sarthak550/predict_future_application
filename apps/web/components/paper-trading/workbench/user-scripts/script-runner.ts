/**
 * User Strategy Scripting (SS1) — `script-runner.ts`. Main-thread
 * spawn-per-run orchestration around `strategy-worker.ts` (D5). This is the
 * ONLY place price/timestamp resolution happens (`resolveSignalsAgainstBars`,
 * D3) — the worker itself only ever emits `{index, side, note?}` tuples.
 *
 * Invariants (non-negotiable, per the CEO brief):
 *  - Spawn-per-run: every `runUserScript` call creates a FRESH `Worker`
 *    (never reused across runs) via bundler-native `new Worker(new
 *    URL("./strategy-worker.ts", import.meta.url))`.
 *  - 3000ms hard terminate: if no response lands within `RUN_TIMEOUT_MS`,
 *    the worker is terminated and the promise resolves with a factual
 *    (non-editorializing) timeout message.
 *  - One-shot listener: the `message`/`error` listeners are `{once: true}`
 *    AND explicitly removed inside `finish()` — so a forged or duplicate
 *    `postMessage` cannot produce a second result, structurally, not just
 *    by convention.
 *  - One in-flight run at a time: calling `runUserScript` again while a
 *    previous call hasn't resolved terminates the STALE worker first (via
 *    the module-level `currentRun` ref) and resolves the stale call's own
 *    promise with a clean "superseded" outcome — never left hanging.
 */
import { rawScriptSignalListSchema } from "@predict-future/validation/userScripts";

import { resolveSignalsAgainstBars } from "@/lib/ta/user-scripts";
import type { StrategyCandle, StrategySignal } from "@/lib/ta/strategies";

const RUN_TIMEOUT_MS = 3000;

/** Factual, non-editorializing — matches this codebase's existing disclaimer/error-copy honesty law (see e.g. `lib/ta/backtest.ts`'s own cost-honesty comments). */
export const SCRIPT_TIMEOUT_MESSAGE = "Script did not finish within 3 seconds and was stopped.";
export const SCRIPT_SUPERSEDED_MESSAGE = "Script run was superseded by a newer run.";
const MALFORMED_RESPONSE_MESSAGE = "Malformed response from strategy worker.";
const INVALID_SIGNALS_MESSAGE = "Script returned an invalid result.";

export type ScriptRunResult =
  | { ok: true; signals: StrategySignal[]; logs: string[] }
  | { ok: false; error: { message: string; line?: number }; logs: string[] };

interface InFlightRun {
  worker: Worker;
  finish: (result: ScriptRunResult) => void;
}

/** At most one in-flight run — never an accumulating list. See module doc. */
let currentRun: InFlightRun | null = null;

function normalizeLogs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function isWorkerResponseShape(
  value: unknown
): value is { ok: boolean; signals?: unknown; error?: { message?: unknown; line?: unknown }; logs?: unknown } {
  return typeof value === "object" && value !== null && typeof (value as { ok?: unknown }).ok === "boolean";
}

/**
 * D8 belt-and-suspenders: the worker's `postMessage` payload has already
 * round-tripped through structured-clone, but re-validating on receipt is
 * cheap and catches any drift between the worker's and main thread's type
 * expectations. `resolveSignalsAgainstBars` is called against
 * `dispatchTimeBars` — the snapshot captured when THIS run was dispatched,
 * never a `bars` value re-read at resolve time (D3's edge case: if the user
 * switched chart interval while this script was still running, resolving
 * against a newly-loaded `bars` array would silently misattribute
 * prices/timestamps to the wrong candles).
 */
function interpretWorkerResponse(data: unknown, dispatchTimeBars: readonly StrategyCandle[]): ScriptRunResult {
  if (!isWorkerResponseShape(data)) {
    return { ok: false, error: { message: MALFORMED_RESPONSE_MESSAGE }, logs: [] };
  }

  const logs = normalizeLogs(data.logs);

  if (!data.ok) {
    const message = typeof data.error?.message === "string" ? data.error.message : MALFORMED_RESPONSE_MESSAGE;
    const line = typeof data.error?.line === "number" ? data.error.line : undefined;
    return { ok: false, error: { message, line }, logs };
  }

  const parsed = rawScriptSignalListSchema.safeParse(data.signals);
  if (!parsed.success) {
    return { ok: false, error: { message: INVALID_SIGNALS_MESSAGE }, logs };
  }

  return { ok: true, signals: resolveSignalsAgainstBars(parsed.data, dispatchTimeBars), logs };
}

/**
 * Runs one user script in a fresh, spawn-per-run Worker. Resolves — NEVER
 * rejects — with either `{ok: true, signals, logs}` or `{ok: false, error,
 * logs}`; every failure mode (timeout, worker crash, malformed response,
 * superseded by a newer call) is a clean resolved outcome, never a thrown
 * exception a caller has to remember to catch.
 */
export function runUserScript(source: string, bars: readonly StrategyCandle[]): Promise<ScriptRunResult> {
  // One in-flight run at a time — terminate the stale run's worker and
  // settle ITS promise before starting a new one.
  if (currentRun) {
    currentRun.finish({ ok: false, error: { message: SCRIPT_SUPERSEDED_MESSAGE }, logs: [] });
  }

  // Dispatch-time snapshot — see module doc / D3.
  const dispatchTimeBars = bars;

  return new Promise<ScriptRunResult>((resolvePromise) => {
    let settled = false;
    const worker = new Worker(new URL("./strategy-worker.ts", import.meta.url));

    const finish = (result: ScriptRunResult) => {
      if (settled) return;
      settled = true;
      if (currentRun?.worker === worker) {
        currentRun = null;
      }
      clearTimeout(timeoutId);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.terminate();
      resolvePromise(result);
    };

    const onMessage = (event: MessageEvent<unknown>) => {
      finish(interpretWorkerResponse(event.data, dispatchTimeBars));
    };

    const onError = (event: ErrorEvent) => {
      finish({ ok: false, error: { message: event.message || "Script worker crashed unexpectedly." }, logs: [] });
    };

    // ONE-SHOT: `{once: true}` self-removes on fire; `finish()` ALSO
    // explicitly removes both listeners for the paths where they never
    // fire at all (timeout, superseded-by-a-newer-run) — without that,
    // `worker.terminate()` alone doesn't guarantee the listener references
    // are released before this closure's `worker` binding goes out of scope.
    worker.addEventListener("message", onMessage, { once: true });
    worker.addEventListener("error", onError, { once: true });

    const timeoutId = setTimeout(() => {
      finish({ ok: false, error: { message: SCRIPT_TIMEOUT_MESSAGE }, logs: [] });
    }, RUN_TIMEOUT_MS);

    currentRun = { worker, finish };
    worker.postMessage({ source, bars: dispatchTimeBars });
  });
}
