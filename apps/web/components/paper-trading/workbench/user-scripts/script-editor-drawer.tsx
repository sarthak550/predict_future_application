"use client";

/**
 * User Strategy Scripting (SS2), T3 — the script editor drawer (D2's
 * third-level lazy chunk, D4's layout, D6's run wiring). Dynamically
 * imported FROM `chart-workbench.tsx` via `next/dynamic(..., {ssr:
 * false})` — this is the file (transitively, via `code-editor.tsx`) that
 * pulls in `codemirror`/`@codemirror/lang-javascript`; `chart-workbench.tsx`
 * itself never statically imports anything from either package (D2).
 *
 * **Layout (D4)**: a resizable drag handle on the top edge
 * (`DrawerResizeHandle`), then the toolbar (Run/Save/Save as/Rename/
 * Delete/dirty-dot/disclaimer, full width), then a row of [list sidebar |
 * editor], then the collapsible console strip along the drawer's own
 * bottom edge. The run-results display (§2 — "this drawer's own results
 * display") is NOT a third horizontal column (D4 says "nothing else
 * horizontally" for the sidebar/editor row) — it stacks BELOW the editor,
 * inside the SAME middle column, appearing only once a run has produced a
 * result. This placement is a CTO layout call, flagged in the SS2 final
 * report, reconciling D4's literal two-column row with §2's separate
 * requirement for a results display living somewhere in this drawer.
 *
 * **Run wiring (D6)**: `handleRun` calls SS1's `runUserScript` (the SAME
 * spawn-per-run Worker path a template run never touches — scripts always
 * execute through the real sandbox, no "preview" shortcut) then the SAME
 * `runBacktest()` the Strategy tab's `handleRunStrategy` already calls, and
 * feeds the result into two places: this component's own
 * `StrategyStatsCard` (imported, not copy-pasted, per D6) and, via
 * `onRunSignals`, `chart-workbench.tsx`'s chart-facing `signalsConfig`
 * state (`{kind: "script", runToken, signals}` — SS1's D9 precomputed-store
 * mechanism, now actually driven by real UI for the first time).
 *
 * **Notional**: deliberately shares `chart-workbench.tsx`'s existing
 * `strategyNotional` preference (passed down as a plain `notional: number`
 * prop, no setter) rather than inventing a second, drawer-local notional
 * control — D8's toolbar contents are locked to Run/Save/Save as/Rename/
 * Delete/dirty-dot/disclaimer, no notional field among them, and both
 * producers (template runs, script runs) feed the SAME `runBacktest()`, so
 * one shared "how much capital to simulate" preference is the more
 * consistent design than two independently-drifting ones.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";

import { intervalToProductType, runBacktest } from "@/lib/ta/backtest";
import type { StrategyCandle, StrategySignal } from "@/lib/ta/strategies";
import { EXAMPLE_SCRIPTS, type ExampleScript } from "@/lib/ta/example-scripts";
import { StrategyStatsCard, OriginBadge, type StrategyRunResult } from "../strategy-panel";

import { CodeEditor } from "./code-editor";
import { DrawerResizeHandle, DRAWER_DEFAULT_HEIGHT, clampDrawerHeight } from "./drawer-resize-handle";
import { ScriptListSidebar } from "./script-list-sidebar";
import { ScriptToolbar } from "./script-toolbar";
import { ScriptConsole } from "./script-console";
import { runUserScript } from "./script-runner";
import { listUserScripts, createUserScript, updateUserScript, deleteUserScript, type UserScriptRow } from "./user-scripts-api";
import { loadScriptDraft, saveScriptDraft, clearScriptDraft, type ScriptDraft } from "./draft-storage";

const DRAWER_HEIGHT_STORAGE_KEY = "pf.workbench.scriptDrawerHeight";
/** D7's exact debounce value. */
const DRAFT_DEBOUNCE_MS = 1000;
/** Save-as/Duplicate-to-edit name-collision retry bound — the client-side suggestion is cosmetic, the server's own 409 (SS1 T1) is the real enforcement (D8's own framing: "client suggests, server's 409 is still the real enforcement"). */
const NAME_COLLISION_RETRY_LIMIT = 20;

