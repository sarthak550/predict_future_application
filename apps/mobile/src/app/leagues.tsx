import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
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

import type {
  ApiLeagueEntry,
  ApiLeagueTierStandingEntry,
  AppLeagueTier,
} from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";

// ── Tier display config ───────────────────────────────────────────────────────

export const TIER_COLORS: Record<AppLeagueTier, string> = {
  BRONZE:   "#CD7F32",
  SILVER:   "#A8A9AD",
  GOLD:     "#FFD700",
  PLATINUM: "#E5E4E2",
  DIAMOND:  "#B9F2FF",
};

/** Returns the color appropriate for text rendered on a tier-colored background. */
function tierTextColor(tier: AppLeagueTier): string {
  // Lighter tiers (SILVER, PLATINUM, DIAMOND) need dark text.
  if (tier === "SILVER" || tier === "PLATINUM" || tier === "DIAMOND") return "#1A1A2E";
  // BRONZE and GOLD use white text.
  return "#FFFFFF";
}

// Approximate tier entry threshold. For display purposes we use the
// percentile within the fetched standings page (not the global pool).
const PROMOTION_PCT = 0.20;  // top 20% promote
const RELEGATION_PCT = 0.80; // bottom 20% relegate

// ── Zone classification ───────────────────────────────────────────────────────

type Zone = "promotion" | "safe" | "relegation";

function getZone(rank: number | null, totalInTier: number): Zone {
  if (rank == null || totalInTier === 0) return "safe";
  const pct = rank / totalInTier;
  if (pct <= PROMOTION_PCT) return "promotion";
  if (pct >= RELEGATION_PCT) return "relegation";
  return "safe";
}

function zoneLabel(zone: Zone): string {
  if (zone === "promotion") return "Top 20% — on track to promote";
  if (zone === "relegation") return "Bottom 20% — at risk of relegation";
  return "Stable";
}

function zoneColor(zone: Zone): string {
  if (zone === "promotion") return "#22C55E";
  if (zone === "relegation") return "#EF4444";
  return colors.textMuted;
}

// ── Month label ───────────────────────────────────────────────────────────────

