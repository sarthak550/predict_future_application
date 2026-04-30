import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import type { ApiLeaderboardEntry, AppMarketCategory } from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";

const CATEGORIES: Array<{ label: string; value: AppMarketCategory | undefined }> = [
  { label: "All", value: undefined },
  { label: "Sports", value: "SPORTS" },
  { label: "Business", value: "BUSINESS" },
  { label: "Tech", value: "TECH" },
  { label: "General", value: "GENERAL" },
];

const MEDAL_COLORS: Record<number, { bg: string; text: string }> = {
  1: { bg: "#F59E0B", text: "#FFFFFF" },
  2: { bg: "#9CA3AF", text: "#FFFFFF" },
  3: { bg: "#B45309", text: "#FFFFFF" },
};

function getRankStyle(rank: number): { bg: string; text: string } {
  return MEDAL_COLORS[rank] ?? { bg: colors.surface, text: colors.textMuted as string };
}

function formatAccuracy(score: number): string {
  // If score is between 0 and 1, treat as decimal fraction; otherwise treat as percentage
  const pct = score > 0 && score <= 1 ? Math.round(score * 100) : Math.round(score);
  return `${pct}%`;
}

function getPredictionCount(entry: ApiLeaderboardEntry): number | undefined {
  return entry.totalPredictions ?? entry.stats?.totalPredictions;
}

export default function LeaderboardScreen() {
  const { session } = useSession();
  const [category, setCategory] = useState<AppMarketCategory | undefined>(undefined);
  const fetcher = useCallback(() => mobileApi.getLeaderboard({ category }), [category]);
  const { data, loading, error, refetch } = useApiQuery<{ entries: ApiLeaderboardEntry[] }>(fetcher, [category]);

  const entries = data?.entries ?? [];
  const currentUsername = session?.username;
  const isCurrentUserRanked =
    currentUsername != null && entries.some((e) => e.username === currentUsername);

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

  const listFooter =
    currentUsername != null && entries.length > 0 && !isCurrentUserRanked ? (
      <View style={styles.notRankedFooter}>
        <View style={styles.separator} />
        <Text style={styles.notRankedText}>
          You are not yet ranked in the top 25. Keep predicting to climb the board.
        </Text>
      </View>
    ) : null;

  return (
    <FlatList
      style={styles.screen}
      data={entries}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={colors.accent} />}
      ListHeaderComponent={header}
      ListFooterComponent={listFooter}
      renderItem={({ item, index }) => {
        const rank = index + 1;
        const isMe = currentUsername != null && item.username === currentUsername;
        const rankStyle = getRankStyle(rank);
        const predictions = getPredictionCount(item);

        return (
          <View style={[styles.row, isMe && styles.rowHighlight]}>
            {/* Rank medal pill */}
            <View style={[styles.rankPill, { backgroundColor: rankStyle.bg }]}>
              <Text style={[styles.rankText, { color: rankStyle.text }]}>#{rank}</Text>
            </View>

            {/* User info */}
            <View style={styles.userInfo}>
              <View style={styles.usernameRow}>
                <Text style={styles.username}>@{item.username}</Text>
                {isMe && <Text style={styles.youLabel}> (You)</Text>}
              </View>
              <View style={styles.statsRow}>
                <Text style={styles.statLabel}>Rep </Text>
                <Text style={styles.statValue}>{item.reputationScore.toLocaleString()}</Text>
                <Text style={styles.statSpacer}>  ·  </Text>
                <Text style={styles.statLabel}>Acc </Text>
                <Text style={styles.statValue}>{formatAccuracy(item.accuracyScore)}</Text>
                {predictions != null && (
                  <>
                    <Text style={styles.statSpacer}>  ·  </Text>
                    <Text style={styles.statValue}>{predictions} picks</Text>
                  </>
                )}
              </View>
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
    gap: spacing.md,
  },
  rowHighlight: {
    backgroundColor: "#EEF2FF",
  },
  rankPill: {
    minWidth: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  rankText: { fontSize: 13, fontWeight: "700" },
  userInfo: { flex: 1 },
  usernameRow: { flexDirection: "row", alignItems: "center" },
  username: { fontSize: 15, fontWeight: "600", color: colors.text },
  youLabel: { fontSize: 13, fontWeight: "600", color: colors.accent },
  statsRow: { flexDirection: "row", alignItems: "center", marginTop: 3, flexWrap: "wrap" },
  statLabel: { fontSize: 12, color: colors.textMuted },
  statValue: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  statSpacer: { fontSize: 12, color: colors.textMuted },
  notRankedFooter: { marginTop: spacing.lg, paddingHorizontal: spacing.xs },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  notRankedText: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
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
