import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import type { ApiLeaderboardEntry, AppMarketCategory } from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";

const CATEGORIES: Array<{ label: string; value: AppMarketCategory | undefined }> = [
  { label: "All", value: undefined },
  { label: "Sports", value: "SPORTS" },
  { label: "Business", value: "BUSINESS" },
  { label: "Tech", value: "TECH" },
  { label: "General", value: "GENERAL" },
];

export default function LeaderboardScreen() {
  const [category, setCategory] = useState<AppMarketCategory | undefined>(undefined);
  const fetcher = useCallback(() => mobileApi.getLeaderboard({ category }), [category]);
  const { data, loading, error, refetch } = useApiQuery<{ entries: ApiLeaderboardEntry[] }>(fetcher, [category]);

  const entries = data?.entries ?? [];

  const header = (
    <>
      <View style={styles.header}>
        <Text style={styles.title}>Leaderboard</Text>
        <Text style={styles.subtitle}>Top voters by reputation score.</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
      >
        {CATEGORIES.map((item) => (
          <Pressable
            key={item.label}
            style={[styles.tab, category === item.value && styles.tabActive]}
            onPress={() => setCategory(item.value)}
          >
            <Text style={[styles.tabLabel, category === item.value && styles.tabLabelActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </>
  );

  if (loading && entries.length === 0) {
    return (
      <View style={[styles.screen, { paddingHorizontal: spacing.xl }]}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.screen, { paddingHorizontal: spacing.xl }]}>
        {header}
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={refetch} style={styles.retry}>
            <Text style={styles.retryLabel}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      data={entries}
      keyExtractor={(_, i) => String(i)}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={colors.accent} />}
      ListHeaderComponent={header}
      renderItem={({ item, index }) => {
        const entry = item as Record<string, unknown>;
        const user = (entry.user ?? entry) as Record<string, unknown>;
        const username = String(user.username ?? "unknown");
        const rep = Number(user.reputationScore ?? 0);
        return (
          <View style={styles.row}>
            <Text style={styles.rank}>#{index + 1}</Text>
            <View style={styles.userInfo}>
              <Text style={styles.username}>@{username}</Text>
              <Text style={styles.score}>{rep.toLocaleString()} rep</Text>
            </View>
          </View>
        );
      }}
      ListEmptyComponent={<Text style={styles.empty}>No entries yet.</Text>}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { paddingTop: spacing.xl },
  title: { fontSize: 28, fontWeight: "700", color: colors.text },
  subtitle: { marginTop: spacing.xs, fontSize: 14, color: colors.textMuted },
  tabs: {
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  tab: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.text, borderColor: colors.text },
  tabLabel: { fontSize: 14, fontWeight: "600", color: colors.textMuted },
  tabLabelActive: { color: "#FFFFFF" },
  list: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing["2xl"],
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  rank: { fontSize: 16, fontWeight: "700", color: colors.accent, width: 40 },
  userInfo: { flex: 1 },
  username: { fontSize: 15, fontWeight: "600", color: colors.text },
  score: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  trust: { fontSize: 12, color: colors.success, fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  errorText: { color: colors.danger, fontSize: 14 },
  retry: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  retryLabel: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  empty: { textAlign: "center", color: colors.textMuted, paddingVertical: spacing.xl },
});
