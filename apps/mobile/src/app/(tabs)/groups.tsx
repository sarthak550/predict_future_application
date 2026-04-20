import { StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "@predict-future/ui-tokens";

export default function GroupsScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.kicker}>Groups</Text>
      <Text style={styles.title}>Private markets and invite-only play</Text>
      <Text style={styles.subtitle}>
        Group browsing is scaffolded for the shared API and auth client. Once mobile auth is connected, this tab can
        fetch private groups, member leaderboards, and host-resolved group markets without changing the navigation
        structure.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>What is already prepared</Text>
        <Text style={styles.bullet}>Shared API client with authenticated request hooks</Text>
        <Text style={styles.bullet}>Dedicated group detail endpoint in the API workspace</Text>
        <Text style={styles.bullet}>Route structure that maps cleanly to invite links and deep linking later</Text>
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
