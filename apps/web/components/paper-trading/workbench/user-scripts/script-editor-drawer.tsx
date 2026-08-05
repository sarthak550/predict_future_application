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
 *
 * **Founder-feedback pass (2026-08-04) — "Scripts UI also need to be
 * fixed, and adjustable."** Live-browser diagnosis (Playwright screenshots
 * at 1512/1280/990px widths and at a shorter 800px-tall viewport) found two
 * real, severe defects, both fixed here:
 *
 * 1. The drawer's own root div was a lone flex item inside
 *    `chart-workbench.tsx`'s `<div style={{display: "flex"}}>` wrapper —
 *    that wrapper has no `flex-col`, so it's a ROW container, and a row
 *    container's default main-axis (width) sizing is content-based, not
 *    stretch. With no `w-full`/`flex-1` on the drawer's own root, it
 *    shrink-wrapped to its content's natural width (measured 512-947px at
 *    a 1512px-wide viewport depending on what content was loaded) instead
 *    of spanning the workbench — leaving a large dead gray gap on the
 *    right at every width tested. Fixed with one class: `w-full` added to
 *    this component's own root div, below. (No change needed in
 *    `chart-workbench.tsx` itself — the fix is entirely local to this
 *    component's own root, matching this sprint's file-scope constraint.)
 * 2. `kline-chart.tsx`'s chart mount container has a hard `min-h-[420px]`
 *    floor. The OLD static `DRAWER_MAX_HEIGHT` (640px) let a user drag this
 *    drawer tall enough to force the chart below that floor — past that
 *    point the chart visibly overflows past its own container and PAINTS
 *    OVER the drawer's toolbar and resize handle, which then also becomes
 *    unclickable a second time (confirmed via `elementFromPoint` — the
 *    coordinates the handle used to occupy now resolve to the overflowing
 *    `<canvas>`), breaking further dragging AND the double-click reset. On
 *    a shorter (800px-tall) viewport this collision happened with the
 *    drawer at its DEFAULT height, zero user interaction required. Fixed
 *    in `drawer-resize-handle.tsx`: `clampDrawerHeight` is now
 *    viewport-aware (see that file's own doc for the exact math) — the
 *    drawer can no longer be dragged, reset, or restored-from-localStorage
 *    into a height that would crush the chart, on any viewport size.
 *
 * Three more adjustability mechanisms added per the founder's explicit
 * ask, all persisted under `pf.workbench.scripts.*` (see the storage keys
 * below — the drawer-height key is renamed into this namespace too, for
 * consistency; a returning user's old saved height is not migrated, just
 * re-defaulted once):
 *
 * - Sidebar width — `SidebarResizeHandle` (new), width applied via a CSS
 *   custom property (`--script-sidebar-w`) set on the shared
 *   sidebar+editor row ref, read by `script-list-sidebar.tsx`'s own
 *   `sm:w-[var(--script-sidebar-w)]` class. Desktop-only, matching the
 *   sidebar's own existing mobile-stacking breakpoint.
 * - Console height — `ScriptConsole` now owns a draggable height (was a
 *   fixed `max-h-32`) with its own persisted value.
 * - Results/stats block — now collapsible (was always-rendered whenever a
 *   result existed, measured to crush the editor down to ~134px — barely
 *   5-6 visible lines — at the drawer's DEFAULT height). Session-only
 *   state (not persisted), matching the console's own pre-existing
 *   collapse behavior — defaults OPEN on every fresh run (least surprising:
 *   you just clicked Run to see this) but is now the user's choice to
 *   dismiss, not an unavoidable tax on editor space.
 *
 * **QA-fix pass (2026-08-05)** — the founder-feedback pass above shipped
 * with two real bugs QA reproduced live, both fixed here:
 *
 * 1. `drawer-resize-handle.tsx`'s `getEffectiveMaxDrawerHeight` let its own
 *    320px "comfort" floor override the collision-safety clamp on any
 *    viewport shorter than ~840px, silently bringing back the exact
 *    chart-paints-over-the-drawer defect the founder-feedback pass claimed
 *    to have closed (see that file's own doc for the fix — collision
 *    safety now always wins). `computeEditorMinHeight`/
 *    `computeConsoleMaxHeight` below were re-derived to match: neither
 *    assumes the drawer is >= `DRAWER_MIN_HEIGHT` anymore, and the console
 *    is forced collapsed (`consoleExpandable` in the render below) rather
 *    than allowed to overlap the editor when a short drawer can't afford
 *    both.
 * 2. The mount-restore effect and the `[drawerHeight]` sync effect both
 *    fired on the SAME initial mount; the sync effect's first invocation
 *    closed over the stale pre-restore `drawerHeight` and re-clamped +
 *    PERSISTED a corrupted `consoleHeight` over the just-restored one. A
 *    first-render guard ref (`drawerHeightSyncedOnceRef`) was tried first —
 *    it did NOT survive React 18 StrictMode's dev-only double-invocation of
 *    a component's initial-mount effects (both invocations share the exact
 *    same stale render/closure; the ref correctly skips invocation #1 but
 *    WRONGLY treats invocation #2 as "a real later change," still against
 *    the same stale `drawerHeight`). See
 *    `feedback_strictmode_double_invoke_defeats_ref_guard.md` for the full
 *    mechanism QA root-caused (exactly two corrupting `setItem` calls per
 *    cold load, matching the double-invoke theory precisely).
 *
 * **QA-fix pass, round 3 (2026-08-05)** — the two effects above are now
 * MERGED into one (`[drawerHeight]`-keyed), closing the cross-effect
 * staleness window entirely rather than guarding around it. It is
 * StrictMode-idempotent BY CONSTRUCTION, not by a ref latch: `drawerHeightRef`
 * mirrors the TRUE current drawer height, written synchronously every place
 * `drawerHeight` state itself is set (inside this effect's own restore
 * branch, `handleDrawerResizeEnd`, `handleDrawerResizeReset`, and the
 * window-resize self-heal effect) — the merged effect's "sync" branch reads
 * `drawerHeightRef.current`, never the possibly-stale `drawerHeight` closure
 * argument. On the very first invocation (mount), it restores from
 * localStorage using only local consts and writes the ref. A StrictMode
 * replay of that SAME commit (`hasRestoredRef.current` already true) falls
 * through to the "sync" branch, but by then the ref already holds the value
 * invocation #1 just restored (refs are shared mutable state visible across
 * both invocations, unlike the per-render `drawerHeight` closure) — so it
 * reclamps against the CORRECT height and reproduces the exact same
 * already-correct result (`next === current`), never a second corrupting
 * write. A genuinely later change (a real drag/reset/resize, its own fresh
 * render) hits the same branch normally, now correctly re-syncing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, ChevronUp } from "lucide-react";

