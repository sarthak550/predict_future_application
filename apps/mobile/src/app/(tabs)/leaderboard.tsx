import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";

import type {
  ApiLeaderboardEntry,
  ApiLeaderboardResponse,
  ApiLeaderboardTimeWindow,
  AppMarketCategory,
} from "@predict-future/types";
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

const TIME_WINDOWS: Array<{ label: string; value: ApiLeaderboardTimeWindow }> = [
  { label: "This Week", value: "week" },
  { label: "This Month", value: "month" },
  { label: "All Time", value: "all" },
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

function getSubtitle(category: AppMarketCategory | undefined): string {
  if (category == null) return "Ranked by reputation";
  const label = category.charAt(0) + category.slice(1).toLowerCase();
  return `Ranked by accuracy in ${label}`;
}

export default function LeaderboardScreen() {
  const router = useRouter();
  const { session } = useSession();
  const [category, setCategory] = useState<AppMarketCategory | undefined>(undefined);
  const [timeWindow, setTimeWindow] = useState<ApiLeaderboardTimeWindow>("week");

  const fetcher = useCallback(
    () => mobileApi.getLeaderboard({ category, timeWindow }),
    [category, timeWindow]
  );
  const { data, loading, error, refetch } = useApiQuery<ApiLeaderboardResponse>(
    fetcher,
    [category, timeWindow]
  );

  // Auto-refresh when the tab gains focus
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch])
  );

  const entries = data?.entries ?? [];
  const userRank = data?.userRank ?? null;
  const userContext = data?.userContext ?? null;
  const currentUsername = session?.username;
  const isCurrentUserRanked =
    currentUsername != null && entries.some((e) => e.username === currentUsername);

  const subtitle = getSubtitle(category);
  const countLabel =
    entries.length > 0 ? `Showing ${entries.length} top predictors` : null;

  // Sticky "Your Rank" card — pinned above the scrollable list (S12-T3)
  const yourRankCard =
    currentUsername != null ? (
      <YourRankCard
        userRank={userRank}
        userContext={userContext}
        category={category}
        onMakePrediction={() => router.push("/(tabs)/feed")}
      />
    ) : null;

  const header = (
    <>
      <View style={styles.header}>
        <Text style={styles.title}>Leaderboard</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      {/* Time-window selector (S12-T2) */}
      <View style={styles.timeWindowRow}>
        {TIME_WINDOWS.map((item) => (
          <Pressable
            key={item.value}
            style={[styles.timeWindowPill, timeWindow === item.value && styles.timeWindowPillActive]}
            onPress={() => setTimeWindow(item.value)}
          >
            <Text
              style={[
                styles.timeWindowLabel,
                timeWindow === item.value && styles.timeWindowLabelActive,
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Category filter chips */}
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

      {/* Sticky rank card (S12-T3) */}
      {yourRankCard}

      {countLabel != null && (
        <Text style={styles.countLabel}>{countLabel}</Text>
      )}
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

  // The old footer rank banner is replaced by the sticky YourRankCard above.
  // We keep a minimal footer spacer only.
  const listFooter = <View style={{ height: spacing.xl }} />;

  return (
    <FlatList
      style={styles.screen}
      data={entries}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={refetch}
          tintColor={colors.accent}
        />
      }
      ListHeaderComponent={header}
      ListFooterComponent={listFooter}
      renderItem={({ item, index }) => {
        const rank = index + 1;
        const isMe = currentUsername != null && item.username === currentUsername;
        const rankStyle = getRankStyle(rank);
        const predictions = getPredictionCount(item);

        return (
          <LeaderboardRow
            item={item}
            rank={rank}
            isMe={isMe}
            rankStyle={rankStyle}
            predictions={predictions}
            onPress={() => router.push(`/user/${item.username}`)}
          />
        );
      }}
      ListEmptyComponent={
        <EmptyState category={category} onMakePrediction={() => router.push("/(tabs)/feed")} />
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type LeaderboardRowProps = {
  item: ApiLeaderboardEntry;
  rank: number;
  isMe: boolean;
  rankStyle: { bg: string; text: string };
  predictions: number | undefined;
  onPress: () => void;
};

function LeaderboardRow({ item, rank, isMe, rankStyle, predictions, onPress }: LeaderboardRowProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        isMe && styles.rowHighlight,
        pressed && styles.rowPressed,
      ]}
      onPress={onPress}
    >
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

      {/* Chevron affordance (S12-T4) */}
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

type YourRankCardProps = {
  userRank: number | null;
  userContext: ApiLeaderboardResponse["userContext"];
  category: AppMarketCategory | undefined;
  onMakePrediction: () => void;
};

function YourRankCard({ userRank, userContext, category, onMakePrediction }: YourRankCardProps) {
  // Unranked — no activity in selected window
  if (userRank == null || userContext == null) {
    return (
      <View style={styles.rankCard}>
        <Text style={styles.rankCardUnranked}>You are not yet ranked.</Text>
        <Pressable style={styles.ctaButton} onPress={onMakePrediction}>
          <Text style={styles.ctaButtonLabel}>Make a prediction</Text>
        </Pressable>
      </View>
    );
  }

  const categoryLabel =
    category != null
      ? ` in ${category.charAt(0) + category.slice(1).toLowerCase()}`
      : "";

  // User is ranked #1 or in top 50 with no one above them
  if (userContext.targetUsername == null || userRank === 1) {
    return (
      <View style={styles.rankCard}>
        <Text style={styles.rankCardTitle}>
          You are #{userRank}{categoryLabel} — keep it up!
        </Text>
      </View>
    );
  }

  const gapText =
    userContext.gap != null
      ? userContext.gapUnit === "accuracy"
        ? `${Math.abs(userContext.gap).toFixed(1)}% accuracy behind`
        : `${Math.abs(userContext.gap).toLocaleString()} rep behind`
      : null;

  return (
    <View style={styles.rankCard}>
      <Text style={styles.rankCardTitle}>You are #{userRank}{categoryLabel}</Text>
      <Text style={styles.rankCardTarget}>
        @{userContext.targetUsername} is #{userContext.targetRank}
        {gapText != null ? ` — ${gapText}` : ""}
      </Text>
    </View>
  );
}

type EmptyStateProps = {
  category: AppMarketCategory | undefined;
  onMakePrediction: () => void;
};

function EmptyState({ category, onMakePrediction }: EmptyStateProps) {
  const message =
    category != null
      ? `No predictions in ${category.charAt(0) + category.slice(1).toLowerCase()} yet — be the first!`
      : "No predictions yet — be the first!";

  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>{message}</Text>
      <Pressable style={styles.ctaButton} onPress={onMakePrediction}>
        <Text style={styles.ctaButtonLabel}>Make a prediction</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { paddingTop: spacing.xl },
  title: { fontSize: 28, fontWeight: "700", color: colors.text },
  subtitle: { marginTop: spacing.xs, fontSize: 14, color: colors.textMuted },

  // Time-window selector
  timeWindowRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingTop: spacing.lg,
  },
  timeWindowPill: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  timeWindowPillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  timeWindowLabel: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
  timeWindowLabelActive: { color: "#FFFFFF" },

  // Category chips
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

  countLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },

  list: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing["2xl"],
    gap: spacing.sm,
  },

  // Leaderboard rows
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
    borderWidth: 1,
    borderColor: colors.accent,
  },
  rowPressed: { opacity: 0.7 },
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
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 3,
    flexWrap: "wrap",
  },
  statLabel: { fontSize: 12, color: colors.textMuted },
  statValue: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  statSpacer: { fontSize: 12, color: colors.textMuted },
  chevron: {
    fontSize: 20,
    color: colors.textMuted,
    lineHeight: 22,
  },

  // Your Rank sticky card (S12-T3)
  rankCard: {
    backgroundColor: "#EEF2FF",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  rankCardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.accent,
  },
  rankCardTarget: {
    fontSize: 13,
    color: colors.textMuted,
  },
  rankCardUnranked: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
  },

  // CTA button — shared between YourRankCard and EmptyState
  ctaButton: {
    marginTop: spacing.sm,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  ctaButtonLabel: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13,
  },

  // Empty state
  emptyContainer: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyText: {
    textAlign: "center",
    color: colors.textMuted,
    fontSize: 14,
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  errorText: { color: colors.danger, fontSize: 14 },
  retry: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  retryLabel: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
});
