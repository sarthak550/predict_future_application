import { Stack, useLocalSearchParams, useRouter } from "expo-router";
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

import type { ApiCalibrationCategoryBreakdown, ApiUserCalibration, AppMarketCategory } from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";

// ── Category colour helpers ───────────────────────────────────────────────────

const CATEGORY_ACCENT: Record<string, string> = {
  GENERAL: "#6366F1",
  SPORTS: "#EF4444",
  BUSINESS: "#10B981",
  TECH: "#3B82F6",
  WEATHER: "#0EA5E9",
  ENTERTAINMENT: "#F59E0B",
  PRODUCT: "#8B5CF6",
  COMPANY: "#14B8A6",
  FINANCE: "#22C55E",
};

function categoryColor(cat: string): string {
  return CATEGORY_ACCENT[cat] ?? "#64748B";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function OverallHeader({ calibration }: { calibration: ApiUserCalibration }) {
  const { overallAccuracy, totalPredictions, totalWins, bestStreak } = calibration;

  return (
    <View style={styles.overallCard}>
      <Text style={styles.overallPct}>{overallAccuracy.toFixed(0)}%</Text>
      <Text style={styles.overallLabel}>Overall Accuracy</Text>
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{totalPredictions}</Text>
          <Text style={styles.statLabel}>Predictions</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{totalWins}</Text>
          <Text style={styles.statLabel}>Wins</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{bestStreak}</Text>
          <Text style={styles.statLabel}>Best Streak</Text>
        </View>
      </View>
    </View>
  );
}

function CategoryBar({ entry }: { entry: ApiCalibrationCategoryBreakdown }) {
  const pct = Math.min(100, Math.max(0, entry.accuracyScore));
  const accent = categoryColor(entry.category);

  return (
    <View style={styles.catRow}>
      <Text style={styles.catLabel} numberOfLines={1}>
        {entry.category}
      </Text>
      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width: `${pct}%` as `${number}%`, backgroundColor: accent },
          ]}
        />
      </View>
      <Text style={[styles.catPct, { color: accent }]}>
        {pct.toFixed(0)}%
      </Text>
    </View>
  );
}

function CategoryLinks({
  breakdown,
  router,
}: {
  breakdown: ApiCalibrationCategoryBreakdown[];
  router: ReturnType<typeof useRouter>;
}) {
  // Only show links for categories where the user has >= 5 predictions.
  const qualified = breakdown.filter((b) => b.totalPredictions >= 5);
  if (qualified.length === 0) return null;

  return (
    <View style={styles.linksCard}>
      <Text style={styles.sectionTitle}>Top Analysts by Category</Text>
      {qualified.map((b) => (
        <Pressable
          key={b.category}
          style={({ pressed }) => [
            styles.linkRow,
            pressed && styles.linkRowPressed,
          ]}
          onPress={() =>
            router.push(
              `/leaderboard/category/${b.category}` as Parameters<typeof router.push>[0]
            )
          }
        >
          <Text style={styles.linkText}>
            See top predictors in {b.category}
          </Text>
          <Text style={styles.linkChevron}>›</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function CalibrationScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();

  const fetcher = useCallback(
    () => mobileApi.getUserCalibration(userId),
    [userId]
  );
  const { data, loading, error, refetch } = useApiQuery<ApiUserCalibration>(
    fetcher,
    [userId]
  );

  const isEmpty =
    data !== null &&
    data.totalPredictions === 0 &&
    data.categoryBreakdown.length === 0;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Calibration Scorecard",
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
          <Text style={styles.errorText}>Failed to load calibration data.</Text>
          <Pressable style={styles.retryBtn} onPress={() => void refetch()}>
            <Text style={styles.retryLabel}>Retry</Text>
          </Pressable>
        </View>
      ) : isEmpty || !data ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Not enough predictions yet</Text>
          <Text style={styles.emptyBody}>
            Make at least one prediction to see your calibration scorecard.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.screen}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => void refetch()}
              tintColor={colors.accent as string}
            />
          }
        >
          <OverallHeader calibration={data} />

          {/* Category bar chart */}
          {data.categoryBreakdown.length > 0 && (
            <View style={styles.barsCard}>
              <Text style={styles.sectionTitle}>Accuracy by Category</Text>
              {data.categoryBreakdown.map((entry) => (
                <CategoryBar key={entry.category} entry={entry} />
              ))}
            </View>
          )}

          {/* Tappable links to category leaderboards */}
          <CategoryLinks
            breakdown={data.categoryBreakdown}
            router={router}
          />
        </ScrollView>
      )}
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background as string },
  scrollContent: {
    padding: spacing.xl,
    paddingBottom: spacing["2xl"],
    gap: spacing.lg,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: colors.background as string,
  },

  // Overall accuracy header
  overallCard: {
    backgroundColor: colors.surface as string,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
  },
  overallPct: {
    fontSize: 56,
    fontWeight: "800",
    color: colors.accent as string,
    lineHeight: 64,
  },
  overallLabel: {
    fontSize: 13,
    color: colors.textMuted as string,
    fontWeight: "600",
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
  },
  statItem: { flex: 1, alignItems: "center" },
  statValue: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text as string,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textMuted as string,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.border as string,
  },

  // Category bar chart card
  barsCard: {
    backgroundColor: colors.surface as string,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text as string,
    marginBottom: spacing.xs,
  },
  catRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  catLabel: {
    width: 80,
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted as string,
  },
  barTrack: {
    flex: 1,
    height: 8,
    backgroundColor: colors.border as string,
    borderRadius: 4,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 4,
  },
  catPct: {
    width: 38,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
  },

  // Category leaderboard links
  linksCard: {
    backgroundColor: colors.surface as string,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border as string,
  },
  linkRowPressed: { opacity: 0.6 },
  linkText: {
    fontSize: 14,
    color: colors.accent as string,
    fontWeight: "500",
    flex: 1,
  },
  linkChevron: {
    fontSize: 18,
    color: colors.textMuted as string,
    marginLeft: spacing.sm,
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
