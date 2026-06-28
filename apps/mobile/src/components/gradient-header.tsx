/**
 * GradientHeader — the shared brand header for top-level tab screens.
 *
 * One component so every tab reads as the same product (not just Finance), and so
 * the safe-area inset is handled in exactly one place:
 *   • iOS    — the root SafeAreaView does NOT inset the top, so the header pads
 *              `insets.top` itself → the gradient bleeds full-width under the notch.
 *   • Android — the root SafeAreaView already insets the top, so the header must
 *              NOT add it again (that double-padding was the "blank space" bug);
 *              a small `spacing.xs` is all that's needed below the status-bar strip.
 *
 * Pass a `title`, an optional `subtitle`, and an optional `right` node (search pill,
 * icon buttons). Keep it to a single compact row so it never wastes vertical space.
 */

import { type ReactNode } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { spacing } from "@predict-future/ui-tokens";

import { BrandGradient } from "@/components/brand-gradient";

type GradientHeaderProps = {
  title: string;
  subtitle?: string;
  right?: ReactNode;
};

export function GradientHeader({ title, subtitle, right }: GradientHeaderProps) {
  const insets = useSafeAreaInsets();
  // Android already cleared the status bar at the root; iOS clears the notch here.
  const paddingTop = Platform.OS === "android" ? spacing.xs : insets.top;

  return (
    <BrandGradient variant="brand" style={[styles.wrap, { paddingTop }]}>
      <View style={styles.row}>
        <View style={styles.titleCol}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </BrandGradient>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.xs,
    gap: spacing.md,
  },
  titleCol: {
    // Title takes priority and never shrinks — a too-wide `right` slot (e.g. a
    // search pill) shrinks instead of truncating the tab title.
    flexShrink: 0,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: "500",
    color: "rgba(255,255,255,0.85)",
    marginTop: 2,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexShrink: 1,
    justifyContent: "flex-end",
  },
});
