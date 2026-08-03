"use client";

/**
 * User Strategy Scripting (SS1) — TEMPORARY dev-only verification harness.
 *
 * SS1 ships zero editor UI (that's SS2 — a bottom drawer inside the
 * Charting Workbench) and this sprint's hard constraint forbids editing
 * `chart-workbench.tsx`/`options-page-client.tsx`/any terminal client file
 * (another engineer owns them right now). That leaves `script-runner.ts`
 * (which does `new Worker(new URL("./strategy-worker.ts", import.meta.url))`)
 * and `setPrecomputedScriptSignals` completely unreferenced from any
 * reachable page — which means webpack never builds the worker chunk and
 * there is no in-browser way to verify T2/T4/T5's real acceptance criteria
 * (worker boots, 3s terminate actually fires, rapid-double-run supersedes
 * the stale worker, the precomputed store holds only the latest token)
 * without SOME reachable entry point.
 *
 * This route is that entry point — NOT linked from any nav, NOT part of
 * the product, isolated under `/dev/`. It exists purely so this sprint's
 * QA engineer (and SS2's own follow-on work) can drive real browser smoke
 * tests. SS2 should DELETE this file once the real editor UI supersedes it.
 */
import { useState } from "react";
import { notFound } from "next/navigation";

import { runUserScript, type ScriptRunResult } from "@/components/paper-trading/workbench/user-scripts/script-runner";
import type { StrategyCandle } from "@/lib/ta/strategies";

// `custom-indicators/pf-signals.ts` transitively imports `klinecharts`, which
// touches `window` at module-eval time (device-pixel-ratio-style feature
// detection) — safe inside the real, `ssr: false`-gated Charting Workbench
// chunk, but this scratch page has no such gate and Next tries to prerender
// it. A dynamic import INSIDE the click handler below (never a static
// top-level import) keeps that module out of this page's server-rendered
// path entirely — mirrors why `chart-workbench.tsx` itself is only ever
// loaded via `next/dynamic(..., {ssr: false})`.
async function setPrecomputedScriptSignalsLazy(runToken: string, signals: Parameters<typeof import("@/components/paper-trading/workbench/custom-indicators/pf-signals")["setPrecomputedScriptSignals"]>[1]) {
  const { setPrecomputedScriptSignals } = await import("@/components/paper-trading/workbench/custom-indicators/pf-signals");
  setPrecomputedScriptSignals(runToken, signals);
}

function buildFixtureBars(count: number): StrategyCandle[] {
  const baseTs = Date.UTC(2026, 0, 1);
  const dayMs = 24 * 60 * 60 * 1000;
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + Math.sin(i / 3) * 5;
    return { timestamp: baseTs + i * dayMs, open: close, high: close + 1, low: close - 1, close, volume: 1000 };
  });
}

const FIXTURE_BARS = buildFixtureBars(60);

const HELLO_WORLD_SCRIPT = `function run(bars, ta, helpers) {
  return [helpers.buy(5), helpers.sell(10)];
}`;

const INFINITE_LOOP_SCRIPT = `function run(bars, ta, helpers) {
  while (true) {}
}`;

interface LogEntry {
  label: string;
  detail: string;
  ok: boolean;
}

export default function ScriptingSs1SmokePage() {
  // Never serve this harness in prod — it may ship in a deploy that bundles
  // SS1's runtime before SS2 replaces it with the real editor UI.
  if (process.env.NODE_ENV === "production") notFound();

  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);

  function pushLog(label: string, detail: string, ok: boolean) {
    setLogEntries((prev) => [{ label, detail, ok }, ...prev]);
  }

  function describe(result: ScriptRunResult): string {
    return JSON.stringify(result);
  }

  async function runHelloWorld() {
    const start = performance.now();
    const result = await runUserScript(HELLO_WORLD_SCRIPT, FIXTURE_BARS);
    const elapsedMs = Math.round(performance.now() - start);
    pushLog("Hello-world worker round-trip", `${elapsedMs}ms — ${describe(result)}`, result.ok === true);
  }

  async function runTimeout() {
    const start = performance.now();
    const result = await runUserScript(INFINITE_LOOP_SCRIPT, FIXTURE_BARS);
    const elapsedMs = Math.round(performance.now() - start);
    const withinBudget = elapsedMs >= 2900 && elapsedMs <= 4000;
    pushLog("Infinite-loop 3s terminate", `${elapsedMs}ms (expect ~3000ms) — ${describe(result)}`, result.ok === false && withinBudget);
  }

  async function runSupersede() {
    const first = runUserScript(INFINITE_LOOP_SCRIPT, FIXTURE_BARS);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = runUserScript(HELLO_WORLD_SCRIPT, FIXTURE_BARS);
    const [firstResult, secondResult] = await Promise.all([first, second]);
    const firstSuperseded = firstResult.ok === false && firstResult.error.message.includes("superseded");
    pushLog("Rapid double-run supersede", `first=${describe(firstResult)} second=${describe(secondResult)}`, firstSuperseded && secondResult.ok === true);
  }

  async function runPrecomputedStoreSingleEntry() {
    await setPrecomputedScriptSignalsLazy("token-a", [{ index: 1, timestamp: 1, side: "BUY", price: 1 }]);
    await setPrecomputedScriptSignalsLazy("token-b", [{ index: 2, timestamp: 2, side: "SELL", price: 2 }]);
    pushLog("Precomputed store single-entry", "Set token-a then token-b — inspect custom-indicators/pf-signals.ts's module state manually (no public getter beyond calc()) to confirm only token-b remains.", true);
  }

  return (
    <main style={{ padding: 24, fontFamily: "monospace", maxWidth: 900 }}>
      <h1>SS1 verification harness (temporary — delete in SS2)</h1>
      <p>Open the Network tab before running the timeout/hello-world checks to also confirm zero fetch/XHR attempts from the worker.</p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
        <button onClick={runHelloWorld}>Run hello-world script</button>
        <button onClick={runTimeout}>Run infinite-loop (expect 3s terminate)</button>
        <button onClick={runSupersede}>Run rapid double-run (supersede check)</button>
        <button onClick={runPrecomputedStoreSingleEntry}>Set precomputed store twice (single-entry check)</button>
      </div>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {logEntries.map((entry, i) => (
          <li key={i} style={{ marginBottom: 8, color: entry.ok ? "#10b981" : "#f43f5e" }}>
            <strong>{entry.ok ? "PASS" : "FAIL"}</strong> — {entry.label}: {entry.detail}
          </li>
        ))}
      </ul>
    </main>
  );
}
