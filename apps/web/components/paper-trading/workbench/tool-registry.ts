/**
 * TA Suite Sprint S1, T6 — the toolbar's registry: one `ToolMeta` entry per
 * drawable tool, each assigned to exactly one family from the Locked
 * Design §2 rail spec.
 *
 * **Founder-feedback pass (2026-08-03)** added 25 more tools (62 → 87 real
 * `DrawingOverlayName`s; 88 toolbar entries incl. the `highlighter` alias)
 * across the original 8 families plus one NEW family, **Cycles**:
 * **Lines 18 / Fibonacci 13 / Pitchfork+Gann 8 / Patterns 11 / Shapes 14 /
 * Cycles 3 / Measure 7 / Annotations 13 / Emoji 1** — sums to 88, verified
 * by hand against `ALL_DRAWING_OVERLAYS.length + 1`, same discipline as the
 * original S1 family-count identity check:
 *
 * - Lines: +6 (`infoLine`/`trendAngle`/`crossLine`/`regressionTrend`/
 *   `flatTopBottom`/`disjointChannel` — the brief's "Channels" group folded
 *   into Lines rather than spun out as its own family, since it's only 3
 *   tools and Lines was already the natural home for channel-shaped tools).
 * - Fibonacci: +5 (`trendBasedFibTime`/`fibSpiral`/
 *   `fibSpeedResistanceArcs`/`fibWedge`/`pitchfan`).
 * - Pitchfork+Gann: +1 (`gannSquareFixed`).
 * - Shapes: +3 (`arrowMarker`/`circleShape`/`pathLine`).
 * - Cycles (NEW): +3 (`cyclicLines`/`timeCycles`/`sineLine`) — the brief's
 *   own explicit "new family Cycles, rail icon" instruction, unlike
 *   Forecasting/Volume below which it left as either-or.
 * - Measure: +2 (`sector` — the brief's "Forecasting" tool, folded into
 *   Measure rather than a 9th family for one tool; `anchoredVWAP` — the
 *   brief's own explicit "Volume ... new entry in the Measure family").
 * - Annotations: +5 (`textLabel`/`priceNote`/`pin`/`commentBubble`/
 *   `signpost`).
 *
 * **Deviation flagged**: the brief's own prose enumerates 25 distinct tool
 * names (hand-recounted twice) but its header says "24 MISSING TOOLS" —
 * the same kind of internally-inconsistent round-number-vs-enumeration gap
 * this program hit before (Charting Workbench W1's "Overlay enum is 20
 * values not 21"). Went with the enumeration (25) as the source of truth,
 * same call made then.
 *
 * `TOOL_REGISTRY … satisfies Record<ToolbarToolName, ToolMeta>` is the
 * compile-time toolbar-coverage guard (D6-adjacent, extends the pre-S1
 * `workbench-toolbar.tsx`'s runtime `MAPPED_COUNT` drift-check, now
 * deleted as superseded — a `satisfies` clause makes a MISSING entry a
 * build error, strictly stronger than a `console.warn`).
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
  MessageSquare,
  Tag,
  Square,
  ArrowUpRight,
  Spline,
  Shapes as ShapesIcon,
  TrendingUp,
  TrendingDown,
  GitBranch,
  Triangle,
  Circle,
  Flag,
  Smile,
  Star,
  Type,
  StickyNote,
  Move,
  RectangleHorizontal,
  Waves,
  Activity,
  Crosshair,
  LineChart,
  BarChart3,
  Layers,
  Grid3x3,
  Compass,
  Anchor,
  Bookmark,
  Highlighter as HighlighterIcon,
  Brush,
  Fan,
  Timer,
  CircleDashed,
  ArrowUpDown,
  ArrowDown,
  Info,
  MoveDiagonal,
  Sigma,
  Rows3,
  Columns3,
  PieChart,
  Text,
  Speech,
  MapPin,
  MessageCircle,
  Signpost,
  ArrowBigRight,
  CircleDot,
  Repeat,
  RadioTower,
  Wind,
  ScanLine,
  Radar,
  GitCompareArrows,
  Orbit,
  type LucideIcon
} from "lucide-react";

import { ALL_DRAWING_OVERLAYS, type ToolbarToolName } from "./overlays/catalog";

export type FamilyId = "lines" | "fibonacci" | "pitchforkGann" | "patterns" | "shapes" | "cycles" | "measure" | "annotations" | "emoji";

export interface FamilySpec {
  id: FamilyId;
  label: string;
  icon: LucideIcon;
}

/** Rail order, left to right — matches the Locked Design §2 spec's own listed order. `cycles` (2026-08-03 founder-feedback pass) inserted after `shapes`, grouping it with the other geometry-drawing families rather than tacking it on at the end. */
export const TOOL_FAMILIES: FamilySpec[] = [
  { id: "lines", label: "Lines", icon: Minus },
  { id: "fibonacci", label: "Fibonacci", icon: Percent },
  { id: "pitchforkGann", label: "Pitchfork & Gann", icon: Waypoints },
  { id: "patterns", label: "Patterns", icon: Spline },
  { id: "shapes", label: "Shapes", icon: ShapesIcon },
  { id: "cycles", label: "Cycles", icon: Orbit },
  { id: "measure", label: "Measure", icon: Ruler },
  { id: "annotations", label: "Annotations", icon: MessageSquare },
  { id: "emoji", label: "Emoji", icon: Smile }
];