function loadStoredDrawerHeight(): number {
  try {
    const raw = window.localStorage.getItem(DRAWER_HEIGHT_STORAGE_KEY);
    if (!raw) return DRAWER_DEFAULT_HEIGHT;
    return clampDrawerHeight(Number(raw));
  } catch {
    return DRAWER_DEFAULT_HEIGHT; // private mode / storage disabled.
  }
}

function saveStoredDrawerHeight(height: number): void {
  try {
    window.localStorage.setItem(DRAWER_HEIGHT_STORAGE_KEY, String(height));
  } catch {
    // Preference just won't survive the refresh.
  }
}

/** Same `crypto.randomUUID().slice(0,8)` + monotonic-counter-fallback convention `indicator-registry.ts`'s own `createInstanceId` already established for this codebase's other "fresh opaque id per something" needs. */
let runTokenCounter = 0;
function createRunToken(): string {
  runTokenCounter += 1;
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `run__${rand}${runTokenCounter}`;
}

type OpenScript = { kind: "new" } | { kind: "script"; row: UserScriptRow } | { kind: "example"; example: ExampleScript };

export interface ScriptEditorDrawerProps {
  /** The workbench's currently-loaded candle window — structurally a `StrategyCandle[]` already (`use-workbench-candles.ts`'s `Candle` shape), same "no cast needed" compatibility `pf-signals.ts` documents for the template path. */
  candles: StrategyCandle[];
  interval: string;
  isPremiumMode: boolean;
  notional: number;
  onRunSignals: (config: { kind: "script"; runToken: string; signals: StrategySignal[] }) => void;
  /**
   * SS3, T3 — whether the drawer is actually VISIBLE right now (the drawer
   * component itself is sticky-mounted by `chart-workbench.tsx` once opened
   * and never unmounted again, per that file's own doc — `display: none`
   * hides it without tearing down editor/console state). The "elsewhere in
   * the drawer" keyboard-shortcut listener below must only act while this
   * is true; otherwise Cmd+Enter/Cmd+S would keep firing against a closed,
   * merely-hidden drawer.
   */
  open: boolean;
  /**
   * SS3, T3 — mirrors `chart-workbench.tsx`'s own Escape-priority-chain
   * state (text popover / order-intent popover / right-click context menu)
   * so Cmd+Enter/Cmd+S don't fire while one of those is capturing keyboard
   * focus, the same convention Escape itself already follows one level up.
   */
  shortcutsSuppressed: boolean;
}

