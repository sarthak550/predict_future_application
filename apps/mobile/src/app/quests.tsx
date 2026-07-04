import { Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { useCallback } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ApiDailyQuestEntry, ApiDailyQuests } from "@predict-future/types";
import { radius, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

// ── Quest type display labels ─────────────────────────────────────────────────

const QUEST_LABELS: Record<string, string> = {
  PREDICT_3: "Make 3 Predictions",
  PREDICT_5: "Make 5 Predictions",
  VOTE_ON_POLL: "Vote on a Poll",
  CREATE_MARKET: "Create a Market",
};

function getQuestLabel(questType: string): string {
  return QUEST_LABELS[questType] ?? questType;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: t.colors.background,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  scrollContent: {
    padding: spacing.xl,
    gap: spacing.md,
    paddingBottom: spacing.xl * 2,
  },

  // Summary banner
  summaryCard: {
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  dateHeader: {
    fontSize: 12,
    color: t.colors.textMuted,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  summaryText: {
    flex: 1,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: t.colors.text,
  },
  summarySubtitle: {
    fontSize: 13,
    color: t.colors.textMuted,
    marginTop: 2,
  },
  // Intentional green earned badge — directional status color, keep static
  earnedBadge: {
    backgroundColor: "#ECFDF5",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  earnedBadgeText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#059669",
  },
  // Intentional orange streak banner — status color, keep static
  streakBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFF7ED",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    alignSelf: "flex-start",
  },
  streakBannerText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#EA580C",
  },

  // Quest list
  questList: {
    gap: spacing.md,
  },
  questCard: {
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  questCardDone: {
    borderWidth: 1,
    borderColor: "#22C55E22",
  },
  questCardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  questLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: t.colors.text,
    lineHeight: 20,
  },
  // Intentional blue reward pill — brand hue, keep static
  rewardPill: {
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  rewardPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1D4ED8",
  },

  // Progress bar
  progressTrack: {
    height: 6,
    backgroundColor: t.colors.border,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
  },

  questCardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressLabel: {
    fontSize: 12,
    color: t.colors.textMuted,
  },
  rewardEarned: {
    fontSize: 12,
    fontWeight: "600",
    color: "#059669",
  },

  // Empty / error states
  emptyState: {
    alignItems: "center",
    paddingVertical: spacing.xl * 2,
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: 15,
    color: t.colors.textMuted,
    textAlign: "center",
  },
  emptyHint: {
    fontSize: 13,
    color: t.colors.textMuted,
    textAlign: "center",
  },
  errorText: {
    fontSize: 14,
    color: t.colors.danger,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  retryBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: t.colors.accent,
    borderRadius: radius.md,
  },
  retryLabel: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 14,
  },
});

// ── QuestCard ─────────────────────────────────────────────────────────────────

function QuestCard({ quest }: { quest: ApiDailyQuestEntry }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const progressPercent =
    quest.goal > 0 ? Math.min(1, quest.progress / quest.goal) : 0;

  return (
    <View style={[styles.questCard, quest.completed && styles.questCardDone]}>
      <View style={styles.questCardHeader}>
        <Text style={styles.questLabel} numberOfLines={2}>
          {quest.description || getQuestLabel(quest.questType)}
        </Text>
        {quest.completed ? (
          <Ionicons name="checkmark-circle" size={22} color="#22C55E" />
        ) : (
          <View style={styles.rewardPill}>
            <Text style={styles.rewardPillText}>+{quest.reward} pts</Text>
          </View>
        )}
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${Math.round(progressPercent * 100)}%` as `${number}%`,
              backgroundColor: quest.completed ? "#22C55E" : colors.accent,
            },
          ]}
        />
      </View>

      <View style={styles.questCardFooter}>
        <Text style={styles.progressLabel}>
          {quest.completed
            ? "Completed"
            : `${quest.progress} / ${quest.goal}`}
        </Text>
        {quest.completed && (
          <Text style={styles.rewardEarned}>+{quest.reward} pts earned</Text>
        )}
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function QuestsScreen() {
  const { status: authStatus, session } = useSession();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const enabled = authStatus === "authenticated" && Boolean(session?.userId);

  const fetcher = useCallback(() => mobileApi.getQuestsToday(), []);
  const { data, loading, error, refetch } = useApiQuery<ApiDailyQuests>(
    fetcher,
    [session?.userId],
    { enabled, errorFallback: "Unable to load quests." }
  );

  // Pull-to-refresh callback
  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  // ── Unauthenticated ──
  if (!enabled) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Stack.Screen options={{ headerShown: true, title: "Daily Quests" }} />
        <Text style={styles.emptyText}>Sign in to see your daily quests.</Text>
      </View>
    );
  }

  // ── Loading ──
  if (loading && !data) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Stack.Screen options={{ headerShown: true, title: "Daily Quests" }} />
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  // ── Error ──
  if (error && !data) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Stack.Screen options={{ headerShown: true, title: "Daily Quests" }} />
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={handleRefresh} style={styles.retryBtn}>
          <Text style={styles.retryLabel}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const quests = data?.quests ?? [];
  const totalEarnedToday = data?.totalEarnedToday ?? 0;
  const completedCount = quests.filter((q) => q.completed).length;
  const streak = data?.streak ?? 0;

  // Format date string 'YYYY-MM-DD' to human-readable e.g. "Tue, May 6"
  const formattedDate = data?.date
    ? new Date(data.date + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : "";

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: true, title: "Daily Quests" }} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
      >
        {/* ── Summary banner ── */}
        <View style={styles.summaryCard}>
          {formattedDate ? (
            <Text style={styles.dateHeader}>{formattedDate}</Text>
          ) : null}
          <View style={styles.summaryRow}>
            <Ionicons name="flame" size={28} color="#F97316" />
            <View style={styles.summaryText}>
              <Text style={styles.summaryTitle}>Today's Quests</Text>
              <Text style={styles.summarySubtitle}>
                {completedCount} of {quests.length} completed
              </Text>
            </View>
            <View style={styles.earnedBadge}>
              <Text style={styles.earnedBadgeText}>
                +{totalEarnedToday} pts
              </Text>
            </View>
          </View>
          {streak > 0 ? (
            <View style={styles.streakBanner}>
              <Ionicons name="flame" size={16} color="#F97316" />
              <Text style={styles.streakBannerText}>
                {streak} day streak
              </Text>
            </View>
          ) : null}
        </View>

        {/* ── Quest cards ── */}
        {quests.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="clipboard-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No quests available today.</Text>
            <Text style={styles.emptyHint}>Pull down to refresh.</Text>
          </View>
        ) : (
          <View style={styles.questList}>
            {quests.map((quest) => (
              <QuestCard key={quest.questType} quest={quest} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
