"use client";

/**
 * TA Suite Sprint S1, T6 — full toolbar rewrite. TradingView-pattern rail:
 * 8 family buttons (`tool-registry.ts`'s `TOOL_FAMILIES`, in order) + a
 * dedicated search icon + magnet toggle + confirm-gated "Clear all",
 * clicking a family opens `tool-flyout.tsx` anchored beside it.
 *
 * Parent contract UNCHANGED from the pre-S1 toolbar (`activeTool`/
 * `onSelectTool`/`onCancelActiveTool`/`onClearAll`) + the two ADDITIVE
 * props the plan names explicitly: `magnetEnabled`/`onToggleMagnet`.
 * `onSelectTool` itself widens to `(overlayName, presetStyles?)` — the
 * SAME callback now covers three cases uniformly: a plain tool pick (no
 * preset), the `highlighter` alias (maps to the real `brush` overlay name
 * + `HIGHLIGHTER_PRESET_STYLES`, per D2), and an emoji-palette pick (maps
 * to `emojiSticker` + `{pfContent:{emoji}}}`, per the plan's "12-emoji
 * palette in flyout sets pendingToolStyles").
 *
 * `localStorage` keys `pf.workbench.toolFavorites` / `pf.workbench
 * .toolRecents` — validated on load (same posture as `indicator-picker
 * .tsx`'s `isValidSelection`: corrupt/private-mode storage silently falls
 * back to empty, never throws). Each family rail button's face icon
 * reflects the FAMILY's own last-used tool (from `toolRecents`) once one
 * exists, per the plan's "family face icon = last-used tool" — falls back
 * to the family's default icon otherwise.
 *
 * **Founder bug fix (2026-08-03)**: `ToolFlyout` used to render INSIDE the
 * rail `<button>` it opens from (`<button onClick={handleFamilyClick}>
 * {isOpen && <ToolFlyout/>}</button>`). `ToolFlyout` itself renders several
 * `<button>`s (search-close, per-row select, per-row favorite star, emoji
 * swatches) — a `<button>` nested inside a `<button>` is invalid HTML, but
 * because the flyout mounts via client-side DOM mutation (not the initial
 * HTML parse), the browser does NOT auto-correct it: the nested buttons sit
 * as real DOM descendants of the outer rail button. A click on any inner
 * button therefore natively BUBBLES up to the outer button's own `onClick`
 * after the inner handler runs. Picking a tool called `pick()` (closes the
 * flyout: `setOpenFamily(null)`), and the SAME click then bubbled into
 * `handleFamilyClick`, whose toggle updater (`prev === family ? null :
 * family`) saw `prev` already `null` and flipped it straight back OPEN —
 * net effect: the flyout never visibly closed, exactly the founder's
 * report ("after choosing the marker it should shrink — right now it's
 * covering the chart"). Fixed by making each rail button and its flyout
 * SIBLINGS inside a `relative` wrapper `<div>` instead of parent/child —
 * selecting a tool now closes the flyout with nothing left to bubble into.
 * Also added: Escape-to-close and outside-pointerdown-to-close for any open
 * flyout (neither existed before), same `pointerdown`-capture + `keydown`
 * idiom as `drawing-text-popover.tsx`, scoped to a ref around the whole
 * rail so clicks anywhere inside the toolbar (family buttons, flyout rows)
 * never count as "outside."
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Magnet, Search, Trash2 } from "lucide-react";

import { TOOL_FAMILIES, TOOL_REGISTRY, type FamilyId, type ToolRegistryName } from "./tool-registry";
import { ToolFlyout } from "./tool-flyout";
import { TEAL } from "./overlays/figure-kit";

const FAVORITES_KEY = "pf.workbench.toolFavorites";
const RECENTS_KEY = "pf.workbench.toolRecents";
const MAX_RECENTS = 12;
const MAX_FAVORITES_SHOWN = 6;

/** D2 — the `highlighter` toolbar alias's preset styles: a translucent, wide `brush` stroke, persisted like any other `brush` row (indistinguishable from a plain brush on reload except for this preset). */
export const HIGHLIGHTER_PRESET_STYLES: Record<string, unknown> = {
  line: { color: `${TEAL}66`, size: 10 }
};

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function readStoredNames(key: string): string[] {
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!isStringArray(parsed)) return [];
    return parsed.filter((name) => name in TOOL_REGISTRY || name === "highlighter");
  } catch {
    return []; // private mode / storage disabled / corrupt value — fall back to empty, never throw.
  }
}

