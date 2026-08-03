/**
 * User Strategy Scripting (SS2), D7 — autosave drafts. Key
 * `pf.workbench.scriptDraft.{scriptId ?? "new"}` (a `"new"` bucket for an
 * unsaved, never-persisted script), value `{v: 1, source, savedAt}`. Follows
 * the SAME localStorage-after-hydration idiom every other persisted
 * preference in this file family uses (`chart-workbench.tsx`'s `indicators`/
 * `strategyId`/`panelWidth`) — this module only provides the pure
 * read/write/clear primitives; `script-editor-drawer.tsx` is responsible for
 * calling `loadScriptDraft` inside a `useEffect` that runs after mount (and
 * again on every real script switch), never during initial render.
 */

export interface ScriptDraft {
  v: 1;
  source: string;
  savedAt: number;
}

export function draftStorageKey(scriptId: string | null): string {
  return `pf.workbench.scriptDraft.${scriptId ?? "new"}`;
}

export function loadScriptDraft(scriptId: string | null): ScriptDraft | null {
  try {
    const raw = window.localStorage.getItem(draftStorageKey(scriptId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    if (p.v !== 1 || typeof p.source !== "string" || typeof p.savedAt !== "number") return null;
    return { v: 1, source: p.source, savedAt: p.savedAt };
  } catch {
    return null; // private mode / storage disabled / corrupt value.
  }
}

export function saveScriptDraft(scriptId: string | null, source: string): void {
  try {
    window.localStorage.setItem(draftStorageKey(scriptId), JSON.stringify({ v: 1, source, savedAt: Date.now() } satisfies ScriptDraft));
  } catch {
    // Draft just won't survive the refresh — never blocks editing.
  }
}

export function clearScriptDraft(scriptId: string | null): void {
  try {
    window.localStorage.removeItem(draftStorageKey(scriptId));
  } catch {
    // Nothing to do — the key just won't be removed until it expires from disk on its own.
  }
}
