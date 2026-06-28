/**
 * BrandGradient — the single place the Indigo Futures signature gradient is drawn.
 *
 * variant "brand"   → indigo → violet → cyan (present insight → future). Cross-pillar
 *                     brand surfaces: app headers, primary CTAs, tab indicator, splash.
 * variant "pillarA" → indigo → violet (no cyan). Analyst-pillar surfaces: credibility
 *                     badges, Big Call accent bars.
 *
 * Keep gradient usage funnelled through this component so the brand stays consistent
 * and Phase-2 theming has one seam to touch.
 */

import { LinearGradient } from "expo-linear-gradient";
import { type ReactNode } from "react";
import { type StyleProp, type ViewStyle } from "react-native";

import {
  brandGradient,
  darkBrandGradient,
  darkPillarAGradient,
  pillarAGradient,
} from "@predict-future/ui-tokens";

import { useTheme } from "@/providers/theme-provider";

type BrandGradientProps = {
  variant?: "brand" | "pillarA";
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

export function BrandGradient({ variant = "brand", style, children }: BrandGradientProps) {
  const { isDark } = useTheme();

  if (variant === "pillarA") {
    const g = isDark ? darkPillarAGradient : pillarAGradient;
    return (
      <LinearGradient colors={g.stops} start={g.start} end={g.end} style={style}>
        {children}
      </LinearGradient>
    );
  }

  const g = isDark ? darkBrandGradient : brandGradient;
  return (
    <LinearGradient
      colors={g.stops}
      locations={g.locations}
      start={g.start}
      end={g.end}
      style={style}
    >
      {children}
    </LinearGradient>
  );
}