function writeStoredNames(key: string, names: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(names));
  } catch {
    // Preference just won't survive the refresh.
  }
}

export function WorkbenchToolbar({
  activeTool,
  onSelectTool,
  onCancelActiveTool,
  onClearAll,
  magnetEnabled,
  onToggleMagnet,
  premiumMode
}: {
  activeTool: string | null;
  onSelectTool: (overlayName: string, presetStyles?: Record<string, unknown>) => void;
  onCancelActiveTool: () => void;
  onClearAll: () => void;
  magnetEnabled: boolean;
  onToggleMagnet: () => void;
  /** True while charting option-premium pseudo-candles — passed straight through to `ToolFlyout` to grey out `premiumDisabled` tools (currently only `anchoredVWAP`). */
  premiumMode?: boolean;
}) {
  const [openFamily, setOpenFamily] = useState<FamilyId | "search" | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [recents, setRecents] = useState<string[]>([]);
  const railRef = useRef<HTMLDivElement | null>(null);
  /** Founder-feedback pass (2026-08-04) — the trigger button's own bounding rect, captured at click time, threaded to `ToolFlyout` for its viewport-fit clamp (see that file's own doc). */
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    setFavorites(new Set(readStoredNames(FAVORITES_KEY)));
    setRecents(readStoredNames(RECENTS_KEY));
  }, []);

  // Founder bug fix (2026-08-03) — Escape and outside-pointerdown both
  // close whichever flyout is open. Only attached while a flyout IS open
  // (not on every mount) so this never fights `drawing-text-popover.tsx`'s
  // own, higher-priority Escape handling when neither is relevant.
  useEffect(() => {
    if (openFamily === null) return;
    function handlePointerDown(e: PointerEvent) {
      if (railRef.current && !railRef.current.contains(e.target as Node)) setOpenFamily(null);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenFamily(null);
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openFamily]);

  function toggleFavorite(name: ToolRegistryName) {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      writeStoredNames(FAVORITES_KEY, Array.from(next));
      return next;
    });
  }

  function recordRecent(name: string) {
    setRecents((prev) => {
      const next = [name, ...prev.filter((n) => n !== name)].slice(0, MAX_RECENTS);
      writeStoredNames(RECENTS_KEY, next);
      return next;
    });
  }

  function pick(name: ToolRegistryName) {
    recordRecent(name);
    if (name === "highlighter") {
      onSelectTool("brush", HIGHLIGHTER_PRESET_STYLES);
    } else {
      onSelectTool(name);
    }
    setOpenFamily(null);
  }

  function pickEmoji(emoji: string) {
    recordRecent("emojiSticker");
    onSelectTool("emojiSticker", { pfContent: { emoji } });
    setOpenFamily(null);
  }

  function handleFamilyClick(family: FamilyId, rect: DOMRect) {
    if (activeTool) onCancelActiveTool();
    setAnchorRect(rect);
    setOpenFamily((prev) => (prev === family ? null : family));
  }

  function handleSearchClick(rect: DOMRect) {
    if (activeTool) onCancelActiveTool();
    setAnchorRect(rect);
    setOpenFamily((prev) => (prev === "search" ? null : "search"));
  }

  function handleClearAll() {
    if (!window.confirm("Clear all drawings on this chart? This can't be undone.")) return;
    onClearAll();
  }

  const lastUsedIconByFamily = useMemo(() => {
    const map = new Map<FamilyId, ToolRegistryName>();
    for (const name of recents) {
      const meta = (TOOL_REGISTRY as Record<string, (typeof TOOL_REGISTRY)[ToolRegistryName]>)[name];
      if (!meta) continue;
      if (!map.has(meta.family)) map.set(meta.family, name as ToolRegistryName);
    }
    return map;
  }, [recents]);

  const favoriteRows = useMemo(
    () =>
      Array.from(favorites)
        .filter((name): name is ToolRegistryName => name in TOOL_REGISTRY)
        .slice(0, MAX_FAVORITES_SHOWN),
    [favorites]
  );

  return (
    <div ref={railRef} className="relative flex w-11 shrink-0 flex-col items-center gap-1 overflow-visible border-r border-ink-100 py-2">
      <div className="relative shrink-0">
        <button
          type="button"
          title="Search all tools"
          aria-label="Search all tools"
          aria-pressed={openFamily === "search"}
          onClick={(e) => handleSearchClick(e.currentTarget.getBoundingClientRect())}
          className={`flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
            openFamily === "search" ? "bg-sky-600 text-white" : "text-ink-500 hover:bg-ink-100 hover:text-ink-900"
          }`}
        >
          <Search className="h-4 w-4" aria-hidden="true" />
        </button>
        {openFamily === "search" && (
          <ToolFlyout
            family="search"
            activeTool={activeTool}
            favorites={favorites}
            premiumMode={premiumMode}
            anchorRect={anchorRect}
            onToggleFavorite={toggleFavorite}
            onSelectTool={pick}
            onClose={() => setOpenFamily(null)}
          />
        )}
      </div>

      <button
        type="button"
        title={magnetEnabled ? "Magnet: on (weak snap to nearby points)" : "Magnet: off"}
        aria-label="Toggle magnet snapping"
        aria-pressed={magnetEnabled}
        onClick={onToggleMagnet}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors ${
          magnetEnabled ? "bg-teal-600 text-white" : "text-ink-500 hover:bg-ink-100 hover:text-ink-900"
        }`}
      >
        <Magnet className="h-4 w-4" aria-hidden="true" />
      </button>

      {favoriteRows.length > 0 && (
        <>
          <span className="my-1 h-px w-6 bg-ink-100" aria-hidden="true" />
          {favoriteRows.map((name) => {
            const meta = TOOL_REGISTRY[name];
            const Icon = meta.icon;
            const isActive = activeTool === (name === "highlighter" ? "brush" : name);
            return (
              <button
                key={`fav-${name}`}
                type="button"
                title={`★ ${meta.label}`}
                aria-label={meta.label}
                aria-pressed={isActive}
                onClick={() => pick(name)}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  isActive ? "bg-sky-600 text-white" : "text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </button>
            );
          })}
        </>
      )}

      <span className="my-1 h-px w-6 bg-ink-100" aria-hidden="true" />

      {TOOL_FAMILIES.map((fam) => {
        const lastUsed = lastUsedIconByFamily.get(fam.id);
        const FaceIcon = lastUsed ? TOOL_REGISTRY[lastUsed].icon : fam.icon;
        const isOpen = openFamily === fam.id;
        return (
          <div key={fam.id} className="relative shrink-0">
            <button
              type="button"
              title={lastUsed ? `${fam.label} — last used: ${TOOL_REGISTRY[lastUsed].label}` : fam.label}
              aria-label={fam.label}
              aria-pressed={isOpen}
              onClick={(e) => handleFamilyClick(fam.id, e.currentTarget.getBoundingClientRect())}
              className={`flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
                isOpen ? "bg-sky-600 text-white" : "text-ink-500 hover:bg-ink-100 hover:text-ink-900"
              }`}
            >
              <FaceIcon className="h-4 w-4" aria-hidden="true" />
            </button>
            {isOpen && (
              <ToolFlyout
                family={fam.id}
                activeTool={activeTool}
                favorites={favorites}
                premiumMode={premiumMode}
                anchorRect={anchorRect}
                onToggleFavorite={toggleFavorite}
                onSelectTool={pick}
                onSelectEmoji={fam.id === "emoji" ? pickEmoji : undefined}
                onClose={() => setOpenFamily(null)}
              />
            )}
          </div>
        );
      })}

      <span className="my-1 h-px w-6 bg-ink-100" aria-hidden="true" />
      <button
        type="button"
        title="Clear all drawings"
        aria-label="Clear all drawings"
        onClick={handleClearAll}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-rose-500 transition-colors hover:bg-rose-50 hover:text-rose-700"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
