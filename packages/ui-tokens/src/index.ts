// ─────────────────────────────────────────────────────────────────────────
// Indigo Futures design tokens (Phase 1 — premium light).
// Brand hue tuned to a calmer professional BLUE (blue-600) per user feedback —
// the original indigo/violet read as eye-pinching. The signature gradient now
// runs blue → sky → cyan, still encoding the product: accumulated insight
// (analysts) → the open future (markets).
// Pillar coding: Analysts = blue, Markets = emerald. Directional = green/red.
// Phase 2 will split this into light/dark theme objects behind a ThemeProvider.
// ─────────────────────────────────────────────────────────────────────────

export const colors = {
  // Base surfaces
  background: "#F4F5FB",
  surface: "#FFFFFF",
  surfaceElevated: "#FFFFFF",
  surfaceMuted: "#EFF6FF",
  surfacePillarA: "#EFF6FF", // analyst/blue zone tint
  surfacePillarB: "#ECFDF5", // market/emerald zone tint

  // Text
  text: "#0F172A",
  textMuted: "#475569",
  textSubtle: "#94A3B8", // metadata/timestamps only — not for readable labels

  // Lines
  border: "#DDE3F4",
  borderMuted: "#EEF1FA",

  // Brand
  primary: "#0F172A",
  accent: "#2563EB",
  accentDeep: "#1D4ED8",
  accentSoft: "#EFF6FF",

  // Pillar A — Analysts (blue)
  pillarA: "#2563EB",
  pillarADeep: "#1D4ED8",
  pillarASoft: "#EFF6FF",

  // Pillar B — Markets (emerald)
  pillarB: "#059669",
  pillarBDeep: "#047857",
  pillarBSoft: "#ECFDF5",

  // Signature gradient stops (also exported as `brandGradient` below)
  gradStart: "#2563EB",
  gradMid: "#3B82F6",
  gradEnd: "#06B6D4",

  // Semantic / directional
  success: "#059669",
  successSoft: "#ECFDF5",
  warning: "#D97706",
  warningSoft: "#FFFBEB",
  danger: "#E11D48",
  dangerSoft: "#FFF1F2",

  chip: "#EFF6FF",
} as const;

// Signature brand gradient — present insight → future. Use on brand surfaces only
// (header, primary CTA, tab indicator, splash). Consumed via expo-linear-gradient.
export const brandGradient = {
  stops: ["#2563EB", "#3B82F6", "#06B6D4"] as [string, string, string],
  locations: [0, 0.45, 1] as [number, number, number],
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 }, // 120° diagonal, top-left → bottom-right
} as const;

// Analyst-pillar gradient (blue depth, no cyan bleed) — credibility badges,
// Big Call accent bars, anything that should read as "analyst", not cross-pillar.
export const pillarAGradient = {
  stops: ["#2563EB", "#3B82F6"] as [string, string],
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
} as const;

export const typography = {
  title: 28,
  heading: 22,
  body: 16,
  caption: 13,
  stat: 24, // headline probability / return numbers (pair with tabular-nums)
  label: 11, // metadata / spaced-caps labels
} as const;

export const shadows = {
  // Chips, pills, inline badges.
  sm: {
    shadowColor: "#2563EB",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  // Standard cards — blue-tinted so cards feel part of the brand world.
  card: {
    shadowColor: "#1E40AF",
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  // Card press / hover.
  cardHover: {
    shadowColor: "#1E40AF",
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  // Bottom sheets, modals (neutral dark).
  modal: {
    shadowColor: "#0F172A",
    shadowOpacity: 0.18,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 20 },
    elevation: 16,
  },
} as const;
