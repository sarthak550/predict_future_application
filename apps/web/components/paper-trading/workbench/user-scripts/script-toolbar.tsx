"use client";

/**
 * User Strategy Scripting (SS2), D8 — the drawer's top-edge toolbar, exact
 * contents: Run, Save, Save as, Rename, Delete, a dirty-dot, and the
 * mandatory disclaimer line (kept in this same component, always rendered
 * beneath the button row, never collapsible/dismissible — the same
 * always-visible law `StrategyDisclaimerFooter`'s own doc already
 * establishes for the Strategy tab's amber disclaimer).
 *
 * Viewing a read-only Example (`mode === "example"`) swaps the whole button
 * row for a single "Duplicate to edit" affordance (Run/Save/Rename/Delete
 * would all be meaningless against a script the caller doesn't own) — per
 * §3's exact framing ("only 'Duplicate to edit' active").
 */
import { Circle, Copy, Loader2, Pencil, Play, Save, SaveAll, Trash2 } from "lucide-react";

export interface ScriptToolbarProps {
  mode: "new" | "script" | "example";
  scriptName: string | null;
  isDirty: boolean;
  isRunning: boolean;
  canRun: boolean;
  onRun: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

const BUTTON_CLASS =
  "flex items-center gap-1.5 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

export function ScriptToolbar({ mode, scriptName, isDirty, isRunning, canRun, onRun, onSave, onSaveAs, onRename, onDelete, onDuplicate }: ScriptToolbarProps) {
  const displayName = scriptName ?? (mode === "new" ? "Untitled script" : "Script");

  return (
    <div className="flex shrink-0 flex-col border-b border-ink-100">
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2">
        <span className="mr-1 flex min-w-0 items-center gap-1.5 text-xs font-semibold text-ink-800">
          <span className="truncate">{displayName}</span>
          {isDirty && mode !== "example" && (
            <Circle className="h-2 w-2 shrink-0 fill-amber-500 text-amber-500" aria-label="Unsaved changes" />
          )}
        </span>

        {mode === "example" ? (
          <button type="button" onClick={onDuplicate} className={`${BUTTON_CLASS} ml-auto border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100`}>
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            Duplicate to edit
          </button>
        ) : (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={onRun} disabled={!canRun || isRunning} className={`${BUTTON_CLASS} border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100`}>
              {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
              {isRunning ? "Running…" : "Run"}
            </button>
            <button type="button" onClick={onSave} disabled={!isDirty} className={BUTTON_CLASS}>
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              Save
            </button>
            <button type="button" onClick={onSaveAs} className={BUTTON_CLASS}>
              <SaveAll className="h-3.5 w-3.5" aria-hidden="true" />
              Save as
            </button>
            <button type="button" onClick={onRename} disabled={mode === "new"} className={BUTTON_CLASS}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Rename
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={mode === "new"}
              className={`${BUTTON_CLASS} hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Delete
            </button>
          </div>
        )}
      </div>
      <p className="border-t border-ink-100 bg-ink-50 px-2.5 py-1.5 text-[11px] text-ink-500">
        Your script runs locally in your browser · signals are your own logic, not advice
      </p>
    </div>
  );
}
