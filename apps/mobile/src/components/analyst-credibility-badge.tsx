import { Pressable, StyleSheet, Text, View } from "react-native";

import type { AppAnalystTier } from "@predict-future/types";
import { colors } from "@predict-future/ui-tokens";

import { mobileApi } from "@/lib/api";

import { AnalystTierBadge } from "./analyst-tier-badge";

/** Identifies the surface from which the badge was tapped — sent with analytics. */
export type AnalystBadgeSurface =
  | "feed_card"
  | "opinion_card"
  | "leaderboard"
  | "profile";

export type AnalystCredibilityBadgeProps = {
  name: string;
  organization?: string;
  tier?: AppAnalystTier | null;
  /**
   * Hit rate as a fraction 0.0–1.0 (e.g. 0.87 = "87%").
   * Rendered only when resolvedCount >= 3.
   */
  hitRate?: number | null;
  /**
   * Number of resolved calls. When < 3, hitRate is suppressed regardless of
   * its value — not enough data to display a meaningful accuracy score.
   */
  resolvedCount?: number | null;
  /** "sm" = 11px for feed cards; "md" = 13px for profile surfaces. */
  size?: "sm" | "md";
  /**
   * Layout variant.
   * - "default": name on row 1, tier chip + accuracy on row 2 (stacked).
   * - "inline": all elements on a single row — `Name · TierChip · 87%`.
   *   Use for tight single-line contexts (BigCallCard footer, leaderboard rows).
   */
  layout?: "default" | "inline";
  /** When provided, wraps the badge in a Pressable tap target. */
  onPress?: () => void;
  /**
   * When provided alongside onPress, fires `analysts_badge_tapped` with this
   * surface value so analytics can attribute where taps originate.
   * Omit when onPress is absent (non-tappable badge).
   */
  analyticsSource?: AnalystBadgeSurface;
};

const SIZE_CONFIG = {
  sm: { nameFontSize: 12, orgFontSize: 11, statFontSize: 11 },
  md: { nameFontSize: 14, orgFontSize: 12, statFontSize: 13 },
} as const;

/**
 * Inline attribution string: `Name · [TierChip] · 87%`
 *
 * Composes AnalystTierBadge for the tier chip. Intended for placement next to
 * analyst names on all public-facing surfaces (feed cards, opinion cards,
 * leaderboard rows, profile headers).
 *
 * Rendering rules:
 * - Name is always rendered in bold.
 * - organization renders after a separator dot when provided.
 * - Tier chip renders when tier is non-null and not ROOKIE.
 * - Accuracy stat renders when hitRate is non-null AND resolvedCount >= 3.
 * - When onPress is provided, the entire row is a Pressable button.
 */
function AnalystCredibilityBadgeInner({
  name,
  organization,
  tier,
  hitRate,
  resolvedCount,
  size = "md",
  layout = "default",
}: Omit<AnalystCredibilityBadgeProps, "onPress">) {
  const sizeConfig = SIZE_CONFIG[size];

  // Only show accuracy when we have enough data (>= 3 resolved calls)
  const showAccuracy =
    hitRate != null && resolvedCount != null && resolvedCount >= 3;

  // Suppress tier chip for ROOKIE on public surfaces (AnalystTierBadge handles
  // its own logic, but we pass surface="public" to be explicit)
  const showTier = tier != null && tier !== "ROOKIE";

  if (layout === "inline") {
    // Single-row layout: Name · [TierChip] · 87%
    return (
      <View style={styles.inlineRow}>
        <Text
          style={[styles.name, { fontSize: sizeConfig.nameFontSize }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {name}
        </Text>
        {showTier ? (
          <>
            <Text style={[styles.separator, { fontSize: sizeConfig.orgFontSize }]}>{" · "}</Text>
            <AnalystTierBadge tier={tier} surface="public" />
          </>
        ) : null}
        {showAccuracy ? (
          <Text style={[styles.accuracy, { fontSize: sizeConfig.statFontSize }]}>
            {" · "}
            {Math.round(hitRate! * 100)}%
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Row 1: name + optional org */}
      <View style={styles.nameRow}>
        <Text
          style={[styles.name, { fontSize: sizeConfig.nameFontSize }]}
          numberOfLines={1}
        >
          {name}
        </Text>
        {organization ? (
          <Text
            style={[styles.org, { fontSize: sizeConfig.orgFontSize }]}
            numberOfLines={1}
          >
            {" · "}
            {organization}
          </Text>
        ) : null}
      </View>

      {/* Row 2: tier chip + accuracy stat (only rendered when at least one exists) */}
      {(showTier || showAccuracy) ? (
        <View style={styles.metaRow}>
          {showTier ? (
            <AnalystTierBadge tier={tier} surface="public" />
          ) : null}
          {showAccuracy ? (
            <Text
              style={[styles.accuracy, { fontSize: sizeConfig.statFontSize }]}
            >
              {showTier ? " · " : null}
              {Math.round(hitRate! * 100)}%
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Public export — wraps the inner badge in a Pressable when onPress is
 * provided, falling back to a plain View when it is not.
 *
 * When analyticsSource is provided, fires `analysts_badge_tapped` with the
 * surface value before invoking the caller's onPress. Fire-and-forget — never
 * blocks the caller's handler.
 */
export function AnalystCredibilityBadge({
  onPress,
  analyticsSource,
  ...rest
}: AnalystCredibilityBadgeProps): JSX.Element {
  if (onPress) {
    const handlePress = () => {
      if (analyticsSource) {
        void mobileApi.track("analysts_badge_tapped", { surface: analyticsSource }).catch(() => {});
      }
      onPress();
    };

    return (
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
      >
        <AnalystCredibilityBadgeInner {...rest} />
      </Pressable>
    );
  }

  return <AnalystCredibilityBadgeInner {...rest} />;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "column",
    alignItems: "flex-start",
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
    flexShrink: 1,
  },
  name: {
    fontWeight: "700",
    color: colors.text,
    flexShrink: 1,
  },
  separator: {
    color: colors.textMuted,
    fontWeight: "400",
  },
  org: {
    color: colors.textMuted,
    fontWeight: "400",
    flexShrink: 1,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  accuracy: {
    color: colors.success,
    fontWeight: "600",
  },
});
