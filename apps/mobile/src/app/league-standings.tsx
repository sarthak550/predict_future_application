/**
 * Full standings screen for a given league tier and month.
 *
 * Route params:
 *   tier  — AppLeagueTier string (e.g. "GOLD")
 *   month — 'YYYY-MM' string
 *
 * Features:
 * - Cursor-paginated FlatList of all tier members ordered by netPointsMonth DESC.
 * - Current user's row highlighted.
 * - Tappable rows navigate to /user/<username>.
 * - Pull-to-refresh resets to first page.
 */

import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ApiLeagueTierStandingEntry, AppLeagueTier } from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { TIER_COLORS } from "@/app/leagues";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMonth(month: string): string {
  const [year, m] = month.split("-");
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const idx = parseInt(m!, 10) - 1;
  return `${months[idx] ?? m} ${year}`;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function LeagueStandingsScreen() {
  const router = useRouter();
  const { tier: tierParam, month: monthParam } = useLocalSearchParams<{
    tier: string;
    month: string;
  }>();

  const tier = tierParam as AppLeagueTier;
  const month = monthParam ?? "";

  const { session } = useSession();
  const username = session?.username ?? null;

  const [entries, setEntries] = useState<ApiLeagueTierStandingEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadingMoreRef = useRef(false);

  // ── Initial / refresh load ──

  const loadInitial = useCallback(async () => {
    if (!tier || !month) return;
    try {
      const page = await mobileApi.getLeagueStandings({ tier, month });
      setEntries(page.entries);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load standings.");
    }
  }, [tier, month]);

  useEffect(() => {
    setLoadingInitial(true);
    void loadInitial().finally(() => setLoadingInitial(false));
  }, [loadInitial]);

  // ── Pull-to-refresh ──

  async function handleRefresh() {
    setRefreshing(true);
    await loadInitial();
    setRefreshing(false);
  }

  // ── Pagination ──

  async function handleLoadMore() {
    if (!nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await mobileApi.getLeagueStandings({ tier, month, cursor: nextCursor });
      setEntries((prev) => [...prev, ...page.entries]);
      setNextCursor(page.nextCursor);
    } catch {
      // Silently ignore pagination errors; user can pull-to-refresh.
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }

  // ── Row renderer ──

  function renderRow({ item }: { item: ApiLeagueTierStandingEntry }) {
    const isMe = item.username === username;
    return (
      <Pressable
        style={({ pressed }) => [
          styles.row,
          isMe && styles.rowMe,
          pressed && { opacity: 0.75 },
        ]}
        onPress={() => router.push(`/user/${item.username}`)}
      >
        <View style={styles.rankBadge}>
          <Text style={[styles.rankText, isMe && styles.rankTextMe]}>
            {item.rank ?? "-"}
          </Text>
        </View>
        <Text style={[styles.usernameText, isMe && styles.usernameTextMe]} numberOfLines={1}>
          {item.username}
          {isMe ? " (you)" : ""}
        </Text>
        <Text style={[styles.pointsText, isMe && styles.pointsTextMe]}>
          {item.netPointsMonth >= 0 ? "+" : ""}
          {item.netPointsMonth.toLocaleString()} pts
        </Text>
      </Pressable>
    );
  }

  // ── Footer ──

  function renderFooter() {
    if (loadingMore) {
      return (
        <View style={styles.footerRow}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      );
    }
    if (!nextCursor && entries.length > 0) {
      return <Text style={styles.endText}>All standings loaded</Text>;
    }
    return null;
  }

  // ── Loading state ──

  if (loadingInitial) {
    return (
      <View style={styles.screen}>
        <Stack.Screen
          options={{
            title: tier ? `${tier} — ${formatMonth(month)}` : "Standings",
            headerShown: true,
          }}
        />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </View>
    );
  }

  // ── Error state ──

  if (error) {
    return (
      <View style={styles.screen}>
        <Stack.Screen
          options={{
            title: tier ? `${tier} — ${formatMonth(month)}` : "Standings",
            headerShown: true,
          }}
        />
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            style={styles.retryBtn}
            onPress={() => {
              setLoadingInitial(true);
              void loadInitial().finally(() => setLoadingInitial(false));
            }}
          >
            <Text style={styles.retryLabel}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const tierColor = tier ? TIER_COLORS[tier] : colors.accent;

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: tier ? `${tier} — ${formatMonth(month)}` : "Standings",
          headerShown: true,
        }}
      />
      <FlatList
        data={entries}
        keyExtractor={(item) => item.userId}
        renderItem={renderRow}
        ListHeaderComponent={
          <View style={[styles.headerBand, { backgroundColor: tierColor }]}>
            <Text style={styles.headerTierText}>{tier} League</Text>
            <Text style={styles.headerMonthText}>{formatMonth(month)}</Text>
          </View>
        }
        ListFooterComponent={renderFooter}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  listContent: { paddingBottom: 40 },

  errorText: { fontSize: 14, color: colors.danger, textAlign: "center" },
  retryBtn: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  retryLabel: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },

  // ── Header band ──
  headerBand: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.xs,
  },
  headerTierText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },
  headerMonthText: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255,255,255,0.8)",
    marginTop: 2,
  },

  // ── Rows ──
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  rowMe: {
    backgroundColor: colors.accent + "18",
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rankText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
  },
  rankTextMe: {
    color: colors.accent,
  },
  usernameText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  usernameTextMe: {
    color: colors.accent,
  },
  pointsText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
  },
  pointsTextMe: {
    color: colors.accent,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginHorizontal: spacing.lg,
  },

  // ── Footer ──
  footerRow: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  endText: {
    textAlign: "center",
    paddingVertical: spacing.lg,
    fontSize: 12,
    color: colors.textMuted,
  },
});