export interface ToolMeta {
  label: string;
  family: FamilyId;
  icon: LucideIcon;
  /** True for tools that need real traded volume — disabled (greyed, non-selectable, tooltip explains why) while the workbench is charting option-premium pseudo-candles. Currently only `anchoredVWAP`, mirroring `indicator-registry.ts`'s identically-named field on `VWAP` itself. */
  premiumDisabled?: boolean;
}

export const TOOL_REGISTRY = {
  // ── Lines (18 — 12 pre-existing + 6 from the 2026-08-03 pass) ───────
  segment: { label: "Segment", family: "lines", icon: Minus },
  rayLine: { label: "Ray", family: "lines", icon: ArrowRight },
  straightLine: { label: "Line", family: "lines", icon: Slash },
  priceLine: { label: "Price line", family: "lines", icon: GitCommitHorizontal },
  horizontalSegment: { label: "H-segment", family: "lines", icon: SeparatorHorizontal },
  verticalSegment: { label: "V-segment", family: "lines", icon: SeparatorVertical },
  horizontalRayLine: { label: "H-ray", family: "lines", icon: MoveHorizontal },
  verticalRayLine: { label: "V-ray", family: "lines", icon: MoveVertical },
  horizontalStraightLine: { label: "Horizontal", family: "lines", icon: Ruler },
  verticalStraightLine: { label: "Vertical", family: "lines", icon: Milestone },
  priceChannelLine: { label: "Channel", family: "lines", icon: Route },
  parallelStraightLine: { label: "Parallel", family: "lines", icon: Waypoints },
  infoLine: { label: "Info line", family: "lines", icon: Info },
  trendAngle: { label: "Trend angle", family: "lines", icon: MoveDiagonal },
  crossLine: { label: "Cross line", family: "lines", icon: Crosshair },
  regressionTrend: { label: "Regression trend", family: "lines", icon: Sigma },
  flatTopBottom: { label: "Flat top/bottom", family: "lines", icon: Rows3 },
  disjointChannel: { label: "Disjoint channel", family: "lines", icon: Columns3 },

  // ── Fibonacci (13 — 8 pre-existing + 5 from the 2026-08-03 pass) ────
  fibonacciLine: { label: "Fib line", family: "fibonacci", icon: Percent },
  fibExtension: { label: "Fib extension", family: "fibonacci", icon: TrendingUp },
  fibFan: { label: "Fib fan", family: "fibonacci", icon: Fan },
  fibTimezone: { label: "Fib time zone", family: "fibonacci", icon: Timer },
  fibArc: { label: "Fib arc", family: "fibonacci", icon: CircleDashed },
  fibCircle: { label: "Fib circle", family: "fibonacci", icon: Circle },
  fibSpeedResistanceFan: { label: "Fib speed/resistance fan", family: "fibonacci", icon: Grid3x3 },
  fibChannel: { label: "Fib channel", family: "fibonacci", icon: Layers },
  trendBasedFibTime: { label: "Trend-based fib time", family: "fibonacci", icon: ScanLine },
  fibSpiral: { label: "Fib spiral", family: "fibonacci", icon: Radar },
  fibSpeedResistanceArcs: { label: "Fib speed/resistance arcs", family: "fibonacci", icon: CircleDashed },
  fibWedge: { label: "Fib wedge", family: "fibonacci", icon: GitCompareArrows },
  pitchfan: { label: "Pitchfan", family: "fibonacci", icon: Fan },

  // ── Pitchfork + Gann (8 — 7 pre-existing + 1 from the 2026-08-03 pass) ─
  andrewsPitchfork: { label: "Andrews pitchfork", family: "pitchforkGann", icon: Waypoints },
  schiffPitchfork: { label: "Schiff pitchfork", family: "pitchforkGann", icon: GitBranch },
  modifiedSchiffPitchfork: { label: "Modified Schiff pitchfork", family: "pitchforkGann", icon: Compass },
  insidePitchfork: { label: "Inside pitchfork", family: "pitchforkGann", icon: Anchor },
  gannBox: { label: "Gann box", family: "pitchforkGann", icon: Grid3x3 },
  gannFan: { label: "Gann fan", family: "pitchforkGann", icon: Fan },
  gannSquare: { label: "Gann square", family: "pitchforkGann", icon: Square },
  gannSquareFixed: { label: "Gann square (fixed)", family: "pitchforkGann", icon: Grid3x3 },

  // ── Patterns (11 — incl. the pre-S1 abcd/xabcd harmonics) ────────────
  abcd: { label: "ABCD", family: "patterns", icon: Spline },
  xabcd: { label: "XABCD", family: "patterns", icon: ShapesIcon },
  cypher: { label: "Cypher", family: "patterns", icon: Activity },
  threeDrives: { label: "Three Drives", family: "patterns", icon: LineChart },
  headAndShoulders: { label: "Head & Shoulders", family: "patterns", icon: BarChart3 },
  trianglePattern: { label: "Triangle pattern", family: "patterns", icon: Triangle },
  elliottImpulse: { label: "Elliott impulse (0-5)", family: "patterns", icon: Waves },
  elliottCorrection: { label: "Elliott correction (0ABC)", family: "patterns", icon: Waves },
  elliottTriangle: { label: "Elliott triangle (0ABCDE)", family: "patterns", icon: Waves },
  elliottDoubleCombo: { label: "Elliott double combo (0WXY)", family: "patterns", icon: Waves },
  elliottTripleCombo: { label: "Elliott triple combo (0WXYXZ)", family: "patterns", icon: Waves },

  // ── Shapes (14 — 11 pre-existing + 3 from the 2026-08-03 pass) ──────
  rect: { label: "Rectangle", family: "shapes", icon: Square },
  arrow: { label: "Arrow", family: "shapes", icon: ArrowUpRight },
  brush: { label: "Brush", family: "shapes", icon: Brush },
  highlighter: { label: "Highlighter", family: "shapes", icon: HighlighterIcon },
  ellipse: { label: "Ellipse", family: "shapes", icon: Circle },
  rotatedRect: { label: "Rotated rectangle", family: "shapes", icon: RectangleHorizontal },
  triangleShape: { label: "Triangle", family: "shapes", icon: Triangle },
  arcShape: { label: "Arc", family: "shapes", icon: CircleDashed },
  curve: { label: "Curve", family: "shapes", icon: Spline },
  doubleCurve: { label: "Double curve", family: "shapes", icon: Spline },
  polyline: { label: "Polyline", family: "shapes", icon: Move },
  arrowMarker: { label: "Arrow marker", family: "shapes", icon: ArrowBigRight },
  circleShape: { label: "Circle", family: "shapes", icon: CircleDot },
  pathLine: { label: "Path", family: "shapes", icon: Route },

  // ── Cycles (3 — new family, 2026-08-03 pass) ────────────────────────
  cyclicLines: { label: "Cyclic lines", family: "cycles", icon: Repeat },
  timeCycles: { label: "Time cycles", family: "cycles", icon: RadioTower },
  sineLine: { label: "Sine line", family: "cycles", icon: Wind },

  // ── Measure / Position (7 — 5 pre-existing + 2 from the 2026-08-03 pass) ─
  longPosition: { label: "Long position", family: "measure", icon: TrendingUp },
  shortPosition: { label: "Short position", family: "measure", icon: TrendingDown },
  priceRange: { label: "Price range", family: "measure", icon: ArrowUpDown },
  dateRange: { label: "Date range", family: "measure", icon: MoveHorizontal },
  datePriceRange: { label: "Date + price range", family: "measure", icon: Crosshair },
  sector: { label: "Sector (forecast)", family: "measure", icon: PieChart },
  anchoredVWAP: { label: "Anchored VWAP", family: "measure", icon: Anchor, premiumDisabled: true },

  // ── Annotations (13 — 8 pre-existing + 5 from the 2026-08-03 pass) ──
  simpleAnnotation: { label: "Note (legacy)", family: "annotations", icon: MessageSquare },
  simpleTag: { label: "Tag", family: "annotations", icon: Tag },
  calloutText: { label: "Callout", family: "annotations", icon: Type },
  noteAnchored: { label: "Note", family: "annotations", icon: StickyNote },
  priceLabel: { label: "Price label", family: "annotations", icon: Bookmark },
  flagMark: { label: "Flag", family: "annotations", icon: Flag },
  arrowMarkUp: { label: "Arrow up", family: "annotations", icon: ArrowUpRight },
  arrowMarkDown: { label: "Arrow down", family: "annotations", icon: ArrowDown },
  textLabel: { label: "Text label", family: "annotations", icon: Text },
  priceNote: { label: "Price note", family: "annotations", icon: Speech },
  pin: { label: "Pin", family: "annotations", icon: MapPin },
  commentBubble: { label: "Comment", family: "annotations", icon: MessageCircle },
  signpost: { label: "Signpost", family: "annotations", icon: Signpost },

  // ── Emoji (1) ─────────────────────────────────────────────────────────
  emojiSticker: { label: "Emoji sticker", family: "emoji", icon: Star }
} satisfies Record<ToolbarToolName, ToolMeta>;

export type ToolRegistryName = keyof typeof TOOL_REGISTRY;

/** Runtime defense-in-depth belt-and-suspenders (kept alongside the `satisfies` clause per the file's own doc — cheap, already established codebase posture). */
const REGISTRY_KEYS = Object.keys(TOOL_REGISTRY);
if (REGISTRY_KEYS.length !== ALL_DRAWING_OVERLAYS.length + 1 && process.env.NODE_ENV !== "production") {
  // eslint-disable-next-line no-console
  console.warn(`[tool-registry] TOOL_REGISTRY has ${REGISTRY_KEYS.length} entries but ALL_DRAWING_OVERLAYS+highlighter expects ${ALL_DRAWING_OVERLAYS.length + 1} — they've drifted out of sync.`);
}

export function toolsInFamily(family: FamilyId): Array<{ name: ToolRegistryName; meta: ToolMeta }> {
  return (Object.entries(TOOL_REGISTRY) as Array<[ToolRegistryName, ToolMeta]>)
    .filter(([, meta]) => meta.family === family)
    .map(([name, meta]) => ({ name, meta }));
}
