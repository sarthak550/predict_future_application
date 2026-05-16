import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "@predict-future/ui-tokens";

import { FinanceMode } from "@/components/finance-mode";

export default function FinanceTabScreen() {
  const router = useRouter();

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View>
            <Text style={styles.title}>Finance</Text>
            <Text style={styles.subtitle}>Indian markets through a global lens</Text>
          </View>
          <Pressable
            style={styles.searchBtn}
            onPress={() => router.push("/expert-search" as Parameters<typeof router.push>[0])}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.searchBtnIcon}>🔍</Text>
            <Text style={styles.searchBtnLabel}>Experts</Text>
          </Pressable>
        </View>
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
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  title: { fontSize: 28, fontWeight: "700", color: colors.text },
  subtitle: {
    marginTop: 2,
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: "500",
  },
  searchBtn: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingTop: 4,
  },
  searchBtnIcon: { fontSize: 22 },
  searchBtnLabel: { fontSize: 10, color: colors.accent, fontWeight: "600" },
});
