/**
 * User Strategy Scripting (SS1) — `strategy-worker.ts`. THE CODEBASE'S
 * FIRST WEB WORKER (`grep -rn "new Worker(" apps/web` returned nothing
 * before this file — confirmed at brief-issue time). A thin transport
 * wrapper around `lib/ta/user-scripts.ts`'s `runScriptSync` — all the real
 * script-execution logic lives there (Node-testable, zero Worker
 * dependency); this file's only jobs are (1) apply the real security
 * denylist to this worker's own global scope, once, before anything else
 * runs, and (2) relay one `{source, bars}` request to `runScriptSync` and
 * post back its raw outcome.
 *
 * ## SECURITY BOUNDARY (verbatim — do not paraphrase)
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
 * **Free layer-0 defense, worth naming explicitly**: Workers never have
 * `document`/`window`/synchronous `localStorage` access by spec, in ANY
 * Worker, denylist or not — this exists before a single line of this
 * sprint's code runs, so the worst case above is bounded even before this
 * file's own denylist pass executes.
 *
 * ## Mechanism (D2)
 *
 * Real `postMessage`/`close` references are captured as LOCAL BOUND CONSTS
 * FIRST — the denylist below neutralizes the GLOBAL names (`self.postMessage`,
 * `self.close`), not these already-bound local references, so this worker
 * can still report its own result and self-terminate after neutralizing
 * everything else. Each key is neutralized via `Object.defineProperty(self,
 * key, {value: undefined, writable: false, configurable: false, enumerable:
 * false})` inside a `try {} catch {}` — some globals may already be
 * non-configurable (fine, already inert; the catch just no-ops).
 * Neutralizing `Worker`/`SharedWorker` specifically blocks a script from
 * spawning a NESTED worker to escape `script-runner.ts`'s 3-second watchdog
 * (a child worker wouldn't be covered by that file's `terminate()` call on
 * THIS worker's own handle). Neutralizing every timer/microtask scheduling
 * API is deliberate: scripts are a synchronous "whole-series in, signals
 * out" contract (D4, `lib/ta/user-scripts.ts`'s `runScriptSync`) — there is
 * no legitimate reason for a script to schedule anything async, and removing
 * that capability removes an entire class of "outlives the run" escape
 * shapes.
 *
 * This file's `DENYLIST_KEYS` list is imported from `lib/ta/user-scripts.ts`
 * — the SAME array that file's own `buildWrappedSource()` uses for its
 * (weaker, lexical-shadow-only) Node-testable denylist layer, so the key
 * LIST itself never drifts between the two enforcement sites even though
 * the sites themselves are structurally different code (this file targets
 * the real global object with `Object.defineProperty`; that file's template
 * shadows names with local `const`s).
 */
import { DENYLIST_KEYS, runScriptSync, type RawScriptSignal } from "@/lib/ta/user-scripts";
import type { StrategyCandle } from "@/lib/ta/strategies";

/** Minimal shape this file actually needs from the worker global scope — deliberately NOT the full `DedicatedWorkerGlobalScope` type, since this repo's `tsconfig.base.json` lib set is `["dom", "dom.iterable", "es2022"]` with no `"webworker"` entry (adding it would conflict with `dom`'s own incompatible `self`/`postMessage` declarations across the rest of the app's single shared tsconfig). */
interface WorkerGlobalShape {
  postMessage: (message: unknown) => void;
  close: () => void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

const workerSelf = self as unknown as WorkerGlobalShape;

// Capture the REAL references FIRST — before the denylist loop below can
// neutralize the global names they're read from.
const __realPostMessage = workerSelf.postMessage.bind(workerSelf);
const __realClose = workerSelf.close.bind(workerSelf);

// Apply the denylist ONCE, at module top-level, before `onmessage` is ever
// assigned — see this file's own module doc (D2) for the exact mechanism
// and rationale.
for (const key of DENYLIST_KEYS) {
  try {
    Object.defineProperty(self, key, {
      value: undefined,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  } catch {
    // Already non-configurable (or otherwise inert) — fine, that's the goal either way.
  }
}

interface StrategyWorkerRequest {
  source: string;
  bars: StrategyCandle[];
}

interface StrategyWorkerOkResponse {
  ok: true;
  signals: RawScriptSignal[];
  logs: string[];
}

interface StrategyWorkerErrorResponse {
  ok: false;
  error: { message: string; line?: number };
  logs: string[];
}

export type StrategyWorkerResponse = StrategyWorkerOkResponse | StrategyWorkerErrorResponse;

function isStrategyWorkerRequest(value: unknown): value is StrategyWorkerRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { source?: unknown }).source === "string" &&
    Array.isArray((value as { bars?: unknown }).bars)
  );
}

workerSelf.onmessage = (event: { data: unknown }) => {
  if (!isStrategyWorkerRequest(event.data)) {
    __realPostMessage({ ok: false, error: { message: "Malformed request to strategy worker." }, logs: [] } satisfies StrategyWorkerResponse);
    __realClose();
    return;
  }

  const { source, bars } = event.data;
  const outcome = runScriptSync(source, bars);

  __realPostMessage(
    (outcome.ok
      ? { ok: true, signals: outcome.signals, logs: outcome.logs }
      : { ok: false, error: outcome.error, logs: outcome.logs }) satisfies StrategyWorkerResponse
  );

  // Self-terminate after reporting — defense-in-depth alongside
  // `script-runner.ts`'s own authoritative `worker.terminate()` call on
  // this worker's handle (that main-thread call is what actually GUARANTEES
  // cleanup even if this line never ran, e.g. a hung script never reaching
  // this point at all).
  __realClose();
};
