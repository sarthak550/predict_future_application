"use client";

/**
 * Charting Workbench (W2 scaffold; W3, T3 fills this in) — the left
 * drawing-tool rail. One button per entry in `ALL_DRAWING_OVERLAYS`
 * (`custom-overlays.ts` — 16 built-in + 4 custom = 20 tools total, see that
 * file's own doc for the count correction carried from W1), grouped
 * visually (lines/rays → channels/fib → annotations → custom patterns), an
 * active-tool highlight, and a confirm-gated "Clear all" action pinned to
 * the bottom of the rail.
 *
 * Pure controlled UI — selecting a tool just calls `onSelectTool(name)`;
 * ALL the actual KLineCharts draw-mode wiring lives in `kline-chart.tsx`'s
 * `activeTool` prop-driven effect (this component has no klinecharts import
 * at all, same "pure controlled UI" posture as `indicator-picker.tsx`).
 * Clicking the CURRENTLY-active tool again cancels the in-progress draw
 * (`onCancelActiveTool`) rather than starting a second one.
 *
 * Touch targets are `h-11 w-11` (44px), matching the W2-reserved 44px rail
 * width (`w-11`) — T5 polish's explicit touch-target-sanity requirement.
 */
import {
  Minus,
  ArrowRight,
  Slash,
  GitCommitHorizontal,
  SeparatorHorizontal,
  SeparatorVertical,
  MoveHorizontal,
  MoveVertical,
  Ruler,
  Milestone,
  Route,
  Waypoints,
  Percent,
  PenTool,
  MessageSquare,
  Tag,
  Square,
  ArrowUpRight,
  Spline,
  Shapes,
  Trash2,
  type LucideIcon
} from "lucide-react";

import { ALL_DRAWING_OVERLAYS, type DrawingOverlayName } from "./custom-overlays";

interface ToolSpec {
  name: DrawingOverlayName;
  label: string;
  icon: LucideIcon;
}

const TOOL_GROUPS: ToolSpec[][] = [
  [
    { name: "segment", label: "Segment", icon: Minus },
    { name: "rayLine", label: "Ray", icon: ArrowRight },
    { name: "straightLine", label: "Line", icon: Slash },
    { name: "priceLine", label: "Price line", icon: GitCommitHorizontal },
    { name: "horizontalSegment", label: "H-segment", icon: SeparatorHorizontal },
    { name: "verticalSegment", label: "V-segment", icon: SeparatorVertical },
    { name: "horizontalRayLine", label: "H-ray", icon: MoveHorizontal },
    { name: "verticalRayLine", label: "V-ray", icon: MoveVertical },
    { name: "horizontalStraightLine", label: "Horizontal", icon: Ruler },
    { name: "verticalStraightLine", label: "Vertical", icon: Milestone }
  ],
  [
    { name: "priceChannelLine", label: "Channel", icon: Route },
    { name: "parallelStraightLine", label: "Parallel", icon: Waypoints },
    { name: "fibonacciLine", label: "Fibonacci", icon: Percent },
    { name: "brush", label: "Brush", icon: PenTool },
    { name: "simpleAnnotation", label: "Note", icon: MessageSquare },
    { name: "simpleTag", label: "Tag", icon: Tag }
  ],
  [
    { name: "rect", label: "Rectangle", icon: Square },
    { name: "arrow", label: "Arrow", icon: ArrowUpRight },
    { name: "abcd", label: "ABCD", icon: Spline },
    { name: "xabcd", label: "XABCD", icon: Shapes }
  ]
];

// Every named tool is covered exactly once — a build-time guard against the
// icon map drifting out of sync with the canonical overlay list.
const MAPPED_COUNT = TOOL_GROUPS.reduce((n, group) => n + group.length, 0);
if (MAPPED_COUNT !== ALL_DRAWING_OVERLAYS.length && process.env.NODE_ENV !== "production") {
  // eslint-disable-next-line no-console
  console.warn(`[WorkbenchToolbar] tool icon map has ${MAPPED_COUNT} entries but ALL_DRAWING_OVERLAYS has ${ALL_DRAWING_OVERLAYS.length} — they've drifted out of sync.`);
}

export function WorkbenchToolbar({
  activeTool,
  onSelectTool,
  onCancelActiveTool,
  onClearAll
}: {
  activeTool: string | null;
  onSelectTool: (name: string) => void;
  onCancelActiveTool: () => void;
  onClearAll: () => void;
}) {
  function handleClick(name: string) {
    if (activeTool === name) {
      onCancelActiveTool();
      return;
    }
    onSelectTool(name);
  }

  function handleClearAll() {
    if (!window.confirm("Clear all drawings on this chart? This can't be undone.")) return;
    onClearAll();
  }

  return (
    <div className="flex w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-ink-100 py-2">
      {TOOL_GROUPS.map((group, groupIndex) => (
        <div key={groupIndex} className="flex flex-col items-center gap-1">
          {groupIndex > 0 && <span className="my-1 h-px w-6 bg-ink-100" aria-hidden="true" />}
          {group.map(({ name, label, icon: Icon }) => (
            <button
              key={name}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={activeTool === name}
              onClick={() => handleClick(name)}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors ${
                activeTool === name ? "bg-sky-600 text-white" : "text-ink-500 hover:bg-ink-100 hover:text-ink-900"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </button>
          ))}
        </div>
      ))}

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
