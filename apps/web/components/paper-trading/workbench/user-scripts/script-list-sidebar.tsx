"use client";

/**
 * User Strategy Scripting (SS2), §3 — the drawer's left-hand list sidebar
 * (fixed ~200px, per D4). Two sections: "My Scripts" (the caller's real
 * `UserStrategyScript` rows, backed by SS1's CRUD) and "Examples" (the 8
 * read-only teaching scripts from `lib/ta/example-scripts.ts`, visually
 * distinct via a lock icon). Purely presentational/controlled — every
 * mutation is a callback, `script-editor-drawer.tsx` owns all the actual
 * state (which script is open, the fetched list, loading/error).
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
    <div className="flex w-[200px] shrink-0 flex-col overflow-y-auto border-r border-ink-100">
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
        {!scriptsLoading && !scriptsError && myScripts.length === 0 && (
          <p className="px-1.5 py-2 text-[11px] leading-4 text-ink-400">No scripts yet — click + to start writing one.</p>
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