import { intervalToProductType, runBacktest } from "@/lib/ta/backtest";
import type { StrategyCandle, StrategySignal } from "@/lib/ta/strategies";
import { EXAMPLE_SCRIPTS, type ExampleScript } from "@/lib/ta/example-scripts";
import { StrategyStatsCard, OriginBadge, type StrategyRunResult } from "../strategy-panel";

import { CodeEditor } from "./code-editor";
import { DrawerResizeHandle, DRAWER_DEFAULT_HEIGHT, clampDrawerHeight } from "./drawer-resize-handle";
import { ScriptListSidebar } from "./script-list-sidebar";
import { SidebarResizeHandle, SIDEBAR_DEFAULT_WIDTH, clampSidebarWidth } from "./sidebar-resize-handle";
import { ScriptToolbar } from "./script-toolbar";
import { ScriptConsole, CONSOLE_DEFAULT_HEIGHT, CONSOLE_MIN_HEIGHT, clampConsoleHeight } from "./script-console";
import { runUserScript } from "./script-runner";
import { listUserScripts, createUserScript, updateUserScript, deleteUserScript, type UserScriptRow } from "./user-scripts-api";
import { loadScriptDraft, saveScriptDraft, clearScriptDraft, type ScriptDraft } from "./draft-storage";

/** Founder-feedback pass (2026-08-04) — every persisted size for this drawer lives under this one namespace (see this file's own module doc). The drawer-height key is a deliberate rename from SS2's `pf.workbench.scriptDrawerHeight` — a returning user just gets re-defaulted once, not migrated. */
const DRAWER_HEIGHT_STORAGE_KEY = "pf.workbench.scripts.drawerHeight";
const SIDEBAR_WIDTH_STORAGE_KEY = "pf.workbench.scripts.sidebarWidth";
const CONSOLE_HEIGHT_STORAGE_KEY = "pf.workbench.scripts.consoleHeight";
/** D7's exact debounce value. */
const DRAFT_DEBOUNCE_MS = 1000;

