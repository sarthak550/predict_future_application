/**
 * GradientButton — the single primary commit CTA in the app.
 *
 * Background is the brand gradient (indigo → violet → cyan). Use ONLY for the
 * highest-intent commit action on a given screen (e.g. "Place Bet", "Confirm").
 * Do NOT convert secondary buttons, chips, or every accent button.
 */

import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

import { radius, spacing } from "@predict-future/ui-tokens";

import { BrandGradient } from "@/components/brand-gradient";

type GradientButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function GradientButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  style,
}: GradientButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.pressable, (disabled || loading) && styles.disabled, style]}
    >
      <BrandGradient variant="brand" style={styles.gradient}>
        {loading ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.label}>{label}</Text>
        )}
      </BrandGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    borderRadius: radius.md,
    overflow: "hidden",
  },
  gradient: {
    paddingVertical: 16,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  label: {
    fontSize: 16,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: 0.2,
  },
  disabled: {
    opacity: 0.5,
  },
});
