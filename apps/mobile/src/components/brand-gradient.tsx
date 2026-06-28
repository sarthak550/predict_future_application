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

import { brandGradient, pillarAGradient } from "@predict-future/ui-tokens";

type BrandGradientProps = {
  variant?: "brand" | "pillarA";
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

export function BrandGradient({ variant = "brand", style, children }: BrandGradientProps) {
  if (variant === "pillarA") {
    return (
      <LinearGradient
        colors={pillarAGradient.stops}
        start={pillarAGradient.start}
        end={pillarAGradient.end}
        style={style}
      >
        {children}
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={brandGradient.stops}
      locations={brandGradient.locations}
      start={brandGradient.start}
      end={brandGradient.end}
      style={style}
    >
      {children}
    </LinearGradient>
  );
}