/**
 * Founder-feedback pass — the editor's PREFERRED minimum, in px, used
 * whenever the drawer is tall enough to afford it. Applied via inline
 * `style` (not a Tailwind `min-h-[...]` class — Tailwind's JIT scanner
 * needs a static class string, so a dynamic value can't be expressed that
 * way).
 *
 * **QA-fix pass (2026-08-05)**: this used to be asserted UNCONDITIONALLY,
 * which was only safe because `drawer-resize-handle.tsx`'s old (buggy)
 * `getEffectiveMaxDrawerHeight` guaranteed the drawer itself never dropped
 * below `DRAWER_MIN_HEIGHT` (320px) — a guarantee that fix removed (see
 * that file's own doc), so the drawer can now be shorter than this floor
 * plus its surrounding chrome can jointly afford. `computeEditorMinHeight`
 * below re-derives the REAL, current floor from the actual drawer height
 * instead of assuming this constant always fits — a hard inline
 * `minHeight` bigger than what a flex parent can give does NOT cooperate
 * with that parent, it just overflows past it, which is the exact class of
 * defect this whole pass exists to close, just one layer further in.
 */
const EDITOR_MIN_HEIGHT_PX = 100;
/** Handle(10) + toolbar-and-disclaimer row — measured 76.5px live via DOM at the drawer's default height, this reserves a bit more (the toolbar row is `flex-wrap` and can grow past one line on a narrow drawer). */
const NON_MIDDLE_ROW_CHROME_PX = 90;
/** Console's own header row + its resize handle — measured 35.5px live (29.5 + 6), small buffer added. Only relevant while the console is EXPANDED (the resize handle only renders then) — see `CONSOLE_HEADER_ONLY_PX` for the collapsed figure. */
const CONSOLE_OWN_CHROME_PX = 40;
/** Console's header row ALONE, collapsed (no resize handle rendered) — the reserve `computeEditorMinHeight` budgets against, since collapsed is both the default and the smallest the console ever gets. */
const CONSOLE_HEADER_ONLY_PX = 32;

/**
 * QA-fix pass (2026-08-05) — the editor's REAL floor for the drawer's
 * CURRENT height, reserving only the console's collapsed footprint (its
 * smallest possible reservation). Clamped into `[0, EDITOR_MIN_HEIGHT_PX]`
 * — never more than the preferred floor, and never a request the drawer
 * can't afford: on a short drawer this degrades smoothly down to 0, at
 * which point `min-h-0 flex-1` alone governs (the editor just gets
 * whatever's left, no hard floor left to overflow past — CodeMirror's own
 * internal scroller, not a container overflow, takes over from there). A
 * pure function so both the mount effect and every resize/reset path can
 * call it without a fresh render.
 */
