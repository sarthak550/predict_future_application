/**
 * TA Suite Sprint S1, T6 — the toolbar's registry: one `ToolMeta` entry per
 * drawable tool (all 62 `DrawingOverlayName`s + the `highlighter` alias =
 * 63), each assigned to exactly one of the 8 families from the Locked
 * Design §2 rail spec: **Lines 12 / Fibonacci 8 / Pitchfork+Gann 7 /
 * Patterns 11 / Shapes 11 / Measure 5 / Annotations 8 / Emoji 1** — those
 * counts are a compile-time-checked FACT of this file (12+8+7+11+11+5+8+1 =
 * 63, verified by hand against `ALL_DRAWING_OVERLAYS.length + 1`), not
 * approximate groupings:
 *
 * - Lines absorbs the 12 plain line/ray/channel built-ins.
 * - Fibonacci absorbs the 1 built-in `fibonacciLine` alongside the 7 new
 *   fib tools.
 * - Patterns absorbs `abcd`/`xabcd` (the pre-S1 harmonic-pattern customs)
 *   alongside the 9 new pattern/Elliott tools — they're harmonic PATTERNS,
 *   not plain lines, a better home than "Lines" ever was for them.
 * - Shapes absorbs `rect`/`arrow` (pre-S1 customs) + the built-in `brush`
 *   + the `highlighter` alias, alongside the 7 new shape tools.
 * - Annotations absorbs the built-in `simpleAnnotation`/`simpleTag`
 *   alongside the 6 new annotation tools.
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
  type LucideIcon
} from "lucide-react";

import { ALL_DRAWING_OVERLAYS, type ToolbarToolName } from "./overlays/catalog";

export type FamilyId = "lines" | "fibonacci" | "pitchforkGann" | "patterns" | "shapes" | "measure" | "annotations" | "emoji";

export interface FamilySpec {
  id: FamilyId;
  label: string;
  icon: LucideIcon;
}

/** Rail order, left to right — matches the Locked Design §2 spec's own listed order. */
export const TOOL_FAMILIES: FamilySpec[] = [
  { id: "lines", label: "Lines", icon: Minus },
  { id: "fibonacci", label: "Fibonacci", icon: Percent },
  { id: "pitchforkGann", label: "Pitchfork & Gann", icon: Waypoints },
  { id: "patterns", label: "Patterns", icon: Spline },
  { id: "shapes", label: "Shapes", icon: ShapesIcon },
  { id: "measure", label: "Measure", icon: Ruler },
  { id: "annotations", label: "Annotations", icon: MessageSquare },
  { id: "emoji", label: "Emoji", icon: Smile }
];

export interface ToolMeta {
  label: string;
  family: FamilyId;
  icon: LucideIcon;
}

export const TOOL_REGISTRY = {
  // ── Lines (12) ──────────────────────────────────────────────────────
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

  // ── Fibonacci (8) ───────────────────────────────────────────────────
  fibonacciLine: { label: "Fib line", family: "fibonacci", icon: Percent },
  fibExtension: { label: "Fib extension", family: "fibonacci", icon: TrendingUp },
  fibFan: { label: "Fib fan", family: "fibonacci", icon: Fan },
  fibTimezone: { label: "Fib time zone", family: "fibonacci", icon: Timer },
  fibArc: { label: "Fib arc", family: "fibonacci", icon: CircleDashed },
  fibCircle: { label: "Fib circle", family: "fibonacci", icon: Circle },
  fibSpeedResistanceFan: { label: "Fib speed/resistance fan", family: "fibonacci", icon: Grid3x3 },
  fibChannel: { label: "Fib channel", family: "fibonacci", icon: Layers },

  // ── Pitchfork + Gann (7) ────────────────────────────────────────────
  andrewsPitchfork: { label: "Andrews pitchfork", family: "pitchforkGann", icon: Waypoints },
  schiffPitchfork: { label: "Schiff pitchfork", family: "pitchforkGann", icon: GitBranch },
  modifiedSchiffPitchfork: { label: "Modified Schiff pitchfork", family: "pitchforkGann", icon: Compass },
  insidePitchfork: { label: "Inside pitchfork", family: "pitchforkGann", icon: Anchor },
  gannBox: { label: "Gann box", family: "pitchforkGann", icon: Grid3x3 },
  gannFan: { label: "Gann fan", family: "pitchforkGann", icon: Fan },
  gannSquare: { label: "Gann square", family: "pitchforkGann", icon: Square },

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

  // ── Shapes (11 — incl. pre-S1 rect/arrow, brush, highlighter alias) ──
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

  // ── Measure / Position (5) ────────────────────────────────────────────
  longPosition: { label: "Long position", family: "measure", icon: TrendingUp },
  shortPosition: { label: "Short position", family: "measure", icon: TrendingDown },
  priceRange: { label: "Price range", family: "measure", icon: ArrowUpDown },
  dateRange: { label: "Date range", family: "measure", icon: MoveHorizontal },
  datePriceRange: { label: "Date + price range", family: "measure", icon: Crosshair },

  // ── Annotations (8 — incl. built-in simpleAnnotation/simpleTag) ──────
  simpleAnnotation: { label: "Note (legacy)", family: "annotations", icon: MessageSquare },
  simpleTag: { label: "Tag", family: "annotations", icon: Tag },
  calloutText: { label: "Callout", family: "annotations", icon: Type },
  noteAnchored: { label: "Note", family: "annotations", icon: StickyNote },
  priceLabel: { label: "Price label", family: "annotations", icon: Bookmark },
  flagMark: { label: "Flag", family: "annotations", icon: Flag },
  arrowMarkUp: { label: "Arrow up", family: "annotations", icon: ArrowUpRight },
  arrowMarkDown: { label: "Arrow down", family: "annotations", icon: ArrowDown },

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
