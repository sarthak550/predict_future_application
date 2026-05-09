import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ApiCategoryTopEntry, ApiCategoryTopResponse, AppMarketCategory } from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";

// ── Rank badge ────────────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  const isTop3 = rank <= 3;
  const bg = rank === 1 ? "#FDE68A" : rank === 2 ? "#E2E8F0" : rank === 3 ? "#FED7AA" : colors.border as string;
  const color = rank === 1 ? "#92400E" : rank === 2 ? "#475569" : rank === 3 ? "#9A3412" : colors.textMuted as string;

  return (
    <View style={[styles.rankBadge, { backgroundColor: bg }]}>
      <Text style={[styles.rankText, { color }]}>
        {isTop3 ? (rank === 1 ? "1st" : rank === 2 ? "2nd" : "3rd") : `#${rank}`}
      </Text>
    </View>
  );
}

function formatFollowerCount(count: number): string {
  if (count >= 10000) return `${Math.floor(count / 1000)}K followers`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K followers`;
  return `${count} followers`;
}

// ── List row ──────────────────────────────────────────────────────────────────

function EntryRow({ entry }: { entry: ApiCategoryTopEntry }) {
  return (
    <View style={styles.row}>
      <RankBadge rank={entry.rank} />
      <View style={styles.rowMain}>
        <Text style={styles.username}>@{entry.username}</Text>
        <Text style={styles.followerLine}>{formatFollowerCount(entry.followerCount ?? 0)}</Text>
        <Text style={styles.predictions}>{entry.totalPredictions} predictions</Text>
      </View>
      <Text style={styles.accuracy}>{entry.accuracyScore.toFixed(0)}%</Text>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function CategoryLeaderboardScreen() {
  const { category } = useLocalSearchParams<{ category: string }>();

  const fetcher = useCallback(
    () =>
      mobileApi.getCategoryTop({
        category: category as AppMarketCategory,
        limit: 10,
      }),
    [category]
  );
  const { data, loading, error, refetch } = useApiQuery<ApiCategoryTopResponse>(
    fetcher,
    [category]
  );

  const title = category ? `Top in ${category}` : "Category Leaderboard";

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title,
          headerBackTitle: "Back",
          headerStyle: { backgroundColor: colors.background as string },
          headerTintColor: colors.text as string,
          headerShadowVisible: false,
        }}
      />

      {loading && !data ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>Failed to load leaderboard.</Text>
          <Pressable style={styles.retryBtn} onPress={() => void refetch()}>
            <Text style={styles.retryLabel}>Retry</Text>
          </Pressable>
        </View>
      ) : !data || data.entries.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No analysts yet</Text>
          <Text style={styles.emptyBody}>
            No one has made predictions in this category yet. Be the first!
          </Text>
        </View>
      ) : (
        <FlatList
          data={data.entries}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <Text style={styles.subtitle}>
              Ranked by accuracy — top 10 analysts in {data.category}
            </Text>
          }
          renderItem={({ item }) => <EntryRow entry={item} />}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => void refetch()}
              tintColor={colors.accent as string}
            />
          }
          ItemSeparatorComponent={() => (
            <View style={styles.separator} />
          )}
        />
      )}
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background as string },
  listContent: {
    padding: spacing.lg,
    paddingBottom: spacing["2xl"],
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: colors.background as string,
  },

  subtitle: {
    fontSize: 13,
    color: colors.textMuted as string,
    marginBottom: spacing.md,
    lineHeight: 18,
  },

  // Row
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface as string,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  rowMain: { flex: 1 },
  username: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text as string,
  },
  followerLine: {
    fontSize: 11,
    color: colors.textMuted as string,
    opacity: 0.7,
    marginTop: 1,
  },
  predictions: {
    fontSize: 12,
    color: colors.textMuted as string,
    marginTop: 2,
  },
  accuracy: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.accent as string,
  },

  // Rank badge
  rankBadge: {
    width: 44,
    height: 28,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  rankText: {
    fontSize: 12,
    fontWeight: "700",
  },

  separator: {
    height: spacing.sm,
  },

  // Error / empty
  errorText: {
    fontSize: 15,
    color: colors.textMuted as string,
    textAlign: "center",
  },
  retryBtn: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accent as string,
  },
  retryLabel: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text as string,
    textAlign: "center",
  },
  emptyBody: {
    fontSize: 14,
    color: colors.textMuted as string,
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 20,
  },
});