function computeEditorMinHeight(drawerHeightPx: number): number {
  const available = drawerHeightPx - NON_MIDDLE_ROW_CHROME_PX - CONSOLE_HEADER_ONLY_PX;
  return Math.max(0, Math.min(EDITOR_MIN_HEIGHT_PX, available));
}

/**
 * The console's real, current safe ceiling given the drawer's own total
 * height and the editor's REAL (possibly-shrunk, see
 * `computeEditorMinHeight`) floor — see `script-console.tsx`'s own
 * `clampConsoleHeight` doc for why this exists. A pure function (not a
 * component method) so both the mount effect and the drawer-height-change
 * effect below can call it before/without a fresh render.
 *
 * **QA-fix pass (2026-08-05)**: on a short drawer this can now return a
 * value below `CONSOLE_MIN_HEIGHT` (even negative) — that's expected, not
 * a bug to clamp away here. Callers must gate actually EXPANDING the
 * console on `computeConsoleMaxHeight(...) >= CONSOLE_MIN_HEIGHT` (see
 * `consoleExpandable` in the render below) rather than assume this is
 * always a viable expanded height; forcing the console collapsed in that
 * case reclaims its chrome for the editor instead of overflowing.
 */
function computeConsoleMaxHeight(drawerHeightPx: number): number {
  return drawerHeightPx - NON_MIDDLE_ROW_CHROME_PX - computeEditorMinHeight(drawerHeightPx) - CONSOLE_OWN_CHROME_PX;
}
/** Save-as/Duplicate-to-edit name-collision retry bound — the client-side suggestion is cosmetic, the server's own 409 (SS1 T1) is the real enforcement (D8's own framing: "client suggests, server's 409 is still the real enforcement"). */
const NAME_COLLISION_RETRY_LIMIT = 20;

function loadStoredDrawerHeight(): number {
  try {
    const raw = window.localStorage.getItem(DRAWER_HEIGHT_STORAGE_KEY);
    if (!raw) return clampDrawerHeight(DRAWER_DEFAULT_HEIGHT);
    return clampDrawerHeight(Number(raw));
  } catch {
    return clampDrawerHeight(DRAWER_DEFAULT_HEIGHT); // private mode / storage disabled.
  }
}

function saveStoredDrawerHeight(height: number): void {
  try {
    window.localStorage.setItem(DRAWER_HEIGHT_STORAGE_KEY, String(height));
  } catch {
    // Preference just won't survive the refresh.
  }
}

function loadStoredSidebarWidth(): number {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (!raw) return SIDEBAR_DEFAULT_WIDTH;
    return clampSidebarWidth(Number(raw));
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function saveStoredSidebarWidth(width: number): void {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // Preference just won't survive the refresh.
  }
}

function loadStoredConsoleHeight(): number {
  try {
    const raw = window.localStorage.getItem(CONSOLE_HEIGHT_STORAGE_KEY);
    if (!raw) return CONSOLE_DEFAULT_HEIGHT;
    return clampConsoleHeight(Number(raw));
  } catch {
    return CONSOLE_DEFAULT_HEIGHT;
  }
}

