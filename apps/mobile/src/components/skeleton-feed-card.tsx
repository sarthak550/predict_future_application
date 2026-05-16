import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { colors, radius, shadows, spacing } from "@predict-future/ui-tokens";

type Props = {
  viewportHeight: number;
};

/**
 * SkeletonFeedCard — card-shaped shimmer placeholder matching the approximate
 * layout of a NewsFeedCard. Shown on initial feed load (when list is empty)
 * to communicate spatial structure before content arrives.
 *
 * Layout mirrors NewsFeedCard:
 *   - Tall grey rect  → hero image / placeholder area
 *   - Category pill   → category badge
 *   - Two text bars   → headline + kicker
 *   - Meta row bar    → source / read-more row
 *   - Poll panel bar  → market block at bottom
 */
export function SkeletonFeedCard({ viewportHeight }: Props) {
  // Shimmer: translucent white sweep left-to-right on a 1.2s loop
  const shimmerX = useRef(new Animated.Value(-1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(shimmerX, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [shimmerX]);

  // shimmerX goes -1 → 1; translate across card width (~card width px)
  // We use a percentage-based approach via interpolation on a known container
  // width. Since we don't know exact width, we use a wide fixed translation
  // that always sweeps past the card edge.
  const shimmerTranslate = shimmerX.interpolate({
    inputRange: [-1, 1],
    outputRange: [-420, 420],
  });

  return (
    <View style={[styles.frame, { height: viewportHeight }]}>
      <View style={styles.card}>
        {/* Hero image placeholder */}
        <View style={styles.heroRect} />

        <View style={styles.body}>
          {/* Category badge */}
          <View style={styles.categoryPill} />

          {/* Headline bar (wider) */}
          <View style={[styles.textBar, styles.headlineBar]} />

          {/* Kicker bar (narrower) */}
          <View style={[styles.textBar, styles.kickerBar]} />

          {/* Meta row */}
          <View style={styles.metaRowBar} />

          {/* Spacer to push poll panel down */}
          <View style={{ flex: 1 }} />

          {/* Poll panel block */}
          <View style={styles.pollPanel}>
            <View style={styles.pollTitleBar} />
            <View style={styles.pollProgressBar} />
            <View style={styles.pollButtonRow}>
              <View style={[styles.pollButton, { marginRight: spacing.sm }]} />
              <View style={styles.pollButton} />
            </View>
          </View>
        </View>

        {/* Shimmer overlay */}
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            styles.shimmerOverlay,
            { transform: [{ translateX: shimmerTranslate }] },
          ]}
          pointerEvents="none"
        />
      </View>
    </View>
  );
}

const PLACEHOLDER = colors.border;      // grey rect color
const SURFACE    = colors.surface;      // card background

const styles = StyleSheet.create({
  frame: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  card: {
    flex: 1,
    backgroundColor: SURFACE,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...shadows.card,
  },

  // Hero image area (mirrors heroImage height=220 in NewsFeedCard)
  heroRect: {
    width: "100%",
    height: 220,
    backgroundColor: PLACEHOLDER,
    opacity: 0.6,
  },

  body: {
    flex: 1,
    padding: spacing.xl,
    justifyContent: "flex-start",
  },

  // Category pill (small rounded chip)
  categoryPill: {
    width: 70,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: PLACEHOLDER,
    opacity: 0.5,
  },

  // Headline + kicker bars
  textBar: {
    marginTop: spacing.md,
    height: 16,
    borderRadius: radius.sm ?? 4,
    backgroundColor: PLACEHOLDER,
    opacity: 0.5,
  },
  headlineBar: {
    width: "90%",
  },
  kickerBar: {
    width: "65%",
    height: 14,
    opacity: 0.4,
  },

  // Meta row (source / read-more)
  metaRowBar: {
    marginTop: spacing.lg,
    width: "50%",
    height: 12,
    borderRadius: radius.sm ?? 4,
    backgroundColor: PLACEHOLDER,
    opacity: 0.35,
  },

  // Poll panel (mirrors marketBlock)
  pollPanel: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pollTitleBar: {
    width: "80%",
    height: 14,
    borderRadius: radius.sm ?? 4,
    backgroundColor: PLACEHOLDER,
    opacity: 0.5,
  },
  pollProgressBar: {
    marginTop: spacing.md,
    width: "100%",
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: PLACEHOLDER,
    opacity: 0.4,
  },
  pollButtonRow: {
    marginTop: spacing.md,
    flexDirection: "row",
  },
  pollButton: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: PLACEHOLDER,
    opacity: 0.3,
  },

  // Shimmer sweep — a semi-transparent gradient-like bar tilted slightly
  shimmerOverlay: {
    width: 120,
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    // Skew slightly to simulate a sweep angle
    transform: [{ skewX: "-20deg" }],
  },
});
