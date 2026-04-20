export const colors = {
  background: "#F6F7FB",
  surface: "#FFFFFF",
  surfaceMuted: "#EEF2FF",
  text: "#0F172A",
  textMuted: "#475569",
  border: "#D9E2F2",
  primary: "#0F172A",
  accent: "#0EA5E9",
  success: "#0F9D75",
  warning: "#C77D12",
  danger: "#BE123C",
  chip: "#E0ECFF"
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999
} as const;

export const typography = {
  title: 28,
  heading: 22,
  body: 16,
  caption: 13
} as const;

export const shadows = {
  card: {
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: {
      width: 0,
      height: 10
    },
    elevation: 6
  }
} as const;
