"use client";

/**
 * User Strategy Scripting (SS2), §3 — the console strip. Renders the last
 * run's `console.log` output (newest last, scrollable) and, on failure, the
 * LINE-CORRECTED error (SS1's `WRAP_LINE_OFFSET` machinery already did the
 * correction — this component just renders whatever `line`/`message` it's
 * handed, verbatim, no re-deriving). The timeout case's exact copy
 * (`script-runner.ts`'s `SCRIPT_TIMEOUT_MESSAGE`) arrives here as a plain
 * `error.message` with no `line` — rendered as-is, no additional
 * editorializing added at this layer, per this codebase's honesty-copy law
 * (see `strategy-panel.tsx`'s own disclaimer doc for the same law applied
 * elsewhere).
 *
 * Collapsible (drawer real-estate is scarce with editor+list+toolbar all
 * competing for it), but `script-editor-drawer.tsx` is responsible for
 * force-expanding this on every FRESH result that carries an error or a
 * non-empty `logs` array — this component itself is purely presentational,
 * it never decides to auto-expand on its own.
 */
import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";

export interface ScriptConsoleProps {
  logs: string[];
  error: { message: string; line?: number } | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function ScriptConsole({ logs, error, collapsed, onToggleCollapsed }: ScriptConsoleProps) {
  const hasContent = logs.length > 0 || error !== null;

  return (
    <div className="flex shrink-0 flex-col border-t border-ink-100">
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex items-center justify-between px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500 hover:bg-ink-50"
      >
        <span className="flex items-center gap-1.5">
          Console
          {error && <TriangleAlert className="h-3 w-3 text-rose-600" aria-hidden="true" />}
          {hasContent && (
            <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium normal-case text-ink-500">
              {error ? "error" : `${logs.length} log${logs.length === 1 ? "" : "s"}`}
            </span>
          )}
        </span>
        {collapsed ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
      {!collapsed && (
        <div className="max-h-32 overflow-y-auto border-t border-ink-100 bg-ink-50 px-3 py-2 font-mono text-[11px] leading-5">
          {!hasContent && <p className="text-ink-400">No output yet — click Run to see logs and errors here.</p>}
          {logs.map((line, i) => (
            <p key={i} className="whitespace-pre-wrap break-words text-ink-700">
              {line}
            </p>
          ))}
          {error && (
            <p className="whitespace-pre-wrap break-words font-semibold text-rose-700">
              {error.line !== undefined ? `Line ${error.line}: ${error.message}` : error.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
