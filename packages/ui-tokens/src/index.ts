// ─────────────────────────────────────────────────────────────────────────
// Indigo Futures design tokens — light + dark palettes.
// The signature gradient (blue → sky → cyan) encodes the product: accumulated
// insight (analysts) → the open future (markets). It is vibrant enough to read
// on BOTH light and dark backgrounds, so it is theme-independent.
// Pillar coding: Analysts = blue, Markets = emerald. Directional = green/red.
//
// `colors`/`shadows` remain the LIGHT exports (every static `import { colors }`
// keeps working). The mobile ThemeProvider swaps in `darkColors`/`darkShadows`
// at runtime via useTheme(). Light and dark share the SAME keys (ThemeColors /
// ThemeShadows) so any consumer can switch without shape drift.
// ─────────────────────────────────────────────────────────────────────────

// ── Light (default) ─────────────────────────────────────────────────────────
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
  textSubtle: "#94A3B8",

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
};

export type ThemeColors = typeof colors;

// ── Dark ────────────────────────────────────────────────────────────────────
// Same keys as `colors`; tuned for a deep navy base with brighter brand accents
// (a #2563EB accent is too dark to read on a dark surface, so dark uses #3B82F6).
export const darkColors: ThemeColors = {
  background: "#0E0F1A",
  surface: "#171826",
  surfaceElevated: "#1E2030",
  surfaceMuted: "#1A1C2E",
  surfacePillarA: "#14203A",
  surfacePillarB: "#0D1F1A",

  text: "#F1F5F9",
  textMuted: "#94A3B8",
  textSubtle: "#64748B",

  border: "#2A2D45",
  borderMuted: "#1F2238",

  primary: "#F1F5F9",
  accent: "#3B82F6",
  accentDeep: "#2563EB",
  accentSoft: "#1E2A4A",

  pillarA: "#3B82F6",
  pillarADeep: "#2563EB",
  pillarASoft: "#14203A",

  pillarB: "#10B981",
  pillarBDeep: "#059669",
  pillarBSoft: "#0D1F1A",

  gradStart: "#3B82F6",
  gradMid: "#38BDF8",
  gradEnd: "#22D3EE",

  success: "#10B981",
  successSoft: "#0D1F1A",
  warning: "#F59E0B",
  warningSoft: "#241A00",
  danger: "#FB7185",
  dangerSoft: "#2A1116",

  chip: "#1E2A4A",
};

// Signature brand gradient — present insight → future. Theme-independent (reads on
// both light and dark). Use on brand surfaces only (header, primary CTA, splash).
export const brandGradient = {
  stops: ["#2563EB", "#3B82F6", "#06B6D4"] as [string, string, string],
  locations: [0, 0.45, 1] as [number, number, number],
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 }, // 120° diagonal, top-left → bottom-right
} as const;

// Analyst-pillar gradient (blue depth, no cyan bleed) — credibility/Big Call accents.
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
  stat: 24,
  label: 11,
} as const;

// ── Elevation ────────────────────────────────────────────────────────────────
// Light shadows are blue-tinted so cards feel part of the brand world. Dark mode
// uses plain black shadows at higher opacity (tinted shadows read as haze on navy).
export const shadows = {
  sm: {
    shadowColor: "#2563EB",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  card: {
    shadowColor: "#1E40AF",
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  cardHover: {
    shadowColor: "#1E40AF",
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  modal: {
    shadowColor: "#0F172A",
    shadowOpacity: 0.18,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 20 },
    elevation: 16,
  },
};

export type ThemeShadows = typeof shadows;

export const darkShadows: ThemeShadows = {
  sm: {
    shadowColor: "#000000",
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  card: {
    shadowColor: "#000000",
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  cardHover: {
    shadowColor: "#000000",
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  modal: {
    shadowColor: "#000000",
    shadowOpacity: 0.6,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 20 },
    elevation: 16,
  },
};
