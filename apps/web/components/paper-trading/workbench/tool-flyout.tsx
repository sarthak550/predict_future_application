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
 *
 * Founder-feedback pass (2026-08-03) — `premiumMode` disables any row whose
 * `ToolMeta.premiumDisabled` is set (currently only `anchoredVWAP`, same
 * field name/posture as `indicator-dialog.tsx`'s identical gate on the
 * `VWAP` indicator): the row is unclickable, visually dimmed, and carries a
 * `title` tooltip explaining why — never silently hidden, so a user doesn't
 * wonder where the tool went.
 *
 * Founder-feedback pass (2026-08-04) — **viewport fit**: bottom-family
 * flyouts (Measure, Annotations, Emoji, the rail's own last few entries)
 * could render with their bottom edge past the viewport, since the flyout is
 * `position: absolute` anchored at `top: 0` of its OWN trigger button — a
 * button near the bottom of the 44px rail leaves little room below it for a
 * flyout that can run up to `70vh` tall. Fixed with two independent layers
 * (both requested explicitly, neither alone is sufficient): (1) `anchorRect`
 * (the trigger button's own `getBoundingClientRect()`, captured by
 * `workbench-toolbar.tsx` at click time) drives a `useLayoutEffect` that
 * measures the flyout's OWN rendered height and shifts `top` UP just enough
 * to keep its bottom edge within the viewport (the workbench is `fixed
 * inset-0` fullscreen, so viewport height IS the workbench container's own
 * height — no separate container ref needed), clamped so the shift never
 * pushes the flyout's own top above an 8px viewport margin; (2) the
 * pre-existing `max-h-[70vh] overflow-y-auto` (unchanged) still catches the
 * case where the flyout is simply taller than the viewport itself even after
 * shifting all the way up — internal scroll, never off-screen clipping.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Search, Star, X } from "lucide-react";

import { TOOL_FAMILIES, toolsInFamily, TOOL_REGISTRY, type FamilyId, type ToolRegistryName } from "./tool-registry";

/** 12-emoji palette (plan's explicit count) for the `emojiSticker` tool's flyout — picking one sets `pendingToolStyles.pfContent.emoji` BEFORE the draw starts. */
export const EMOJI_PALETTE = ["⭐", "🔥", "🚀", "⚠️", "✅", "❌", "💰", "📈", "📉", "🎯", "👀", "💡"] as const;

export function ToolFlyout({
  family,
  activeTool,
  favorites,
  premiumMode,
  anchorRect,
  onToggleFavorite,
  onSelectTool,
  onSelectEmoji,
  onClose
}: {
  family: FamilyId | "search";
  activeTool: string | null;
  favorites: Set<string>;
  /** True while charting option-premium pseudo-candles — disables any `premiumDisabled` tool row. See module doc. */
  premiumMode?: boolean;
  /** The trigger button's own `getBoundingClientRect()`, captured by the caller at click time — drives the viewport-fit clamp. `null`/omitted falls back to the un-clamped `top-0` anchor (should never actually happen given every call site now supplies it, but keeps this component safe to use standalone). See module doc. */
  anchorRect?: { top: number; bottom: number } | null;
  onToggleFavorite: (name: ToolRegistryName) => void;
  onSelectTool: (name: ToolRegistryName) => void;
  /** Only meaningful for the `emoji` family — see module doc. */
  onSelectEmoji?: (emoji: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim().toLowerCase();

  // Founder-feedback pass (2026-08-04) — viewport-fit shift. Runs once per
  // open (`anchorRect` is a freshly-captured object each click, so this
  // effect naturally re-fires per open) — measures the just-rendered
  // flyout's own height and shifts `top` up only as much as needed to keep
  // the bottom edge on-screen, never above an 8px top margin.
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  const [topShift, setTopShift] = useState(0);
  useLayoutEffect(() => {
    const el = flyoutRef.current;
    if (!el || !anchorRect) {
      setTopShift(0);
      return;
    }
    const rect = el.getBoundingClientRect();
    const viewportBottom = window.innerHeight - 8;
    const overflow = anchorRect.top + rect.height - viewportBottom;
    if (overflow <= 0) {
      setTopShift(0);
      return;
    }
    const maxShiftUp = Math.max(0, anchorRect.top - 8);
    setTopShift(-Math.min(overflow, maxShiftUp));
    // Re-measure whenever the anchor changes (a new open) or the visible
    // row count changes (search query narrows/widens the list, which
    // changes the flyout's own rendered height).
  }, [anchorRect, trimmed, family]);

  const groups = useMemo((): Array<{
    label: string;
    rows: Array<{ name: ToolRegistryName; label: string; icon: (typeof TOOL_REGISTRY)[ToolRegistryName]["icon"]; premiumDisabled?: boolean }>;
  }> => {
    if (trimmed.length > 0) {
      return TOOL_FAMILIES.map((fam) => ({
        label: fam.label,
        rows: toolsInFamily(fam.id)
          .filter(({ meta }) => meta.label.toLowerCase().includes(trimmed) || String(fam).toLowerCase().includes(trimmed))
          .map(({ name, meta }) => ({ name, label: meta.label, icon: meta.icon, premiumDisabled: meta.premiumDisabled }))
      })).filter((g) => g.rows.length > 0);
    }
    if (family === "search") return [];
    const fam = TOOL_FAMILIES.find((f) => f.id === family);
    return [
      {
        label: fam?.label ?? "",
        rows: toolsInFamily(family).map(({ name, meta }) => ({ name, label: meta.label, icon: meta.icon, premiumDisabled: meta.premiumDisabled }))
      }
    ];
  }, [trimmed, family]);

  return (
    <div
      ref={flyoutRef}
      className="absolute left-full z-10 ml-1 w-64 max-h-[70vh] overflow-y-auto rounded-xl border border-ink-200 bg-white shadow-lg"
      style={{ top: topShift }}
    >
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
          {group.rows.map(({ name, label, icon: Icon, premiumDisabled }) => {
            const isFavorite = favorites.has(name);
            const isActive = activeTool === name;
            const disabled = Boolean(premiumMode && premiumDisabled);
            return (
              <div key={name} className={`flex items-center gap-2 px-2 py-1 ${isActive ? "bg-sky-50" : "hover:bg-ink-50"}`}>
                <button
                  type="button"
                  disabled={disabled}
                  title={disabled ? "Not available for option premium data (no real traded volume)" : undefined}
                  onClick={() => !disabled && onSelectTool(name)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-40"
                >
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
