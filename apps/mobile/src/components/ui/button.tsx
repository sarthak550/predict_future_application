import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from "react-native";

import { colors, radius, spacing } from "@predict-future/ui-tokens";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
type Size = "sm" | "md" | "lg";

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
};

const variantStyles: Record<Variant, { bg: string; text: string; border?: string }> = {
  primary: { bg: colors.text, text: colors.surface },
  secondary: { bg: "transparent", text: colors.text, border: colors.border },
  ghost: { bg: "transparent", text: colors.textMuted },
  danger: { bg: "transparent", text: colors.danger, border: colors.danger },
  accent: { bg: colors.accent, text: colors.surface },
};

const sizeStyles: Record<Size, { paddingH: number; paddingV: number; fontSize: number }> = {
  sm: { paddingH: spacing.md, paddingV: spacing.xs + 2, fontSize: 13 },
  md: { paddingH: spacing.xl, paddingV: spacing.md, fontSize: 15 },
  lg: { paddingH: spacing["2xl"], paddingV: spacing.lg, fontSize: 16 },
};

export function Button({ label, onPress, variant = "primary", size = "md", loading, disabled, style }: Props) {
  const v = variantStyles[variant];
  const s = sizeStyles[size];

  return (
    <Pressable
      onPress={onPress}
      disabled={loading || disabled}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: v.bg,
          paddingHorizontal: s.paddingH,
          paddingVertical: s.paddingV,
          borderWidth: v.border ? 1 : 0,
          borderColor: v.border,
          opacity: pressed || loading || disabled ? 0.7 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.text} />
      ) : (
        <Text style={[styles.label, { color: v.text, fontSize: s.fontSize }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    flexDirection: "row",
  },
  label: {
    fontWeight: "700",
  },
});
