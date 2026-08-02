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
 */
import { useEffect, useMemo, useState } from "react";
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
  onToggleMagnet
}: {
  activeTool: string | null;
  onSelectTool: (overlayName: string, presetStyles?: Record<string, unknown>) => void;
  onCancelActiveTool: () => void;
  onClearAll: () => void;
  magnetEnabled: boolean;
  onToggleMagnet: () => void;
}) {
  const [openFamily, setOpenFamily] = useState<FamilyId | "search" | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    setFavorites(new Set(readStoredNames(FAVORITES_KEY)));
    setRecents(readStoredNames(RECENTS_KEY));
  }, []);

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

  function handleFamilyClick(family: FamilyId) {
    if (activeTool) onCancelActiveTool();
    setOpenFamily((prev) => (prev === family ? null : family));
  }

  function handleSearchClick() {
    if (activeTool) onCancelActiveTool();
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
    <div className="relative flex w-11 shrink-0 flex-col items-center gap-1 overflow-visible border-r border-ink-100 py-2">
      <button
        type="button"
        title="Search all tools"
        aria-label="Search all tools"
        aria-pressed={openFamily === "search"}
        onClick={handleSearchClick}
        className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors ${
          openFamily === "search" ? "bg-sky-600 text-white" : "text-ink-500 hover:bg-ink-100 hover:text-ink-900"
        }`}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        {openFamily === "search" && (
          <ToolFlyout family="search" activeTool={activeTool} favorites={favorites} onToggleFavorite={toggleFavorite} onSelectTool={pick} onClose={() => setOpenFamily(null)} />
        )}
      </button>

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
          <button
            key={fam.id}
            type="button"
            title={lastUsed ? `${fam.label} — last used: ${TOOL_REGISTRY[lastUsed].label}` : fam.label}
            aria-label={fam.label}
            aria-pressed={isOpen}
            onClick={() => handleFamilyClick(fam.id)}
            className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors ${
              isOpen ? "bg-sky-600 text-white" : "text-ink-500 hover:bg-ink-100 hover:text-ink-900"
            }`}
          >
            <FaceIcon className="h-4 w-4" aria-hidden="true" />
            {isOpen && (
              <ToolFlyout
                family={fam.id}
                activeTool={activeTool}
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
                onSelectTool={pick}
                onSelectEmoji={fam.id === "emoji" ? pickEmoji : undefined}
                onClose={() => setOpenFamily(null)}
              />
            )}
          </button>
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
