import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "@predict-future/ui-tokens";

import { FinanceMode } from "@/components/finance-mode";

export default function FinanceTabScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ clusterId?: string }>();
  const initialClusterId = typeof params.clusterId === "string" ? params.clusterId : null;

  const goToNews = () =>
    router.push({
      pathname: "/(tabs)/feed",
      params: { category: "FINANCE" },
    } as Parameters<typeof router.push>[0]);

  return (
    <View style={styles.screen}>
      {/* M5: Header pairs the title with an inline search-styled affordance that
          opens the expert search screen (which autofocuses its input). */}
      <View style={styles.toolbar}>
        <Text style={styles.title}>Finance</Text>
        <View style={styles.actions}>
          <Pressable
            onPress={() => router.push("/expert-search" as Parameters<typeof router.push>[0])}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.searchBox}
          >
            <Text style={styles.searchIcon}>🔍</Text>
            <Text style={styles.searchPlaceholder}>Search experts…</Text>
          </Pressable>
          <Pressable
            onPress={goToNews}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.actionBtn}
          >
            <Text style={styles.actionIcon}>📰</Text>
          </Pressable>
        </View>
      </View>
      <FinanceMode
        initialClusterId={initialClusterId}
        onNavigateToFeed={goToNews}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.3,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flex: 1,
    justifyContent: "flex-end",
    marginLeft: spacing.md,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    flex: 1,
    maxWidth: 220,
  },
  searchIcon: { fontSize: 13, color: "#64748b" },
  searchPlaceholder: { fontSize: 13, fontWeight: "500", color: "#64748b", flex: 1 },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  actionIcon: { fontSize: 13 },
});
