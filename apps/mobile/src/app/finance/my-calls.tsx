import { Stack, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ApiDigestOpinion } from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";

// ─── Direction badge ───────────────────────────────────────────────────────────

function DirectionBadge({ direction }: { direction: string }) {
  const cfg =
    direction === "BULLISH"
      ? { label: "BULLISH", color: "#16a34a", bg: "#dcfce7" }
      : direction === "BEARISH"
        ? { label: "BEARISH", color: "#dc2626", bg: "#fee2e2" }
        : { label: "NEUTRAL", color: "#6b7280", bg: "#f3f4f6" };

  return (
    <View style={[styles.dirBadge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.dirBadgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

// ─── Resolution badge ──────────────────────────────────────────────────────────

function ResolutionBadge({ status }: { status: "RESOLVED_HIT" | "RESOLVED_MISS" }) {
  const isHit = status === "RESOLVED_HIT";
  return (
    <View style={[styles.resBadge, { backgroundColor: isHit ? "#dcfce7" : "#fee2e2" }]}>
      <Text style={[styles.resBadgeText, { color: isHit ? "#16a34a" : "#dc2626" }]}>
        {isHit ? "HIT" : "MISS"}
      </Text>
    </View>
  );
}

// ─── Single opinion row ────────────────────────────────────────────────────────

function OpinionRow({ item }: { item: ApiDigestOpinion }) {
  const router = useRouter();

  const agreedLabel =
    item.userAgreed === true
      ? "You agreed"
      : item.userAgreed === false
        ? "You disagreed"
        : "You were neutral";

  const outcomeColor =
    item.userWasCorrect === true
      ? "#16a34a"
      : item.userWasCorrect === false
        ? "#dc2626"
        : "#6b7280";

  const resolvedDate = new Date(item.resolvedAt).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const handlePress = () => {
    if (item.storyId) {
      router.push(`/story/${item.storyId}` as Parameters<typeof router.push>[0]);
    }
  };

  return (
    <Pressable
      style={styles.row}
      onPress={handlePress}
      disabled={!item.storyId}
    >
      {/* Top row: expert + direction + resolution */}
      <View style={styles.rowTop}>
        <Text style={styles.expertName} numberOfLines={1}>
          {item.expertName || item.expertOrganization}
        </Text>
        <View style={styles.badgeRow}>
          <DirectionBadge direction={item.direction} />
          <ResolutionBadge status={item.resolutionStatus} />
        </View>
      </View>

      {/* Instrument or quote */}
      {item.instrument ? (
        <Text style={styles.instrument}>{item.instrument}</Text>
      ) : (
        <Text style={styles.quote} numberOfLines={2}>{item.quote}</Text>
      )}

      {/* User stance + correctness */}
      <View style={styles.stanceRow}>
        <Text style={[styles.stanceText, { color: outcomeColor }]}>
          {agreedLabel}
          {item.userWasCorrect !== null
            ? item.userWasCorrect
              ? " — Correct"
              : " — Incorrect"
            : ""}
        </Text>
        <Text style={styles.resolvedDate}>{resolvedDate}</Text>
      </View>
    </Pressable>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────────

export default function MyCallsScreen() {
  const { data: digest, loading, error, refetch } = useApiQuery(
    () => mobileApi.getMyCallsDigest(),
    []
  );

  const resolved = digest?.resolvedOpinions ?? [];
  const hits = digest?.hits ?? 0;
  const misses = digest?.misses ?? 0;
  const pending = digest?.pending ?? 0;
  const total = hits + misses;
  const accuracyPct = total > 0 ? Math.round((hits / total) * 100) : null;

  return (
    <>
      <Stack.Screen
        options={{
          title: "My Calls",
          headerShown: true,
          headerBackTitle: "Finance",
        }}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void refetch()}
            tintColor={colors.accent}
          />
        }
      >
        {loading && !digest ? (
          <View style={styles.centred}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : error ? (
          <View style={styles.centred}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={() => void refetch()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Summary header */}
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Your Expert Opinion Calls</Text>

              <View style={styles.summaryStats}>
                <View style={styles.summaryBlock}>
                  <Text style={[styles.summaryCount, { color: "#16a34a" }]}>{hits}</Text>
                  <Text style={styles.summaryLabel}>HIT</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryBlock}>
                  <Text style={[styles.summaryCount, { color: "#dc2626" }]}>{misses}</Text>
                  <Text style={styles.summaryLabel}>MISS</Text>
                </View>
                {pending > 0 && (
                  <>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryBlock}>
                      <Text style={[styles.summaryCount, { color: "#6b7280" }]}>{pending}</Text>
                      <Text style={styles.summaryLabel}>Pending</Text>
                    </View>
                  </>
                )}
              </View>

              {accuracyPct !== null && (
                <Text style={styles.accuracyLine}>
                  Your accuracy on resolved calls:{" "}
                  <Text style={styles.accuracyPct}>{accuracyPct}%</Text>
                </Text>
              )}

              {total > 0 && (
                <View style={styles.barTrack}>
                  <View
                    style={[styles.barFill, { flex: accuracyPct ?? 0, backgroundColor: "#16a34a" }]}
                  />
                  <View
                    style={[styles.barFill, { flex: 100 - (accuracyPct ?? 0), backgroundColor: "#dc2626" }]}
                  />
                </View>
              )}
            </View>

            {/* List of resolved opinions */}
            {resolved.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyIcon}>📊</Text>
                <Text style={styles.emptyTitle}>No resolved calls yet</Text>
                <Text style={styles.emptySubtitle}>
                  Vote on expert opinions in the Finance tab. When they resolve, your scorecard will appear here.
                </Text>
              </View>
            ) : (
              <View style={styles.listContainer}>
                <Text style={styles.listHeader}>Resolved Calls ({resolved.length})</Text>
                {resolved.map((item) => (
                  <OpinionRow key={item.opinionId} item={item} />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingBottom: spacing.xl ?? 32,
  },
  centred: {
    alignItems: "center",
    paddingTop: 80,
  },
  errorText: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: spacing.md,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
  },
  retryBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
  },
  retryText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  // Summary card
  summaryCard: {
    margin: spacing.lg,
    padding: spacing.md,
    backgroundColor: "#fff",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  summaryTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
    marginBottom: spacing.md,
  },
  summaryStats: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  summaryBlock: {
    flex: 1,
    alignItems: "center",
  },
  summaryDivider: {
    width: 1,
    height: 32,
    backgroundColor: "#e5e7eb",
  },
  summaryCount: {
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 32,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6b7280",
    marginTop: 2,
    letterSpacing: 0.5,
  },
  accuracyLine: {
    fontSize: 13,
    color: "#4b5563",
    marginTop: spacing.sm,
    marginBottom: 6,
  },
  accuracyPct: {
    fontWeight: "700",
    color: "#111827",
  },
  barTrack: {
    flexDirection: "row",
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: "#f3f4f6",
  },
  barFill: {
    height: 6,
  },
  // List
  listContainer: {
    paddingHorizontal: spacing.lg,
  },
  listHeader: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6b7280",
    marginBottom: spacing.sm,
    letterSpacing: 0.3,
  },
  // Opinion row
  row: {
    backgroundColor: "#fff",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  expertName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#111827",
    flex: 1,
    marginRight: 8,
  },
  badgeRow: {
    flexDirection: "row",
    gap: 4,
  },
  dirBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  dirBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  resBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  resBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  instrument: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 6,
  },
  quote: {
    fontSize: 12,
    color: "#4b5563",
    lineHeight: 17,
    marginBottom: 6,
  },
  stanceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  stanceText: {
    fontSize: 12,
    fontWeight: "600",
  },
  resolvedDate: {
    fontSize: 11,
    color: "#9ca3af",
  },
  // Empty state
  emptyCard: {
    margin: spacing.lg,
    padding: spacing.lg,
    backgroundColor: "#fff",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    alignItems: "center",
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 13,
    color: "#6b7280",
    lineHeight: 18,
    textAlign: "center",
  },
});
