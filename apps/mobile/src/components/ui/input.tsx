import { StyleSheet, Text, TextInput, type TextInputProps, View } from "react-native";

import { radius, spacing } from "@predict-future/ui-tokens";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

type Props = TextInputProps & {
  label?: string;
};

export function Input({ label, style, ...props }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        style={[styles.input, style]}
        placeholderTextColor={colors.textMuted}
        {...props}
      />
    </View>
  );
}

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: t.colors.text,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: t.colors.text,
    backgroundColor: t.colors.surface,
  },
});
