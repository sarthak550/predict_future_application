import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "@predict-future/ui-tokens";

import { FinanceMode } from "@/components/finance-mode";

export default function FinanceTabScreen() {
  const router = useRouter();

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Finance</Text>
        <Text style={styles.subtitle}>Indian markets through a global lens</Text>
      </View>
      <FinanceMode
        onNavigateToFeed={() =>
          router.push({
            pathname: "/(tabs)/feed",
            params: { category: "FINANCE" },
          } as Parameters<typeof router.push>[0])
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  title: { fontSize: 28, fontWeight: "700", color: colors.text },
  subtitle: {
    marginTop: 2,
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: "500",
  },
});