export function ScriptEditorDrawer({ candles, interval, isPremiumMode, notional, onRunSignals, open, shortcutsSuppressed }: ScriptEditorDrawerProps) {
  const [openScript, setOpenScript] = useState<OpenScript>({ kind: "new" });
  const [source, setSource] = useState("");
  /** The DB-persisted source for the currently-open script (`null` for "new"/an example — neither has a persisted row to diff against). Dirty-dot (D8) is `source !== (lastSavedSource ?? "")`. */
  const [lastSavedSource, setLastSavedSource] = useState<string | null>(null);
  const [myScripts, setMyScripts] = useState<UserScriptRow[]>([]);
  const [scriptsLoading, setScriptsLoading] = useState(true);
  const [scriptsError, setScriptsError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [consoleState, setConsoleState] = useState<{ logs: string[]; error: { message: string; line?: number } | null; collapsed: boolean }>({
    logs: [],
    error: null,
    collapsed: true
  });
  const [scriptRunResult, setScriptRunResult] = useState<StrategyRunResult | null>(null);
  const [draftPrompt, setDraftPrompt] = useState<ScriptDraft | null>(null);
  const [toolbarError, setToolbarError] = useState<string | null>(null);
  const [drawerHeight, setDrawerHeight] = useState(DRAWER_DEFAULT_HEIGHT);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchScripts = useCallback(async () => {
    setScriptsLoading(true);
    const res = await listUserScripts();
    setScriptsLoading(false);
    if (!res.ok) {
      setScriptsError(res.error);
      return;
    }
    setScriptsError(null);
    setMyScripts(res.data);
  }, []);

  // Restored once, after mount — the SAME localStorage-after-hydration
  // idiom `chart-workbench.tsx` already uses uniformly for every persisted
  // preference (indicators/strategyId/panelWidth), extended here to the
  // drawer's own height AND its default-open "new" bucket's draft check.
  useEffect(() => {
    void fetchScripts();
    setDrawerHeight(loadStoredDrawerHeight());
    const draft = loadScriptDraft(null);
    if (draft && draft.source !== "") setDraftPrompt(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    },
    []
  );

  function currentScriptId(): string | null {
    return openScript.kind === "script" ? openScript.row.id : null;
  }

  function handleSourceChange(next: string) {
    setSource(next);
    if (openScript.kind === "example") return; // read-only — never drafted.
    const scriptId = currentScriptId();
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => saveScriptDraft(scriptId, next), DRAFT_DEBOUNCE_MS);
  }

  function checkDraftFor(scriptId: string | null, persistedSource: string) {
    const draft = loadScriptDraft(scriptId);
    setDraftPrompt(draft && draft.source !== persistedSource ? draft : null);
  }

  function openNewScript() {
    setOpenScript({ kind: "new" });
    setSource("");
    setLastSavedSource(null);
    setScriptRunResult(null);
    setToolbarError(null);
    checkDraftFor(null, "");
  }

  function openScriptRow(row: UserScriptRow) {
    setOpenScript({ kind: "script", row });
    setSource(row.source);
    setLastSavedSource(row.source);
    setScriptRunResult(null);
    setToolbarError(null);
    checkDraftFor(row.id, row.source);
  }

  function openExample(example: ExampleScript) {
    setOpenScript({ kind: "example", example });
    setSource(example.source);
    setLastSavedSource(null);
    setScriptRunResult(null);
    setToolbarError(null);
    setDraftPrompt(null); // examples are read-only — never drafted, never prompted.
  }

  function handleRestoreDraft() {
    if (!draftPrompt) return;
    setSource(draftPrompt.source);
    setDraftPrompt(null);
    // Dirty-dot stays lit naturally: draftPrompt.source !== lastSavedSource is exactly why the prompt showed.
  }

  function handleDiscardDraft() {
    clearScriptDraft(currentScriptId());
    setDraftPrompt(null);
  }

  async function handleRun() {
    if (running || openScript.kind === "example" || candles.length === 0) return;
    setRunning(true);
    const dispatchBars = candles;
    const result = await runUserScript(source, dispatchBars);
    setRunning(false);

    if (!result.ok) {
      setConsoleState({ logs: result.logs, error: result.error, collapsed: false }); // a fresh error always expands the strip — never buried.
      setScriptRunResult(null);
      return;
    }

    const productType = intervalToProductType(interval);
    const stats = runBacktest(dispatchBars, result.signals, { notional, productType });
    const scriptId = openScript.kind === "script" ? openScript.row.id : "new";
    const scriptName = openScript.kind === "script" ? openScript.row.name : "Untitled script";
    const runResult: StrategyRunResult = {
      id: scriptId,
      params: [],
      signals: result.signals,
      stats,
      ranInterval: interval,
      ranCandleCount: dispatchBars.length,
      ranProductType: productType,
      origin: { kind: "script", scriptId, scriptName }
    };
    setScriptRunResult(runResult);
    setConsoleState((prev) => ({ logs: result.logs, error: null, collapsed: result.logs.length > 0 ? false : prev.collapsed }));
    onRunSignals({ kind: "script", runToken: createRunToken(), signals: result.signals });
  }

  async function handleSave() {
    if (openScript.kind === "example") return;
    if (openScript.kind === "new") {
      await handleSaveAs();
      return;
    }
    const res = await updateUserScript(openScript.row.id, { source });
    if (!res.ok) {
      setToolbarError(res.error);
      return;
    }
    setToolbarError(null);
    setLastSavedSource(source);
    clearScriptDraft(openScript.row.id);
    setOpenScript({ kind: "script", row: res.data });
    setMyScripts((prev) => prev.map((r) => (r.id === res.data.id ? res.data : r)));
  }

  async function handleSaveAs() {
    const suggested = openScript.kind === "script" ? `${openScript.row.name} copy` : "";
    const name = window.prompt("Save as — script name:", suggested);
    if (!name || !name.trim()) return;
    const previousScriptId = currentScriptId();
    const res = await createUserScript(name.trim(), source);
    if (!res.ok) {
      setToolbarError(res.error); // D8: a 409 name collision surfaces its message inline here, not a generic failure.
      return;
    }
    setToolbarError(null);
    clearScriptDraft(previousScriptId); // the DB row is the source of truth now — no stale draft to offer under the OLD bucket next time.
    setOpenScript({ kind: "script", row: res.data });
    setLastSavedSource(source);
    setMyScripts((prev) => [res.data, ...prev.filter((r) => r.id !== res.data.id)]);
  }

  async function handleRename() {
    if (openScript.kind !== "script") return;
    const name = window.prompt("Rename script", openScript.row.name);
    if (!name || !name.trim() || name.trim() === openScript.row.name) return;
    const res = await updateUserScript(openScript.row.id, { name: name.trim() });
    if (!res.ok) {
      setToolbarError(res.error);
      return;
    }
    setToolbarError(null);
    setOpenScript({ kind: "script", row: res.data });
    setMyScripts((prev) => prev.map((r) => (r.id === res.data.id ? res.data : r)));
  }

  async function handleDelete() {
    if (openScript.kind !== "script") return;
    if (!window.confirm(`Delete "${openScript.row.name}"? This can't be undone.`)) return;
    await deleteOpenScript(openScript.row);
  }

  async function handleDeleteFromList(row: UserScriptRow) {
    if (!window.confirm(`Delete "${row.name}"? This can't be undone.`)) return;
    await deleteOpenScript(row);
  }

  async function deleteOpenScript(row: UserScriptRow) {
    const res = await deleteUserScript(row.id);
    if (!res.ok) {
      setToolbarError(res.error);
      return;
    }
    setToolbarError(null);
    clearScriptDraft(row.id);
    setMyScripts((prev) => prev.filter((r) => r.id !== row.id));
    if (openScript.kind === "script" && openScript.row.id === row.id) openNewScript();
  }

  async function handleDuplicate() {
    if (openScript.kind !== "example") return;
    const example = openScript.example;
    let candidate = `${example.name} (copy)`;
    let attempt = 1;
    let res = await createUserScript(candidate, example.source);
    while (!res.ok && res.status === 409 && attempt < NAME_COLLISION_RETRY_LIMIT) {
      attempt += 1;
      candidate = `${example.name} (copy ${attempt})`;
      res = await createUserScript(candidate, example.source);
    }
    if (!res.ok) {
      setToolbarError(res.error);
      return;
    }
    setToolbarError(null);
    setMyScripts((prev) => [res.data, ...prev]);
    setOpenScript({ kind: "script", row: res.data });
    setSource(res.data.source);
    setLastSavedSource(res.data.source);
  }

  function handleDrawerResize(height: number) {
    if (rootRef.current) rootRef.current.style.height = `${height}px`;
  }
  function handleDrawerResizeEnd(height: number) {
    setDrawerHeight(height);
    saveStoredDrawerHeight(height);
  }
  function handleDrawerResizeReset() {
    setDrawerHeight(DRAWER_DEFAULT_HEIGHT);
    saveStoredDrawerHeight(DRAWER_DEFAULT_HEIGHT);
  }

  const mode = openScript.kind;
  const scriptName = openScript.kind === "script" ? openScript.row.name : openScript.kind === "example" ? openScript.example.name : null;
  const isDirty = openScript.kind !== "example" && source !== (lastSavedSource ?? "");
  const canRun = openScript.kind !== "example" && candles.length > 0;
  const isStaleResult = scriptRunResult !== null && scriptRunResult.ranInterval !== interval;

  // SS3, T3 — Cmd+Enter/Cmd+S. Mirrors the toolbar buttons' own enabled
  // conditions exactly (`canRun`/`isDirty` above) rather than re-deriving a
  // parallel set of rules, and additionally respects `shortcutsSuppressed`
  // (the Escape-priority-chain overlays one level up in `chart-workbench.tsx`).
  // Captured through a ref (below), same "read through a ref updated every
  // render" law `code-editor.tsx`'s own `onChangeRef` establishes — `handleRun`/
  // `handleSave` close over `candles`/`interval`/`source`/`openScript`, all of
  // which can change on every render (live bar polling, typing, switching
  // scripts) independent of `open`/`shortcutsSuppressed` — a dependency array
  // naming only the latter two would hold a STALE `candles` snapshot the
  // moment new bars arrive while the drawer sits open.
  function handleRunShortcut() {
    if (shortcutsSuppressed || !canRun || running) return;
    void handleRun();
  }
  function handleSaveShortcut() {
    if (shortcutsSuppressed || !isDirty) return;
    void handleSave();
  }
  const handleRunShortcutRef = useRef(handleRunShortcut);
  handleRunShortcutRef.current = handleRunShortcut;
  const handleSaveShortcutRef = useRef(handleSaveShortcut);
  handleSaveShortcutRef.current = handleSaveShortcut;

  // The "elsewhere in the drawer" half of T3 — `code-editor.tsx` owns the
  // in-editor path (its own CodeMirror keymap, see that file's module doc);
  // this listener covers every OTHER focus target inside the drawer (the
  // toolbar, the sidebar, or nothing focused at all) via a `document`-level
  // listener, attached/detached only when `open` itself toggles (the two
  // refs above carry every other bit of freshness, so this effect's own dep
  // array can stay minimal and STABLE rather than re-subscribing on every
  // keystroke). Skips when `event.defaultPrevented` is already true — that
  // means CodeMirror's own keymap just handled this exact keystroke (focus
  // was inside the editor), so acting again here would double-fire the same
  // Run/Save. `Mod-s` ALWAYS calls `preventDefault()` here regardless of
  // `shortcutsSuppressed`/dirty state, so the browser's native "Save Page"
  // dialog can never sneak through just because the action itself was
  // suppressed — see this component's own props doc for why suppression
  // exists.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "Enter") {
        e.preventDefault();
        handleRunShortcutRef.current();
        return;
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        handleSaveShortcutRef.current();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div ref={rootRef} style={{ height: drawerHeight }} className="flex shrink-0 flex-col border-t border-ink-200 bg-white">
      <DrawerResizeHandle
        getCurrentHeight={() => drawerHeight}
        onResize={handleDrawerResize}
        onResizeEnd={handleDrawerResizeEnd}
        onDoubleClickReset={handleDrawerResizeReset}
      />

      <ScriptToolbar
        mode={mode}
        scriptName={scriptName}
        isDirty={isDirty}
        isRunning={running}
        canRun={canRun}
        onRun={handleRun}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onRename={handleRename}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
      />

      {toolbarError && (
        <div className="flex items-center gap-2 border-b border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-800">
          <span>{toolbarError}</span>
          <button type="button" className="font-semibold underline" onClick={() => setToolbarError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {draftPrompt && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          <span>Unsaved changes from {formatDistanceToNow(new Date(draftPrompt.savedAt), { addSuffix: true })}</span>
          <button type="button" className="font-semibold underline" onClick={handleRestoreDraft}>
            Restore
          </button>
          <button type="button" className="font-semibold underline" onClick={handleDiscardDraft}>
            Discard
          </button>
        </div>
      )}

      {/* SS3, T5 — narrow-viewport pass: `flex-col` below `sm` stacks the
          sidebar above the editor (see `ScriptListSidebar`'s own comment for
          its half of this), `sm:flex-row` restores the original side-by-side
          layout unchanged at desktop widths. */}
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <ScriptListSidebar
          myScripts={myScripts}
          scriptsLoading={scriptsLoading}
          scriptsError={scriptsError}
          examples={EXAMPLE_SCRIPTS}
          openScriptId={openScript.kind === "script" ? openScript.row.id : null}
          openExampleId={openScript.kind === "example" ? openScript.example.id : null}
          onOpenNew={openNewScript}
          onOpenScript={openScriptRow}
          onOpenExample={openExample}
          onDeleteScript={handleDeleteFromList}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <CodeEditor
            value={source}
            onChange={handleSourceChange}
            readOnly={openScript.kind === "example"}
            className="min-h-0 flex-1"
            onRunShortcut={handleRunShortcut}
            onSaveShortcut={handleSaveShortcut}
          />
          {scriptRunResult && (
            <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-ink-100 p-2">
              <OriginBadge origin={scriptRunResult.origin} />
              <StrategyStatsCard
                runResult={scriptRunResult}
                isStale={isStaleResult}
                liveInterval={interval}
                liveCandleCount={candles.length}
                isPremiumMode={isPremiumMode}
              />
            </div>
          )}
        </div>
      </div>

      <ScriptConsole
        logs={consoleState.logs}
        error={consoleState.error}
        collapsed={consoleState.collapsed}
        onToggleCollapsed={() => setConsoleState((prev) => ({ ...prev, collapsed: !prev.collapsed }))}
      />
    </div>
  );
}
