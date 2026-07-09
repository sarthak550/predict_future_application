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

import { GradientHeader } from "@/components/gradient-header";

import type {
  ApiLeaderboardEntry,
  ApiLeaderboardResponse,
  ApiLeaderboardTimeWindow,
  AppMarketCategory,
} from "@predict-future/types";
import { radius, spacing } from "@predict-future/ui-tokens";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";
import { VerifiedBadge } from "@/components/verified-badge";

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

function getRankStyle(
  rank: number,
  surfaceColor: string,
  mutedColor: string
): { bg: string; text: string } {
  return MEDAL_COLORS[rank] ?? { bg: surfaceColor, text: mutedColor };
}

function formatAccuracy(score: number): string {
  // If score is between 0 and 1, treat as decimal fraction; otherwise treat as percentage
  const pct = score > 0 && score <= 1 ? Math.round(score * 100) : Math.round(score);
  return `${pct}%`;
}

function formatFollowerCount(count: number): string {
  if (count >= 10000) return `${Math.floor(count / 1000)}K followers`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K followers`;
  return `${count} followers`;
}

function getPredictionCount(entry: ApiLeaderboardEntry): number | undefined {
  return entry.totalPredictions ?? entry.stats?.totalPredictions;
}

// S12-T1: time-window-aware subtitle
function getSubtitle(
  category: AppMarketCategory | undefined,
  timeWindow: ApiLeaderboardTimeWindow
): string {
  const windowSuffix =
    timeWindow === "week"
      ? "this week"
      : timeWindow === "month"
      ? "this month"
      : null; // "all" has its own phrasing

  if (category != null) {
    const label = category.charAt(0) + category.slice(1).toLowerCase();
    if (windowSuffix != null) {
      return `Top ${label} predictors ${windowSuffix}`;
    }
    return `Top ${label} predictors all time`;
  }

  // No category selected (All tab)
  if (timeWindow === "week") return "Top predictors this week";
  if (timeWindow === "month") return "Top predictors this month";
  return "All-time rankings";
}

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  // S12-T3: outer container — flex: 1 so fixedHeader + FlatList fill the screen
  screen: { flex: 1, backgroundColor: t.colors.background },
  // S12-T3: fixed controls section (not inside FlatList)
  fixedHeader: {
    backgroundColor: t.colors.background,
  },
  // Padded wrapper for controls below GradientHeader (which owns its own horizontal padding)
  controlsPanel: {
    paddingHorizontal: spacing.xl,
    backgroundColor: t.colors.background,
  },

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
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  timeWindowPillActive: {
    backgroundColor: t.colors.accent,
    borderColor: t.colors.accent,
  },
  timeWindowLabel: { fontSize: 13, fontWeight: "600", color: t.colors.textMuted },
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
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  tabActive: { backgroundColor: t.colors.accent, borderColor: t.colors.accent },
  tabLabel: { fontSize: 14, fontWeight: "600", color: t.colors.textMuted },
  tabLabelActive: { color: "#FFFFFF" },

  countLabel: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginBottom: spacing.sm,
  },

  // S12-T3: FlatList takes remaining space
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing["2xl"],
    gap: spacing.sm,
  },

  // Leaderboard rows
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.lg,
    backgroundColor: t.colors.surface,
    borderRadius: radius.md,
    gap: spacing.md,
  },
  rowHighlight: {
    backgroundColor: t.colors.accentSoft,
    borderWidth: 1,
    borderColor: t.colors.accent,
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

  // S12-T4: delta badge
  deltaBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  deltaBadgeUp: { backgroundColor: t.colors.successSoft },
  deltaBadgeDown: { backgroundColor: t.colors.dangerSoft },
  deltaBadgeText: { fontSize: 11, fontWeight: "700" },
  deltaBadgeTextUp: { color: t.colors.success },
  deltaBadgeTextDown: { color: t.colors.danger },

  userInfo: { flex: 1 },
  usernameRow: { flexDirection: "row", alignItems: "center" },
  username: { fontSize: 15, fontWeight: "600", color: t.colors.text },
  youLabel: { fontSize: 13, fontWeight: "600", color: t.colors.accent },
  followerLine: {
    fontSize: 11,
    color: t.colors.textMuted,
    opacity: 0.7,
    marginTop: 1,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 3,
    flexWrap: "wrap",
  },
  statLabel: { fontSize: 12, color: t.colors.textMuted },
  statValue: { fontSize: 12, color: t.colors.textMuted, fontWeight: "600" },
  statSpacer: { fontSize: 12, color: t.colors.textMuted },
  chevron: {
    fontSize: 20,
    color: t.colors.textMuted,
    lineHeight: 22,
  },

  // Your Rank sticky card (S12-T3)
  rankCard: {
    backgroundColor: t.colors.accentSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  rankCardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: t.colors.accent,
  },
  rankCardTarget: {
    fontSize: 13,
    color: t.colors.textMuted,
  },
  rankCardUnranked: {
    fontSize: 14,
    fontWeight: "600",
    color: t.colors.textMuted,
  },

  // CTA button — shared between YourRankCard and EmptyState
  ctaButton: {
    marginTop: spacing.sm,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: t.colors.accent,
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
    color: t.colors.textMuted,
    fontSize: 14,
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  errorText: { color: t.colors.danger, fontSize: 14 },
  retry: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: t.colors.accent,
  },
  retryLabel: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
});

export default function LeaderboardScreen() {
  const router = useRouter();
  const { session } = useSession();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
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

  // S12-T1: pass timeWindow to getSubtitle
  const subtitle = getSubtitle(category, timeWindow);
  const countLabel =
    entries.length > 0 ? `Showing ${entries.length} top predictors` : null;

  // S12-T3: sticky card — rendered outside FlatList
  const yourRankCard =
    currentUsername != null ? (
      <YourRankCard
        userRank={userRank}
        userContext={userContext}
        category={category}
        onMakePrediction={() => router.push("/(tabs)/feed")}
      />
    ) : null;

  // S12-T3: fixed controls above FlatList (time-window pills + category chips + Your Rank card)
  const fixedControls = (
    <>
      <GradientHeader title="Leaderboard" subtitle={subtitle} />

      <View style={styles.controlsPanel}>
        {/* Time-window selector */}
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

        {/* Sticky "Your Rank" card pinned above the list */}
        {yourRankCard}

        {countLabel != null && (
          <Text style={styles.countLabel}>{countLabel}</Text>
        )}
      </View>
    </>
  );

  if (loading && entries.length === 0) {
    return (
      <View style={styles.screen}>
        <View style={styles.fixedHeader}>{fixedControls}</View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.screen}>
        <View style={styles.fixedHeader}>{fixedControls}</View>
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
    // S12-T3: outer View wraps everything so fixedControls stay sticky
    <View style={styles.screen}>
      <View style={styles.fixedHeader}>{fixedControls}</View>

      {/* S12-T3: FlatList takes flex: 1, scrolls only the leaderboard rows */}
      <FlatList
        style={styles.list}
        data={entries}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refetch}
            tintColor={colors.accent}
          />
        }
        ListFooterComponent={<View style={{ height: spacing.xl }} />}
        renderItem={({ item, index }) => {
          const rank = index + 1;
          const isMe = currentUsername != null && item.username === currentUsername;
          const rankStyle = getRankStyle(rank, colors.surface, colors.textMuted);
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
    </View>
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
  const styles = useThemedStyles(makeStyles);
  // S12-T4: determine delta badge to render
  const delta = item.rankDelta ?? null;
  const showDelta = delta != null && delta !== 0;

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

      {/* S12-T4: delta badge — only when non-null and non-zero */}
      {showDelta && (
        <View
          style={[
            styles.deltaBadge,
            delta > 0 ? styles.deltaBadgeUp : styles.deltaBadgeDown,
          ]}
        >
          <Text
            style={[
              styles.deltaBadgeText,
              delta > 0 ? styles.deltaBadgeTextUp : styles.deltaBadgeTextDown,
            ]}
          >
            {delta > 0 ? `+${delta} ▲` : `${Math.abs(delta)} ▼`}
          </Text>
        </View>
      )}

      {/* User info */}
      <View style={styles.userInfo}>
        <View style={styles.usernameRow}>
          <Text style={styles.username}>@{item.username}</Text>
          {item.isVerifiedAnalyst && <VerifiedBadge compact />}
          {isMe && <Text style={styles.youLabel}> (You)</Text>}
        </View>
        <Text style={styles.followerLine}>{formatFollowerCount(item.followerCount ?? 0)}</Text>
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

      {/* Chevron affordance */}
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
  const styles = useThemedStyles(makeStyles);

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
  const styles = useThemedStyles(makeStyles);

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
