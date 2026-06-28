import { StyleSheet, View, type ViewStyle } from "react-native";

import { radius, spacing } from "@predict-future/ui-tokens";
import { useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

type Props = {
  children: React.ReactNode;
  elevated?: boolean;
  style?: ViewStyle;
};

export function Card({ children, elevated, style }: Props) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={[styles.card, elevated && styles.elevated, style]}>
      {children}
    </View>
  );
}

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  elevated: {
    borderWidth: 0,
    ...t.shadows.card,
  },
});
