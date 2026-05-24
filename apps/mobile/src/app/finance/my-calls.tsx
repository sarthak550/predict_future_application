import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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

const MY_CALLS_FILTERS_KEY = "predict_future:my-calls-filters";

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

function ResolutionBadge({
  status,
}: {
  status: "PENDING" | "RESOLVED_HIT" | "RESOLVED_MISS";
}) {
  if (status === "PENDING") {
    return (
      <View style={[styles.resBadge, { backgroundColor: "#f3f4f6" }]}>
        <Text style={[styles.resBadgeText, { color: "#6b7280" }]}>PENDING</Text>
      </View>
    );
  }
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

  const isPending = item.resolutionStatus === "PENDING";
  const dateStr = (() => {
    const iso = item.resolvedAt ?? item.publishedAt;
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  })();

  const handlePress = () => {
    if (item.storyId) {
      router.push(`/story/${item.storyId}` as Parameters<typeof router.push>[0]);
    }
  };

  return (
    <Pressable style={styles.row} onPress={handlePress} disabled={!item.storyId}>
      <View style={styles.rowTop}>
        <Text style={styles.expertName} numberOfLines={1}>
          {item.expertName || item.expertOrganization}
        </Text>
        <View style={styles.badgeRow}>
          <DirectionBadge direction={item.direction} />
          <ResolutionBadge status={item.resolutionStatus} />
        </View>
      </View>

      {item.instrument ? (
        <Text style={styles.instrument}>{item.instrument}</Text>
      ) : (
        <Text style={styles.quote} numberOfLines={2}>
          {item.quote}
        </Text>
      )}

      <View style={styles.stanceRow}>
        <Text style={[styles.stanceText, { color: outcomeColor }]}>
          {agreedLabel}
          {!isPending && item.userWasCorrect !== null
            ? item.userWasCorrect
              ? " — Correct"
              : " — Wrong"
            : isPending
              ? " — Awaiting resolution"
              : ""}
        </Text>
        <Text style={styles.resolvedDate}>
          {isPending ? `Called ${dateStr}` : dateStr}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Filter chip ───────────────────────────────────────────────────────────────

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────────

type StatusFilter = "all" | "resolved" | "pending";
type ResultFilter = "all" | "correct" | "wrong";
type TimeFilter = "all" | "week";

export default function MyCallsScreen() {
  const { data: digest, loading, error, refetch } = useApiQuery(
    () => mobileApi.getMyCallsDigest(),
    []
  );

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [filtersHydrated, setFiltersHydrated] = useState(false);

  useEffect(() => {
    void AsyncStorage.getItem(MY_CALLS_FILTERS_KEY)
      .then((raw) => {
        if (raw) {
          try {
            const saved = JSON.parse(raw) as {
              statusFilter?: StatusFilter;
              resultFilter?: ResultFilter;
              timeFilter?: TimeFilter;
            };
            if (saved.statusFilter) setStatusFilter(saved.statusFilter);
            if (saved.resultFilter) setResultFilter(saved.resultFilter);
            if (saved.timeFilter) setTimeFilter(saved.timeFilter);
          } catch (err) {
            console.warn(`[my-calls] failed to parse saved filters (${raw.slice(0, 80)}):`, err);
          }
        }
      })
      .catch((err) => {
        console.error("[my-calls] AsyncStorage.getItem failed:", err);
      })
      .finally(() => setFiltersHydrated(true));
  }, []);

  useEffect(() => {
    if (!filtersHydrated) return;
    void AsyncStorage.setItem(
      MY_CALLS_FILTERS_KEY,
      JSON.stringify({ statusFilter, resultFilter, timeFilter })
    ).catch((err) => {
      console.error("[my-calls] AsyncStorage.setItem failed:", err);
    });
  }, [statusFilter, resultFilter, timeFilter, filtersHydrated]);

  const hits = digest?.hits ?? 0;
  const misses = digest?.misses ?? 0;
  const pending = digest?.pending ?? 0;
  const total = hits + misses;
  const accuracyPct = total > 0 ? Math.round((hits / total) * 100) : null;

  const items: ApiDigestOpinion[] = useMemo(() => {
    if (!digest) return [];
    let base: ApiDigestOpinion[] = [];
    if (statusFilter === "resolved") {
      base = digest.resolvedOpinions;
    } else if (statusFilter === "pending") {
      base = digest.pendingOpinions;
    } else {
      base = [...digest.resolvedOpinions, ...digest.pendingOpinions];
    }

    if (statusFilter === "resolved" && resultFilter === "correct") {
      base = base.filter((it) => it.userWasCorrect === true);
    } else if (statusFilter === "resolved" && resultFilter === "wrong") {
      base = base.filter((it) => it.userWasCorrect === false);
    }

    if (timeFilter === "week") {
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      base = base.filter((it) => {
        const ts = new Date(it.resolvedAt ?? it.votedAt).getTime();
        return now - ts <= sevenDays;
      });
    }

    // Sort by most relevant date desc (resolvedAt for resolved, votedAt for pending)
    return [...base].sort((a, b) => {
      const aTs = new Date(a.resolvedAt ?? a.votedAt).getTime();
      const bTs = new Date(b.resolvedAt ?? b.votedAt).getTime();
      return bTs - aTs;
    });
  }, [digest, statusFilter, resultFilter, timeFilter]);

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
                  <Text style={styles.summaryLabel}>Correct</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryBlock}>
                  <Text style={[styles.summaryCount, { color: "#dc2626" }]}>{misses}</Text>
                  <Text style={styles.summaryLabel}>Wrong</Text>
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

            {/* Filter rows */}
            <View style={styles.filterSection}>
              {/* Status: All | Resolved | Pending */}
              <View style={styles.filterRow}>
                <FilterChip
                  label="All"
                  active={statusFilter === "all"}
                  onPress={() => {
                    setStatusFilter("all");
                    setResultFilter("all");
                  }}
                />
                <FilterChip
                  label="Resolved"
                  active={statusFilter === "resolved"}
                  onPress={() => setStatusFilter("resolved")}
                />
                <FilterChip
                  label="Pending"
                  active={statusFilter === "pending"}
                  onPress={() => {
                    setStatusFilter("pending");
                    setResultFilter("all");
                  }}
                />

                {/* Time: All time | This week */}
                <View style={styles.filterSpacer} />
                <Pressable
                  onPress={() => setTimeFilter(timeFilter === "all" ? "week" : "all")}
                  style={[styles.timeBtn, timeFilter === "week" && styles.timeBtnActive]}
                >
                  <Text
                    style={[styles.timeBtnText, timeFilter === "week" && styles.timeBtnTextActive]}
                  >
                    {timeFilter === "week" ? "This week ✓" : "This week"}
                  </Text>
                </Pressable>
              </View>

              {/* Sub-row: Correct | Wrong (only when Resolved is selected) */}
              {statusFilter === "resolved" && (
                <View style={styles.filterRow}>
                  <FilterChip
                    label="All"
                    active={resultFilter === "all"}
                    onPress={() => setResultFilter("all")}
                  />
                  <FilterChip
                    label="Correct"
                    active={resultFilter === "correct"}
                    onPress={() => setResultFilter("correct")}
                  />
                  <FilterChip
                    label="Wrong"
                    active={resultFilter === "wrong"}
                    onPress={() => setResultFilter("wrong")}
                  />
                </View>
              )}
            </View>

            {/* List */}
            {items.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyIcon}>📊</Text>
                <Text style={styles.emptyTitle}>
                  {statusFilter === "pending"
                    ? "No pending calls"
                    : statusFilter === "resolved"
                      ? resultFilter === "correct"
                        ? "No correct picks yet"
                        : resultFilter === "wrong"
                          ? "No wrong picks yet"
                          : "No resolved calls yet"
                      : "Nothing to show"}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {timeFilter === "week"
                    ? "Try expanding the time window."
                    : "Vote on expert opinions in the Finance tab and lock your call."}
                </Text>
              </View>
            ) : (
              <View style={styles.listContainer}>
                <Text style={styles.listHeader}>
                  {items.length} {items.length === 1 ? "call" : "calls"}
                </Text>
                {items.map((item) => (
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
  scroll: { flex: 1, backgroundColor: colors.background },
  scrollContent: { paddingBottom: spacing.xl ?? 32 },
  centred: { alignItems: "center", paddingTop: 80 },
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
  retryText: { fontSize: 14, fontWeight: "700", color: "#fff" },

  summaryCard: {
    margin: spacing.lg,
    marginBottom: spacing.sm,
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
  summaryStats: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm },
  summaryBlock: { flex: 1, alignItems: "center" },
  summaryDivider: { width: 1, height: 32, backgroundColor: "#e5e7eb" },
  summaryCount: { fontSize: 28, fontWeight: "800", lineHeight: 32 },
  summaryLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6b7280",
    marginTop: 2,
    letterSpacing: 0.5,
  },
  accuracyLine: { fontSize: 13, color: "#4b5563", marginTop: spacing.sm, marginBottom: 6 },
  accuracyPct: { fontWeight: "700", color: "#111827" },
  barTrack: {
    flexDirection: "row",
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: "#f3f4f6",
  },
  barFill: { height: 6 },

  // Filter rows
  filterSection: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.xs,
    flexWrap: "wrap",
  },
  filterSpacer: { flex: 1, minWidth: 4 },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#fff",
  },
  chipActive: { backgroundColor: "#0f172a", borderColor: "#0f172a" },
  chipText: { fontSize: 12, fontWeight: "700" as const, color: "#475569" },
  chipTextActive: { color: "#fff" },
  timeBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#f8fafc",
  },
  timeBtnActive: { backgroundColor: "#4338ca", borderColor: "#4338ca" },
  timeBtnText: { fontSize: 11, fontWeight: "700" as const, color: "#334155" },
  timeBtnTextActive: { color: "#fff" },

  // List
  listContainer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  listHeader: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6b7280",
    marginBottom: spacing.sm,
    letterSpacing: 0.3,
    textTransform: "uppercase" as const,
  },
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
  expertName: { fontSize: 13, fontWeight: "700", color: "#111827", flex: 1, marginRight: 8 },
  badgeRow: { flexDirection: "row", gap: 4 },
  dirBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  dirBadgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },
  resBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  resBadgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  instrument: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  quote: { fontSize: 12, color: "#4b5563", lineHeight: 17, marginBottom: 6 },
  stanceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  stanceText: { fontSize: 12, fontWeight: "600" },
  resolvedDate: { fontSize: 11, color: "#9ca3af" },

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
  emptyIcon: { fontSize: 36, marginBottom: spacing.sm },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  emptySubtitle: { fontSize: 13, color: "#6b7280", lineHeight: 18, textAlign: "center" },
});
