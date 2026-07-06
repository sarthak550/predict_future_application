/**
 * TourButton — a subtle circular "?" icon that launches the spotlight tour
 * for the current screen.
 *
 * variant="light"    — white border + text (for use on GradientHeader / dark surfaces)
 * variant="default"  — theme textMuted border + text (for use on light surfaces)
 */

import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/providers/theme-provider";

type TourButtonProps = {
  onPress: () => void;
  variant?: "light" | "default";
};

export function TourButton({ onPress, variant = "default" }: TourButtonProps) {
  const { colors } = useTheme();

  const color =
    variant === "light"
      ? "rgba(255,255,255,0.70)"
      : colors.textMuted;

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Take a tour of this screen"
      style={({ pressed }) => [
        styles.btn,
        { borderColor: color, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <View style={styles.inner}>
        <Text style={[styles.label, { color }]}>?</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  inner: {
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
    // Optical centre adjustment: "?" glyphs often sit visually high
    marginTop: 1,
  },
});
