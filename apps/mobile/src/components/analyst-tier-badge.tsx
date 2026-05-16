import { StyleSheet, Text, View } from "react-native";

import type { AppAnalystTier } from "@predict-future/types";

export type { AppAnalystTier };

type AnalystTierBadgeProps = {
  tier: AppAnalystTier | undefined | null;
  /**
   * Surface type controls minimum tier threshold for rendering:
   * - "public"   — ANALYST and above only (ROOKIE is suppressed)
   * - "comment"  — SENIOR_ANALYST and above only
   * - "profile"  — always render (including ROOKIE)
   */
  surface?: "public" | "comment" | "profile";
};

const TIER_CONFIG: Record<
  Exclude<AppAnalystTier, "ROOKIE">,
  { label: string; backgroundColor: string; color: string }
> = {
  ANALYST: {
    label: "Analyst",
    backgroundColor: "#DBEAFE",
    color: "#1D4ED8",
  },
  SENIOR_ANALYST: {
    label: "Sr. Analyst",
    backgroundColor: "#FEF3C7",
    color: "#B45309",
  },
  CHIEF_ANALYST: {
    label: "Chief Analyst",
    backgroundColor: "#EDE9FE",
    color: "#6D28D9",
  },
};

/**
 * Renders a compact colored text chip representing the analyst's tier.
 *
 * ROOKIE is always suppressed on public surfaces.
 * ANALYST and above are shown on "public" surfaces (leaderboard, market detail).
 * SENIOR_ANALYST and above are shown on "comment" surfaces.
 * All tiers (including ROOKIE) are shown on "profile" surface.
 */
export function AnalystTierBadge({
  tier,
  surface = "public",
}: AnalystTierBadgeProps): JSX.Element | null {
  if (!tier) return null;

  // Apply surface-based suppression
  if (tier === "ROOKIE") {
    // ROOKIE is only shown on the profile surface where the user views their own profile
    if (surface !== "profile") return null;
    return (
      <View style={[styles.chip, styles.chipRookie]}>
        <Text style={[styles.label, styles.labelRookie]}>Rookie</Text>
      </View>
    );
  }

  if (surface === "comment" && tier === "ANALYST") {
    return null;
  }

  const config = TIER_CONFIG[tier];
  if (!config) return null;

  return (
    <View style={[styles.chip, { backgroundColor: config.backgroundColor }]}>
      {tier === "CHIEF_ANALYST" && (
        <Text style={[styles.star, { color: config.color }]}>&#9733; </Text>
      )}
      <Text style={[styles.label, { color: config.color }]}>{config.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: "flex-start",
  },
  chipRookie: {
    backgroundColor: "#F3F4F6",
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  labelRookie: {
    color: "#6B7280",
  },
  star: {
    fontSize: 10,
    lineHeight: 14,
  },
});
