"use client";

/**
 * User Strategy Scripting (SS2), §3 — the drawer's left-hand list sidebar
 * (fixed ~200px, per D4). Two sections: "My Scripts" (the caller's real
 * `UserStrategyScript` rows, backed by SS1's CRUD) and "Examples" (the 8
 * read-only teaching scripts from `lib/ta/example-scripts.ts`, visually
 * distinct via a lock icon). Purely presentational/controlled — every
 * mutation is a callback, `script-editor-drawer.tsx` owns all the actual
 * state (which script is open, the fetched list, loading/error).
 *
 * **Founder-feedback pass (2026-08-04)** — width is now user-adjustable via
 * `SidebarResizeHandle` (a sibling the parent renders next to this
 * component, not inside it). The `sm:w-[var(--script-sidebar-w)]` class
 * below reads a CSS custom property `script-editor-drawer.tsx` sets on the
 * shared row ancestor — this lets the resize handle's drag update the width
 * with a single imperative `style.setProperty` call on that ancestor
 * (inherits down to every descendant referencing the var, including this
 * component) without this file needing a width PROP or a ref of its own.
 * The old static `sm:w-[200px]` is gone; `sm:border-r` moved onto the
 * handle itself (it now owns that visual seam).
 */
import { FileCode2, Lock, Loader2, Plus, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import type { ExampleScript } from "@/lib/ta/example-scripts";
import type { UserScriptRow } from "./user-scripts-api";

export interface ScriptListSidebarProps {
  myScripts: UserScriptRow[];
  scriptsLoading: boolean;
  scriptsError: string | null;
  examples: readonly ExampleScript[];
  openScriptId: string | null;
  openExampleId: string | null;
  onOpenNew: () => void;
  onOpenScript: (row: UserScriptRow) => void;
  onOpenExample: (example: ExampleScript) => void;
  onDeleteScript: (row: UserScriptRow) => void;
}

export function ScriptListSidebar({
  myScripts,
  scriptsLoading,
  scriptsError,
  examples,
  openScriptId,
  openExampleId,
  onOpenNew,
  onOpenScript,
  onOpenExample,
  onDeleteScript
}: ScriptListSidebarProps) {
  return (
    // SS3, T5 — narrow-viewport pass: below `sm` this stacks ABOVE the
    // editor (full width, height-capped so it can't dominate the drawer's
    // scarce vertical space on a phone-sized viewport) instead of sitting
    // beside it — the "stack list-above-editor-above-console" bar §4's own
    // text sets as the minimum, non-"beautiful" requirement. `sm:` and up
    // restores the original fixed-width side-by-side layout unchanged.
    <div className="flex max-h-[160px] w-full shrink-0 flex-col overflow-y-auto border-b border-ink-100 sm:max-h-none sm:w-[var(--script-sidebar-w)] sm:border-b-0">
      <div className="flex items-center justify-between px-2.5 pt-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">My Scripts</p>
        <button type="button" onClick={onOpenNew} title="New script" className="rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-col gap-0.5 px-1.5 py-1.5">
        {scriptsLoading && (
          <div className="flex items-center gap-1.5 px-1.5 py-2 text-[11px] text-ink-400">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            Loading…
          </div>
        )}
        {scriptsError && <p className="px-1.5 py-1 text-[11px] text-rose-600">{scriptsError}</p>}
        {/* SS3, T4 — a real empty state with a clickable CTA (not just text
            pointing at the nearby + icon), same "No X yet — [action]" house
            voice `signals-table.tsx`'s own "No custom signals yet — tap +
            above to build one" empty state and `positions-strip.tsx`'s "No
            open positions yet — trades you place will show up here" already
            establish elsewhere in this file family. */}
        {!scriptsLoading && !scriptsError && myScripts.length === 0 && (
          <button
            type="button"
            onClick={onOpenNew}
            className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-ink-200 px-2 py-3 text-center hover:border-sky-300 hover:bg-sky-50"
          >
            <FileCode2 className="h-4 w-4 text-ink-400" aria-hidden="true" />
            <span className="text-[11px] font-semibold text-ink-700">Write your first script</span>
            <span className="text-[10px] leading-4 text-ink-400">Or duplicate an example below to start from a working strategy.</span>
          </button>
        )}
        {myScripts.map((row) => {
          const active = row.id === openScriptId;
          return (
            <div
              key={row.id}
              className={`group flex items-center gap-1 rounded-md px-1.5 py-1.5 text-left text-[11px] ${
                active ? "bg-sky-50 text-sky-800" : "text-ink-600 hover:bg-ink-50"
              }`}
            >
              <button type="button" onClick={() => onOpenScript(row)} className="flex min-w-0 flex-1 flex-col text-left">
                <span className="truncate font-medium">{row.name}</span>
                <span className="truncate text-[10px] text-ink-400">{formatDistanceToNow(new Date(row.updatedAt), { addSuffix: true })}</span>
              </button>
              <button
                type="button"
                onClick={() => onDeleteScript(row)}
                title={`Delete "${row.name}"`}
                className="shrink-0 rounded p-1 text-ink-300 opacity-0 hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>

      <p className="px-2.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Examples</p>
      <div className="flex flex-col gap-0.5 px-1.5 py-1.5 pb-2.5">
        {examples.map((example) => {
          const active = example.id === openExampleId;
          return (
            <button
              key={example.id}
              type="button"
              onClick={() => onOpenExample(example)}
              className={`flex items-start gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[11px] ${
                active ? "bg-ink-100 text-ink-800" : "text-ink-500 hover:bg-ink-50"
              }`}
            >
              {example.id === "kitchenSink" ? (
                <FileCode2 className="mt-0.5 h-3 w-3 shrink-0 text-ink-400" aria-hidden="true" />
              ) : (
                <Lock className="mt-0.5 h-3 w-3 shrink-0 text-ink-400" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{example.name}</span>
                <span className="block truncate text-[10px] text-ink-400">{example.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