function formatMonth(month: string): string {
  // month is 'YYYY-MM'
  const [year, m] = month.split("-");
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const idx = parseInt(m, 10) - 1;
  return `${months[idx] ?? m} ${year}`;
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function LeaguesScreen() {
  const router = useRouter();
  const { session, status: sessionStatus } = useSession();
  const userId = session?.userId ?? null;
  const username = session?.username ?? null;

  // ── Data state ──
  const [leagueEntry, setLeagueEntry] = useState<ApiLeagueEntry | null>(null);
  const [standings, setStandings] = useState<ApiLeagueTierStandingEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prevent concurrent pagination calls
  const loadingMoreRef = useRef(false);

  // ── Fetch league entry + initial standings page ──

  const loadInitial = useCallback(async () => {
    if (!userId) return;
    try {
      const entry = await mobileApi.getMyCurrentLeague();
      setLeagueEntry(entry);

      const page = await mobileApi.getLeagueStandings({
        tier: entry.tier,
        month: entry.month,
      });
      setStandings(page.entries);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load league data.");
    }
  }, [userId]);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    setLoadingInitial(true);
    void loadInitial().finally(() => setLoadingInitial(false));
  }, [loadInitial, sessionStatus]);

  // ── Pull-to-refresh ──

  async function handleRefresh() {
    setRefreshing(true);
    await loadInitial();
    setRefreshing(false);
  }

  // ── Pagination: load more when approaching list end ──

  async function handleLoadMore() {
    if (!leagueEntry || !nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await mobileApi.getLeagueStandings({
        tier: leagueEntry.tier,
        month: leagueEntry.month,
        cursor: nextCursor,
      });
      setStandings((prev) => [...prev, ...page.entries]);
      setNextCursor(page.nextCursor);
    } catch {
      // Silently ignore pagination errors — user can pull-to-refresh.
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }

  // ── Unauthenticated ──

  if (sessionStatus !== "authenticated" || !userId) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: "Leagues", headerShown: true }} />
        <View style={styles.center}>
          <Text style={styles.errorText}>Sign in to view your league standing.</Text>
        </View>
      </View>
    );
  }

  // ── Loading ──

  if (loadingInitial) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: "Leagues", headerShown: true }} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </View>
    );
  }

  // ── Error ──

  if (error || !leagueEntry) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: "Leagues", headerShown: true }} />
        <View style={styles.center}>
          <Text style={styles.errorText}>{error ?? "No league data found."}</Text>
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

  // ── Derived display values ──

  const tierColor = TIER_COLORS[leagueEntry.tier];
  const textOnTier = tierTextColor(leagueEntry.tier);
  const totalInTier = standings.length; // best estimate from loaded data
  const zone = getZone(leagueEntry.rank, totalInTier);
  const rankPct =
    leagueEntry.rank != null && totalInTier > 0
      ? Math.min(1, leagueEntry.rank / totalInTier)
      : 0.5;

  // ── Standings list item renderer ──

  function renderStandingRow({ item }: { item: ApiLeagueTierStandingEntry }) {
    const isMe = item.username === username;
    return (
      <Pressable
        style={({ pressed }) => [
          styles.standingRow,
          isMe && styles.standingRowMe,
          pressed && { opacity: 0.75 },
        ]}
        onPress={() => router.push(`/user/${item.username}`)}
      >
        <View style={styles.rankBadge}>
          <Text style={[styles.rankBadgeText, isMe && styles.rankBadgeTextMe]}>
            {item.rank ?? "-"}
          </Text>
        </View>
        <Text
          style={[styles.standingUsername, isMe && styles.standingUsernameMe]}
          numberOfLines={1}
        >
          {item.username}
          {isMe ? " (you)" : ""}
        </Text>
        <Text style={[styles.standingPoints, isMe && styles.standingPointsMe]}>
          {item.netPointsMonth >= 0 ? "+" : ""}
          {item.netPointsMonth.toLocaleString()} pts
        </Text>
      </Pressable>
    );
  }

  function renderListHeader() {
    return (
      <>
        {/* ── Tier hero card ── */}
        <View style={[styles.heroCard, { backgroundColor: tierColor }]}>
          <Text style={[styles.heroTier, { color: textOnTier }]}>
            {leagueEntry!.tier}
          </Text>
          <Text style={[styles.heroMonth, { color: textOnTier, opacity: 0.8 }]}>
            {formatMonth(leagueEntry!.month)}
          </Text>

          {/* Rank info */}
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={[styles.heroStatValue, { color: textOnTier }]}>
                {leagueEntry!.rank != null ? `#${leagueEntry!.rank}` : "—"}
              </Text>
              <Text style={[styles.heroStatLabel, { color: textOnTier, opacity: 0.75 }]}>
                Your Rank
              </Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <Text style={[styles.heroStatValue, { color: textOnTier }]}>
                {leagueEntry!.netPointsMonth >= 0 ? "+" : ""}
                {leagueEntry!.netPointsMonth.toLocaleString()}
              </Text>
              <Text style={[styles.heroStatLabel, { color: textOnTier, opacity: 0.75 }]}>
                Points this month
              </Text>
            </View>
          </View>
        </View>

        {/* ── Zone bar card ── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your Position</Text>

          {/* Zone label */}
          <View style={[styles.zoneLabelRow]}>
            <View style={[styles.zoneDot, { backgroundColor: zoneColor(zone) }]} />
            <Text style={[styles.zoneLabel, { color: zoneColor(zone) }]}>
              {zoneLabel(zone)}
            </Text>
          </View>

          {/* Horizontal zone bar */}
          <View style={styles.zoneBarOuter}>
            {/* Promotion zone (left, green) */}
            <View style={[styles.zoneBarSegment, styles.zoneBarPromotion]} />
            {/* Safe zone (middle, neutral) */}
            <View style={[styles.zoneBarSegment, styles.zoneBarSafe]} />
            {/* Relegation zone (right, red) */}
            <View style={[styles.zoneBarSegment, styles.zoneBarRelegation]} />

            {/* User rank pin — positioned along the bar */}
            <View
              style={[
                styles.zonePinWrapper,
                { left: `${Math.round(rankPct * 100)}%` as unknown as number },
              ]}
            >
              <View style={[styles.zonePin, { borderColor: tierColor }]} />
            </View>
          </View>

          {/* Zone legend */}
          <View style={styles.zoneLegend}>
            <Text style={[styles.zoneLegendText, { color: "#22C55E" }]}>Promotion</Text>
            <Text style={[styles.zoneLegendText, { color: colors.textMuted }]}>Safe</Text>
            <Text style={[styles.zoneLegendText, { color: "#EF4444" }]}>Relegation</Text>
          </View>
        </View>

        {/* ── Standings header ── */}
        <View style={[styles.card, { marginBottom: 0, paddingBottom: spacing.sm }]}>
          <View style={styles.standingsHeaderRow}>
            <Text style={styles.cardTitle}>
              {leagueEntry!.tier} Standings
            </Text>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/league-standings",
                  params: { tier: leagueEntry!.tier, month: leagueEntry!.month },
                })
              }
              hitSlop={8}
              style={({ pressed }) => [pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.viewFullLink}>View full standings →</Text>
            </Pressable>
          </View>
        </View>
      </>
    );
  }

  function renderListFooter() {
    if (loadingMore) {
      return (
        <View style={styles.loadMoreRow}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      );
    }
    if (!nextCursor && standings.length > 0) {
      return (
        <Text style={styles.endOfList}>All standings loaded</Text>
      );
    }
    return null;
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Leagues", headerShown: true }} />
      <FlatList
        data={standings}
        keyExtractor={(item) => item.userId}
        renderItem={renderStandingRow}
        ListHeaderComponent={renderListHeader}
        ListFooterComponent={renderListFooter}
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
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

  // ── Hero card ──
  heroCard: {
    margin: spacing.md,
    marginBottom: 0,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  heroTier: {
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: 1,
  },
  heroMonth: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 4,
  },
  heroStats: {
    flexDirection: "row",
    marginTop: spacing.lg,
    backgroundColor: "rgba(0,0,0,0.12)",
    borderRadius: radius.md,
    overflow: "hidden",
  },
  heroStat: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  heroStatValue: {
    fontSize: 24,
    fontWeight: "800",
  },
  heroStatLabel: {
    fontSize: 10,
    fontWeight: "600",
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  heroStatDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.3)",
    marginVertical: spacing.sm,
  },

  // ── Generic card ──
  card: {
    margin: spacing.md,
    marginBottom: 0,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.md,
  },
  standingsHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  viewFullLink: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.accent,
    marginBottom: spacing.md,
  },

  // ── Zone bar ──
  zoneLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  zoneDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  zoneLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  zoneBarOuter: {
    flexDirection: "row",
    height: 12,
    borderRadius: radius.pill,
    overflow: "visible",
    position: "relative",
  },
  zoneBarSegment: {
    flex: 1,
  },
  zoneBarPromotion: {
    backgroundColor: "#22C55E",
    borderTopLeftRadius: radius.pill,
    borderBottomLeftRadius: radius.pill,
  },
  zoneBarSafe: {
    backgroundColor: colors.border,
  },
  zoneBarRelegation: {
    backgroundColor: "#EF4444",
    borderTopRightRadius: radius.pill,
    borderBottomRightRadius: radius.pill,
  },
  zonePinWrapper: {
    position: "absolute",
    top: -4,
    marginLeft: -10,
  },
  zonePin: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: 3,
  },
  zoneLegend: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  zoneLegendText: {
    fontSize: 10,
    fontWeight: "600",
  },

  // ── Standing rows ──
  standingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  standingRowMe: {
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
  rankBadgeText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
  },
  rankBadgeTextMe: {
    color: colors.accent,
  },
  standingUsername: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  standingUsernameMe: {
    color: colors.accent,
  },
  standingPoints: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
  },
  standingPointsMe: {
    color: colors.accent,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginHorizontal: spacing.lg,
  },

  // ── Footer ──
  loadMoreRow: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  endOfList: {
    textAlign: "center",
    paddingVertical: spacing.lg,
    fontSize: 12,
    color: colors.textMuted,
  },
});
