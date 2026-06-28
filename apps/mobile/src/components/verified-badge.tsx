import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

/**
 * VerifiedBadge — small inline credential indicator for Verified Analysts.
 *
 * Usage: render inline next to a username wherever analyst names appear.
 * The badge renders a filled accent-colour checkmark circle with a compact
 * "Verified" label so it is recognisable at small sizes.
 *
 * The `compact` prop hides the text label and renders only the icon, for
 * tight spaces such as comment rows or secondary stat lines.
 */
export function VerifiedBadge({ compact = false }: { compact?: boolean }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={[styles.badge, compact && styles.badgeCompact]}>
      <Ionicons
        name="checkmark-circle"
        size={compact ? 13 : 14}
        color={colors.accent as string}
      />
      {!compact && (
        <Text style={styles.label}>Verified</Text>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginLeft: 4,
  },
  badgeCompact: {
    marginLeft: 3,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    color: t.colors.accent as string,
    letterSpacing: 0.2,
  },
});
