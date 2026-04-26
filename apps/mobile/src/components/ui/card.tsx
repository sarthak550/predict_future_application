import { StyleSheet, View, type ViewStyle } from "react-native";

import { colors, radius, shadows, spacing } from "@predict-future/ui-tokens";

type Props = {
  children: React.ReactNode;
  elevated?: boolean;
  style?: ViewStyle;
};

export function Card({ children, elevated, style }: Props) {
  return (
    <View style={[styles.card, elevated && styles.elevated, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.7)",
  },
  elevated: {
    borderWidth: 0,
    ...shadows.card,
  },
});