function saveStoredConsoleHeight(height: number): void {
  try {
    window.localStorage.setItem(CONSOLE_HEIGHT_STORAGE_KEY, String(height));
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
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [consoleHeight, setConsoleHeight] = useState(CONSOLE_DEFAULT_HEIGHT);
  /** Founder-feedback pass — collapsible results block, see this file's own module doc for why (crushed-editor measurement). Session-only, not persisted — matches the console's own pre-existing collapse behavior. */
  const [resultsCollapsed, setResultsCollapsed] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  /** The sidebar+editor row — `--script-sidebar-w` is set here so `script-list-sidebar.tsx`'s `sm:w-[var(--script-sidebar-w)]` class picks it up via normal CSS inheritance; the resize handle writes to it directly during a drag (never through `setState`), same imperative discipline as `rootRef`'s own height writes below. */
  const sidebarRowRef = useRef<HTMLDivElement | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * QA-fix pass, round 3 (2026-08-05) — mirrors the TRUE current
   * `drawerHeight`, written synchronously everywhere `drawerHeight` state
   * itself is set (never read FROM `drawerHeight` state — only written
   * alongside it) so the merged mount-restore/sync effect below can always
   * ask "what's the real current drawer height" without ever trusting its
   * own possibly-stale closure argument. See this file's own module doc for
   * why a plain closure read is not safe here under React 18 StrictMode.
   */
  const drawerHeightRef = useRef(DRAWER_DEFAULT_HEIGHT);
  /** Set true the instant the merged effect below has performed its one-time mount restore — everything after that is a genuine "drawerHeight changed" sync. */
  const hasRestoredRef = useRef(false);

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

  // Founder-feedback pass, MERGED with the console-height sync per the
  // QA-fix pass, round 3 (2026-08-05) — see this file's own module doc for
  // why a separate ref-guarded `[drawerHeight]` effect was not
  // StrictMode-safe. One effect now owns both "restore everything once,
  // after mount" (the SAME localStorage-after-hydration idiom
  // `chart-workbench.tsx` already uses uniformly for every persisted
  // preference) AND "keep the console height honest whenever the drawer's
  // own total height changes for ANY reason" (a manual drag, the
  // double-click reset, or the window-resize self-heal effect below all
  // funnel through `setDrawerHeight` + `drawerHeightRef`).
  //
  // StrictMode-idempotent BY CONSTRUCTION: the restore branch reads
  // localStorage fresh into LOCAL consts (never React state) and writes
  // `drawerHeightRef` itself before returning, so a synthetic double-invoke
  // replay of the SAME mount commit falls into the "sync" branch below but
  // reads `drawerHeightRef.current` — already the correct just-restored
  // value, not the stale `drawerHeight` closure — and reproduces the exact
  // same already-correct clamp (`next === current`, zero extra
  // localStorage writes). A genuinely later change (its own fresh render)
  // hits the same branch normally.
  useEffect(() => {
    if (!hasRestoredRef.current) {
      hasRestoredRef.current = true;
      void fetchScripts();
      const restoredDrawerHeight = loadStoredDrawerHeight();
      drawerHeightRef.current = restoredDrawerHeight;
      setDrawerHeight(restoredDrawerHeight);
      setSidebarWidth(loadStoredSidebarWidth());
      // Clamped against the JUST-restored drawer height (a local value, not
      // stale state) so a console height saved when the drawer was taller
      // doesn't reintroduce the editor-overlap bug `computeConsoleMaxHeight`/
      // `clampConsoleHeight` exist to prevent, right on first paint.
      setConsoleHeight(clampConsoleHeight(loadStoredConsoleHeight(), computeConsoleMaxHeight(restoredDrawerHeight)));
      const draft = loadScriptDraft(null);
      if (draft && draft.source !== "") setDraftPrompt(draft);
      return;
    }
    const height = drawerHeightRef.current;
    setConsoleHeight((current) => {
      const next = clampConsoleHeight(current, computeConsoleMaxHeight(height));
      if (next !== current) saveStoredConsoleHeight(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerHeight]);

  useEffect(
    () => () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    },
    []
  );

  // Founder-feedback pass — self-heal on a live browser-window resize. If
  // the user shrinks their actual browser window (not just this drawer)
  // while it's open, a previously-safe drawer height can become unsafe
  // again (the chart's protected floor doesn't move, but the viewport
  // budget for the drawer shrinks) — re-clamp the CURRENT height against
  // the new viewport and, if it had to shrink, write it straight to the
  // DOM (imperative, matches the drag handle's own live-update discipline)
  // and commit + persist the new value. A no-op on every resize that
  // doesn't actually require shrinking.
  useEffect(() => {
    function onWindowResize() {
      setDrawerHeight((current) => {
        const next = clampDrawerHeight(current);
        if (next === current) return current;
        if (rootRef.current) rootRef.current.style.height = `${next}px`;
        drawerHeightRef.current = next;
        saveStoredDrawerHeight(next);
        return next;
      });
    }
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, []);

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
    setResultsCollapsed(false); // a fresh result always expands the results block — same "never buried" law the console's own error/logs auto-expand follows above.
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
    drawerHeightRef.current = height;
    setDrawerHeight(height);
    saveStoredDrawerHeight(height);
  }
  function handleDrawerResizeReset() {
    // Founder-feedback pass — clamp the reset target too. A raw
    // DRAWER_DEFAULT_HEIGHT could still exceed the viewport-derived max on
    // a short browser window (see drawer-resize-handle.tsx's own doc);
    // resetting must land somewhere provably safe, not just "the constant."
    const next = clampDrawerHeight(DRAWER_DEFAULT_HEIGHT);
    drawerHeightRef.current = next;
    setDrawerHeight(next);
    saveStoredDrawerHeight(next);
  }

  function handleSidebarResize(width: number) {
    sidebarRowRef.current?.style.setProperty("--script-sidebar-w", `${width}px`);
  }
  function handleSidebarResizeEnd(width: number) {
    setSidebarWidth(width);
    saveStoredSidebarWidth(width);
  }
  function handleSidebarResizeReset() {
    handleSidebarResize(SIDEBAR_DEFAULT_WIDTH);
    setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
    saveStoredSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
  }

  function handleConsoleHeightChange(height: number) {
    const clamped = clampConsoleHeight(height, computeConsoleMaxHeight(drawerHeight));
    setConsoleHeight(clamped);
    saveStoredConsoleHeight(clamped);
  }

  const mode = openScript.kind;
  const scriptName = openScript.kind === "script" ? openScript.row.name : openScript.kind === "example" ? openScript.example.name : null;
  const isDirty = openScript.kind !== "example" && source !== (lastSavedSource ?? "");
  const canRun = openScript.kind !== "example" && candles.length > 0;
  const isStaleResult = scriptRunResult !== null && scriptRunResult.ranInterval !== interval;
  /**
   * QA-fix pass (2026-08-05) — the editor's real, current floor and the
   * console's real, current expand budget, both re-derived from the
   * drawer's ACTUAL height every render (never assumed >= DRAWER_MIN_HEIGHT,
   * see `computeEditorMinHeight`/`computeConsoleMaxHeight`'s own docs).
   * `consoleExpandable` gates whether the console is allowed to actually
   * SHOW its expanded content — below the threshold there simply isn't
   * room for the console's own `CONSOLE_MIN_HEIGHT` alongside the editor's
   * floor without one overflowing the other, so the console is forced
   * collapsed (reclaiming its chrome for the editor) rather than letting
   * that overlap happen. Self-heals every render — shrinking the drawer
   * below the threshold forces collapse with no user action needed, same
   * as growing it back re-enables expansion.
   */
  const editorMinHeight = computeEditorMinHeight(drawerHeight);
  const consoleMaxHeight = computeConsoleMaxHeight(drawerHeight);
  const consoleExpandable = consoleMaxHeight >= CONSOLE_MIN_HEIGHT;

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
    <div ref={rootRef} style={{ height: drawerHeight }} className="flex w-full shrink-0 flex-col border-t border-ink-200 bg-white">
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
          layout unchanged at desktop widths. Founder-feedback pass —
          `ref`+the `--script-sidebar-w` custom property is the sidebar
          width's live handle, see this component's own module doc. */}
      <div
        ref={sidebarRowRef}
        style={{ "--script-sidebar-w": `${sidebarWidth}px` } as React.CSSProperties}
        className="flex min-h-0 flex-1 flex-col sm:flex-row"
      >
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

        <SidebarResizeHandle
          getCurrentWidth={() => sidebarWidth}
          onResize={handleSidebarResize}
          onResizeEnd={handleSidebarResizeEnd}
          onDoubleClickReset={handleSidebarResizeReset}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <CodeEditor
            value={source}
            onChange={handleSourceChange}
            readOnly={openScript.kind === "example"}
            // Founder-feedback pass — a genuine min-height floor. Measured
            // live: with the drawer at its DEFAULT height and a stats card
            // showing, the editor was crushed to ~134px (5-6 visible
            // lines) — this guarantees it never shrinks below a usable
            // size regardless of how much the results block wants.
            // `editorMinHeight` (inline style, not a Tailwind class — see
            // `EDITOR_MIN_HEIGHT_PX`'s own doc for why) is derived by
            // `computeEditorMinHeight` from the drawer's ACTUAL height
            // (QA-fix pass, 2026-08-05) — the SAME function
            // `computeConsoleMaxHeight` budgets against, so the console's
            // own resize handle can never drag past the point where this
            // floor and the console's content would overlap. On a short
            // drawer this floor shrinks toward 0 rather than staying
            // pinned at `EDITOR_MIN_HEIGHT_PX` — a fixed floor bigger than
            // the drawer can afford would overflow past it, not yield.
            // `min-h-0` in the class list plus a numeric `minHeight` in the
            // inline style isn't a contradiction — the inline style always
            // wins (higher specificity), so this reads as "shrinkable in
            // principle, but never below editorMinHeight" rather than
            // fighting the flex item's own default content-based auto-min.
            className="min-h-0 flex-1"
            style={{ minHeight: editorMinHeight }}
            onRunShortcut={handleRunShortcut}
            onSaveShortcut={handleSaveShortcut}
          />
          {scriptRunResult && (
            <div className="flex shrink-0 flex-col border-t border-ink-100">
              {/* Founder-feedback pass — collapsible (was always-rendered
                  whenever a result existed, measured to crush the editor
                  down to ~134px at the drawer's default height). Mirrors
                  ScriptConsole's own header-row/chevron shape for a
                  consistent "collapsible section" idiom across this drawer. */}
              <button
                type="button"
                onClick={() => setResultsCollapsed((prev) => !prev)}
                className="flex items-center justify-between px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500 hover:bg-ink-50"
              >
                <span className="flex items-center gap-1.5">
                  Results
                  <OriginBadge origin={scriptRunResult.origin} />
                </span>
                {resultsCollapsed ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
              {!resultsCollapsed && (
                <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-ink-100 p-2">
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
          )}
        </div>
      </div>

      <ScriptConsole
        logs={consoleState.logs}
        error={consoleState.error}
        // QA-fix pass (2026-08-05) — forced collapsed whenever the drawer
        // is too short to expand it without overlapping the editor's own
        // floor (`consoleExpandable`, derived above), regardless of the
        // user's own last-set `collapsed` preference. Self-heals: shrink
        // the drawer past the threshold and this collapses with zero user
        // action; grow it back and the user's own state (never mutated
        // here) re-takes effect automatically.
        collapsed={consoleState.collapsed || !consoleExpandable}
        onToggleCollapsed={() => {
          // Collapsing is always allowed; EXPANDING is a no-op while
          // there's no room for it — otherwise `consoleState.collapsed`
          // would flip to `false` while the forced-collapsed render above
          // keeps hiding the content, leaving the toggle looking broken
          // instead of just correctly disabled.
          if (!consoleExpandable && consoleState.collapsed) return;
          setConsoleState((prev) => ({ ...prev, collapsed: !prev.collapsed }));
        }}
        height={clampConsoleHeight(consoleHeight, consoleMaxHeight)}
        onHeightChange={handleConsoleHeightChange}
        getMaxHeight={() => computeConsoleMaxHeight(drawerHeight)}
      />
    </div>
  );
}
