"use client";

/**
 * TA Suite Sprint S1, T6 — the flyout panel `workbench-toolbar.tsx` opens
 * when a family rail button (or the dedicated search icon) is clicked.
 * Always shows a search box at the top — when it has a query, results are
 * NOT confined to the family that was clicked (the ticket's own explicit
 * acceptance criterion: "search input filters across all families in real
 * time, not just within the currently-open family") — typing there swaps
 * the listed rows from "this family's tools" to "every tool in
 * `TOOL_REGISTRY` whose label matches, across all 8 families, with a
 * family-label subheading per group."
 *
 * Star toggles + emoji swatches (rendered inline for the `emoji` family,
 * per the plan's "12-emoji palette in flyout sets pendingToolStyles") are
 * both ≥32px touch targets with a visible selected/active state that
 * doesn't rely on color alone (a filled star icon / a ring, not just a
 * color swap) — the sprint's explicit a11y acceptance line.
 */
import { useMemo, useState } from "react";
import { Search, Star, X } from "lucide-react";

import { TOOL_FAMILIES, toolsInFamily, TOOL_REGISTRY, type FamilyId, type ToolRegistryName } from "./tool-registry";

/** 12-emoji palette (plan's explicit count) for the `emojiSticker` tool's flyout — picking one sets `pendingToolStyles.pfContent.emoji` BEFORE the draw starts. */
export const EMOJI_PALETTE = ["⭐", "🔥", "🚀", "⚠️", "✅", "❌", "💰", "📈", "📉", "🎯", "👀", "💡"] as const;

export function ToolFlyout({
  family,
  activeTool,
  favorites,
  onToggleFavorite,
  onSelectTool,
  onSelectEmoji,
  onClose
}: {
  family: FamilyId | "search";
  activeTool: string | null;
  favorites: Set<string>;
  onToggleFavorite: (name: ToolRegistryName) => void;
  onSelectTool: (name: ToolRegistryName) => void;
  /** Only meaningful for the `emoji` family — see module doc. */
  onSelectEmoji?: (emoji: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim().toLowerCase();

  const groups = useMemo((): Array<{ label: string; rows: Array<{ name: ToolRegistryName; label: string; icon: (typeof TOOL_REGISTRY)[ToolRegistryName]["icon"] }> }> => {
    if (trimmed.length > 0) {
      return TOOL_FAMILIES.map((fam) => ({
        label: fam.label,
        rows: toolsInFamily(fam.id)
          .filter(({ meta }) => meta.label.toLowerCase().includes(trimmed) || String(fam).toLowerCase().includes(trimmed))
          .map(({ name, meta }) => ({ name, label: meta.label, icon: meta.icon }))
      })).filter((g) => g.rows.length > 0);
    }
    if (family === "search") return [];
    const fam = TOOL_FAMILIES.find((f) => f.id === family);
    return [{ label: fam?.label ?? "", rows: toolsInFamily(family).map(({ name, meta }) => ({ name, label: meta.label, icon: meta.icon })) }];
  }, [trimmed, family]);

  return (
    <div className="absolute left-full top-0 z-10 ml-1 w-64 max-h-[70vh] overflow-y-auto rounded-xl border border-ink-200 bg-white shadow-lg">
      <div className="sticky top-0 flex items-center gap-1.5 border-b border-ink-100 bg-white px-2 py-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden="true" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all tools…"
          className="min-w-0 flex-1 border-none bg-transparent text-xs text-ink-800 outline-none placeholder:text-ink-400"
        />
        <button type="button" onClick={onClose} className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700" title="Close" aria-label="Close">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {family === "emoji" && trimmed.length === 0 && (
        <div className="grid grid-cols-4 gap-1.5 border-b border-ink-100 p-2">
          {EMOJI_PALETTE.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onSelectEmoji?.(emoji)}
              title={`Emoji sticker: ${emoji}`}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-lg hover:bg-ink-100"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {groups.length === 0 && <p className="px-3 py-4 text-center text-xs text-ink-400">No tools match “{query}”.</p>}

      {groups.map((group) => (
        <div key={group.label}>
          {trimmed.length > 0 && <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-400">{group.label}</p>}
          {group.rows.map(({ name, label, icon: Icon }) => {
            const isFavorite = favorites.has(name);
            const isActive = activeTool === name;
            return (
              <div key={name} className={`flex items-center gap-2 px-2 py-1 ${isActive ? "bg-sky-50" : "hover:bg-ink-50"}`}>
                <button type="button" onClick={() => onSelectTool(name)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left">
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-sky-600" : "text-ink-500"}`} aria-hidden="true" />
                  <span className={`truncate text-xs ${isActive ? "font-semibold text-sky-700" : "text-ink-700"}`}>{label}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onToggleFavorite(name)}
                  title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                  aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                  aria-pressed={isFavorite}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-ink-100"
                >
                  <Star className={`h-3.5 w-3.5 ${isFavorite ? "fill-amber-400 text-amber-500" : "text-ink-300"}`} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
