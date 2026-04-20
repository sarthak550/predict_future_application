import { StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "@predict-future/ui-tokens";

export default function CreateScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.kicker}>Mobile create flow scaffold</Text>
      <Text style={styles.title}>Create public or private predictions</Text>
      <Text style={styles.subtitle}>
        This screen is intentionally lightweight in the first mobile pass. The richer creation flow remains strongest on
        web, while mobile now has a clean route and structure for audience, market type, resolution mode, and host
        safeguards.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Planned mobile steps</Text>
        <Text style={styles.bullet}>1. Choose public or private audience</Text>
        <Text style={styles.bullet}>2. Select yes/no or private numeric market type</Text>
        <Text style={styles.bullet}>3. Define rules, close time, resolve time, and challenge window</Text>
        <Text style={styles.bullet}>4. Set commission-based or bond-based host model when applicable</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.xl
  },
  kicker: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.accent
  },
  title: {
    marginTop: spacing.sm,
    fontSize: 30,
    fontWeight: "700",
    color: colors.text
  },
  subtitle: {
    marginTop: spacing.md,
    fontSize: 15,
    lineHeight: 24,
    color: colors.textMuted
  },
  card: {
    marginTop: spacing.xl,
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text
  },
  bullet: {
    marginTop: spacing.md,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted
  }
});
