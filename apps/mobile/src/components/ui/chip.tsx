import { Pressable, StyleSheet, Text } from "react-native";

import { radius, spacing } from "@predict-future/ui-tokens";
import { useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

type Props = {
  label: string;
  active?: boolean;
  onPress?: () => void;
};

export function Chip({ label, active, onPress }: Props) {
  const styles = useThemedStyles(makeStyles);

  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.active]}
    >
      <Text style={[styles.label, active && styles.activeLabel]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  active: {
    backgroundColor: t.colors.text,
    borderColor: t.colors.text,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: t.colors.textMuted,
  },
  activeLabel: {
    color: "#FFFFFF",
  },
});
