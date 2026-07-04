import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

import type {
  ApiCategoryStat,
  ApiDailyQuests,
  ApiGroupSummary,
  ApiLeagueEntry,
  ApiMyProfile,
  ApiPnlSummary,
  ApiPositionSummary,
  ApiReferralInfo,
  ApiTierProgress,
  AppAnalystTier,
  AppLeagueTier,
  AppMarketStatus,
} from "@predict-future/types";
import { formatPoints, formatRelativeTime } from "@predict-future/utils";
import { radius, spacing } from "@predict-future/ui-tokens";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";
import { SHOW_PHONE_VERIFY } from "@/lib/feature-flags";
import { useSession } from "@/providers/session-provider";
import { useWatchlist, type WatchlistItem } from "@/providers/watchlist-provider";

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  DRAFT:               { label: "Pending review", color: "#92400E", bg: "#FEF3C7" },
  PENDING_REVIEW:      { label: "Pending review", color: "#92400E", bg: "#FEF3C7" },
  REJECTED:            { label: "Rejected",  color: "#991B1B", bg: "#FEE2E2" },
  OPEN:                { label: "Live",      color: "#059669", bg: "#ECFDF5" },
  CLOSED:              { label: "Closed",    color: "#D97706", bg: "#FFFBEB" },
  AWAITING_RESOLUTION: { label: "Pending",   color: "#7C3AED", bg: "#F5F3FF" },
  RESOLVING:           { label: "Resolving", color: "#0369A1", bg: "#EFF6FF" },
  RESOLVED:            { label: "Resolved",  color: "#64748B", bg: "#F1F5F9" },
  CANCELLED:           { label: "Cancelled", color: "#94A3B8", bg: "#F8FAFC" },
};

function getStatusMeta(status: string, textMuted: string, background: string) {
  return STATUS_META[status] ?? { label: status, color: textMuted, bg: background };
}

// ── League tier helpers ───────────────────────────────────────────────────────

const TIER_COLORS: Record<AppLeagueTier, string> = {
  BRONZE:   "#CD7F32",
  SILVER:   "#A8A9AD",
  GOLD:     "#FFD700",
  PLATINUM: "#E5E4E2",
  DIAMOND:  "#B9F2FF",
};

// ── Analyst Tier helpers ──────────────────────────────────────────────────────

const ANALYST_TIER_LABELS: Record<AppAnalystTier, string> = {
  ROOKIE:         "Rookie",
  ANALYST:        "Analyst",
  SENIOR_ANALYST: "Senior Analyst",
  CHIEF_ANALYST:  "Chief Analyst",
};

// ── Activity item types ───────────────────────────────────────────────────────

type VoteItem = {
  id: string;
  side: string | null;
  numericValue: number | null;
  createdAt: string;
  market: {
    id: string;
    title: string;
    status: AppMarketStatus;
    yesCount: number;
    noCount: number;
  };
};

type ActivityItemKind = "position" | "vote";

type ActivityItem = {
  kind: ActivityItemKind;
  id: string;
  createdAt: string;
  marketId: string;
  marketTitle: string;
  marketStatus: AppMarketStatus;
  winningSide: string | null | undefined;
  call: string;
  amount: number | null;
};

function buildBetItems(positions: ApiPositionSummary[]): ActivityItem[] {
  return [...positions]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((p) => ({
      kind: "position" as ActivityItemKind,
      id: p.id,
      createdAt: p.createdAt,
      marketId: p.market.id,
      marketTitle: p.market.title,
      marketStatus: p.market.status,
      winningSide: p.market.winningSide,
      call: p.side ?? "?",
      amount: p.amount,
    }));
}

function buildVoteItems(votes: VoteItem[]): ActivityItem[] {
  return [...votes]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((v) => ({
      kind: "vote" as ActivityItemKind,
      id: v.id,
      createdAt: v.createdAt,
      marketId: v.market.id,
      marketTitle: v.market.title,
      marketStatus: v.market.status,
      winningSide: undefined,
      call: v.side ?? (v.numericValue != null ? String(v.numericValue) : "?"),
      amount: null,
    }));
}

// ── SectionHeader ─────────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  const s = useThemedStyles(makeSectionHeaderStyles);
  return <Text style={s.label}>{title}</Text>;
}

const makeSectionHeaderStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    label: {
      fontSize: 11,
      fontWeight: "700",
      color: t.colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      paddingTop: spacing.xl,
      paddingBottom: spacing.xs,
      paddingHorizontal: spacing.xl,
    },
  });

// ── TierProgressSection ───────────────────────────────────────────────────────
// (Kept for use inside AchievementsSection)

function TierProgressSection({
  tierProgress,
  onUpgradeTap,
}: {
  tierProgress: ApiTierProgress;
  onUpgradeTap: () => void;
}) {
  const { colors } = useTheme();
  const tierProgressStyles = useThemedStyles(makeTierProgressStyles);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (tierProgress.isEligible) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.06, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [tierProgress.isEligible, pulseAnim]);

  if (tierProgress.nextTier === null) {
    return (
      <View style={tierProgressStyles.row}>
        <Ionicons name="checkmark-circle" size={13} color={colors.success} />
        <Text style={tierProgressStyles.topTierText}> Top tier reached</Text>
      </View>
    );
  }

  if (tierProgress.isEligible) {
    return (
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <Pressable onPress={onUpgradeTap} style={tierProgressStyles.eligibleChip}>
          <Ionicons name="arrow-up-circle" size={13} color={colors.accent} />
          <Text style={tierProgressStyles.eligibleText}>
            {" Upgrade available — make one more call"}
          </Text>
        </Pressable>
      </Animated.View>
    );
  }

  const totalPredictions = tierProgress.predictionsNeeded - tierProgress.predictionsToGo;
  const predFraction =
    tierProgress.predictionsNeeded > 0
      ? Math.min(1, totalPredictions / tierProgress.predictionsNeeded)
      : 1;

  const cur = tierProgress.currentNetPoints;
  const pnlFraction =
    tierProgress.pnlNeeded > 0
      ? Math.max(0, Math.min(1, cur / tierProgress.pnlNeeded))
      : 1;
  const pnlLabel = `Net PnL: ${cur >= 0 ? "+" : ""}${cur}/${tierProgress.pnlNeeded} pts`;

  return (
    <View style={tierProgressStyles.barsWrap}>
      <View style={tierProgressStyles.barItem}>
        <Text style={tierProgressStyles.barLabel}>
          {`Predictions: ${totalPredictions}/${tierProgress.predictionsNeeded}`}
        </Text>
        <View style={tierProgressStyles.trackOuter}>
          <View
            style={[
              tierProgressStyles.trackFill,
              { width: `${Math.round(predFraction * 100)}%` },
            ]}
          />
        </View>
      </View>
      <View style={tierProgressStyles.barItem}>
        <Text style={tierProgressStyles.barLabel}>{pnlLabel}</Text>
        <View style={tierProgressStyles.trackOuter}>
          <View
            style={[
              tierProgressStyles.trackFill,
              { width: `${Math.round(pnlFraction * 100)}%` },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

const makeTierProgressStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: spacing.xs,
    },
    topTierText: {
      fontSize: 11,
      color: t.colors.success,
      fontWeight: "600",
    },
    eligibleChip: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: spacing.xs,
      backgroundColor: t.colors.accentSoft,
      borderRadius: radius.sm,
      paddingHorizontal: 8,
      paddingVertical: 4,
      alignSelf: "flex-start",
    },
    eligibleText: {
      fontSize: 11,
      color: t.colors.accent,
      fontWeight: "700",
    },
    barsWrap: {
      flexDirection: "row",
      gap: spacing.md,
      marginTop: spacing.sm,
    },
    barItem: {
      flex: 1,
    },
    barLabel: {
      fontSize: 10,
      color: t.colors.textMuted,
      marginBottom: 3,
    },
    trackOuter: {
      height: 4,
      backgroundColor: t.colors.borderMuted,
      borderRadius: 2,
      overflow: "hidden",
    },
    trackFill: {
      height: 4,
      backgroundColor: t.colors.accent,
      borderRadius: 2,
    },
  });

// ── AchievementsSection ───────────────────────────────────────────────────────

type AchievementsProps = {
  user: NonNullable<ApiMyProfile["user"]>;
  leagueData: ApiLeagueEntry | null | undefined;
  onUpgradeTap: () => void;
  onLeagueTap: () => void;
};

type AchievementRow = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  label: string;
  value: string;
  subRow?: React.ReactNode;
  onPress?: () => void;
};

function AchievementsSection({
  user,
  leagueData,
  onUpgradeTap,
  onLeagueTap,
}: AchievementsProps) {
  const { colors } = useTheme();
  const s = useThemedStyles(makeAchievementStyles);

  const rows: AchievementRow[] = [];

  // Analyst Tier — only if present
  if (user.analystTier) {
    const tierLabel =
      ANALYST_TIER_LABELS[user.analystTier as AppAnalystTier] ?? user.analystTier;
    rows.push({
      key: "analyst-tier",
      icon: "analytics-outline",
      iconColor: colors.accent,
      label: "Analyst Tier",
      value: tierLabel,
      subRow:
        user.tierProgress ? (
          <View style={s.subRowWrap}>
            <TierProgressSection
              tierProgress={user.tierProgress}
              onUpgradeTap={onUpgradeTap}
            />
          </View>
        ) : undefined,
    });
  }

  // League + rank
  if (leagueData) {
    const rankStr = leagueData.rank != null ? `${leagueData.tier} · Rank #${leagueData.rank}` : leagueData.tier;
    rows.push({
      key: "league",
      icon: "ribbon-outline",
      label: "League",
      value: rankStr,
      onPress: onLeagueTap,
    });
  }

  // Prediction Streak
  if ((user.streak ?? 0) > 0) {
    rows.push({
      key: "streak",
      icon: "flame-outline",
      label: "Prediction Streak",
      value: `${user.streak} day${(user.streak ?? 0) !== 1 ? "s" : ""}`,
    });
  }

  // Level
  if (user.level != null) {
    rows.push({
      key: "level",
      icon: "star-outline",
      label: "Level",
      value: `Level ${user.level}`,
    });
  }

  // Host rows — only if hostStats present
  if (user.hostStats) {
    rows.push({
      key: "host-trust",
      icon: "shield-checkmark-outline",
      label: "Host Trust Score",
      value: String(user.hostStats.hostTrustScore),
    });
    rows.push({
      key: "host-markets",
      icon: "storefront-outline",
      label: "Markets Hosted",
      value: String(user.hostStats.hostedMarketsCount),
    });
  }

  // Return null if no rows — brand-new user
  if (rows.length === 0) return null;

  return (
    <>
      <SectionHeader title="Achievements" />
      <View style={s.card}>
        {rows.map((row, idx) => (
          <React.Fragment key={row.key}>
            {idx > 0 && <View style={s.divider} />}
            <Pressable
              style={({ pressed }) => [s.row, pressed && row.onPress ? s.rowPressed : undefined]}
              onPress={row.onPress}
              disabled={!row.onPress}
            >
              <Ionicons
                name={row.icon}
                size={16}
                color={row.iconColor ?? colors.textMuted}
              />
              <Text style={s.rowLabel}>{row.label}</Text>
              <Text style={s.rowValue} numberOfLines={1}>
                {row.value}
              </Text>
              {row.onPress && (
                <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
              )}
            </Pressable>
            {row.subRow}
          </React.Fragment>
        ))}
      </View>
    </>
  );
}

const makeAchievementStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.colors.surface,
      borderRadius: radius.lg,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      gap: spacing.md,
    },
    rowPressed: {
      backgroundColor: t.colors.surfaceMuted,
    },
    rowLabel: {
      flex: 1,
      fontSize: 14,
      color: t.colors.text,
      fontWeight: "500",
    },
    rowValue: {
      fontSize: 14,
      fontWeight: "600",
      color: t.colors.textMuted,
      maxWidth: 180,
      textAlign: "right",
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.colors.borderMuted,
      marginHorizontal: spacing.lg,
    },
    subRowWrap: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
    },
  });

// ── ActivitySection ───────────────────────────────────────────────────────────

const ACTIVITY_CAP = 5;

function ActivitySection({
  betItems,
  voteItems,
  isFullyBrandNew,
  router,
}: {
  betItems: ActivityItem[];
  voteItems: ActivityItem[];
  isFullyBrandNew: boolean;
  router: ReturnType<typeof useRouter>;
}) {
  const { colors } = useTheme();
  const s = useThemedStyles(makeStyles);
  const actS = useThemedStyles(makeActivitySectionStyles);

  if (isFullyBrandNew) return null;

  const allItems = [...betItems, ...voteItems].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const displayItems = allItems.slice(0, ACTIVITY_CAP);

  if (displayItems.length === 0) {
    return (
      <>
        <SectionHeader title="Recent Activity" />
        <View style={s.card}>
          <Text style={actS.emptyText}>No activity yet — head to Markets to make a prediction.</Text>
        </View>
      </>
    );
  }

  return (
    <>
      <SectionHeader title="Recent Activity" />
      <View style={s.card}>
        {displayItems.map((item) => (
          <ActivityRow key={`${item.kind}-${item.id}`} item={item} router={router} />
        ))}
        {/* T4: "See all my bets" link — only when there are bet items in the activity */}
        {betItems.length > 0 && (
          <Pressable
            style={({ pressed }) => [actS.seeAllBetsRow, pressed && actS.seeAllBetsRowPressed]}
            onPress={() => router.push("/(tabs)/markets?tab=mybets")}
          >
            <Text style={actS.seeAllBetsText}>See all my bets</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.accent} />
          </Pressable>
        )}
      </View>
    </>
  );
}

const makeActivitySectionStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    emptyText: {
      fontSize: 13,
      color: t.colors.textMuted,
      lineHeight: 19,
      paddingVertical: spacing.md,
    },
    seeAllBetsRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: spacing.md,
      gap: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.colors.borderMuted,
      marginTop: spacing.xs,
    },
    seeAllBetsRowPressed: {
      backgroundColor: t.colors.surfaceMuted,
    },
    seeAllBetsText: {
      flex: 1,
      fontSize: 13,
      fontWeight: "600",
      color: t.colors.accent,
    },
  });

// ── MarketsSection ────────────────────────────────────────────────────────────

const MARKETS_CAP = 4;

function MarketsSection({
  createdMarkets,
  watchlist,
  router,
}: {
  createdMarkets: Array<{ id: string; title: string; status: AppMarketStatus }>;
  watchlist: ReturnType<typeof useWatchlist>;
  router: ReturnType<typeof useRouter>;
}) {
  const { colors } = useTheme();
  const s = useThemedStyles(makeStyles);
  const mktS = useThemedStyles(makeMarketSectionStyles);

  const hasMarkets = createdMarkets.length > 0 || watchlist.items.length > 0;
  if (!hasMarkets) return null;

  const displayCreated = createdMarkets.slice(0, MARKETS_CAP);
  const displayWatchlist = watchlist.items.slice(0, MARKETS_CAP);
  const totalCreated = createdMarkets.length;
  const totalWatchlist = watchlist.items.length;

  return (
    <>
      <SectionHeader title="Markets & Watchlist" />
      <View style={mktS.card}>
        {/* My Markets */}
        {displayCreated.length > 0 && (
          <>
            <Text style={mktS.subHeading}>My Markets</Text>
            {displayCreated.map((m, idx) => {
              const meta =
                MY_MARKET_STATUS_META[m.status] ?? {
                  label: m.status,
                  color: colors.textMuted,
                  bg: colors.background,
                };
              return (
                <React.Fragment key={m.id}>
                  {idx > 0 && <View style={mktS.divider} />}
                  <Pressable
                    style={({ pressed }) => [s.trackRow, pressed && s.trackRowPressed, mktS.inlineRow]}
                    onPress={() => router.push(`/market/${m.id}`)}
                  >
                    <Text style={[s.trackTitle, { flex: 1 }]} numberOfLines={2}>
                      {m.title}
                    </Text>
                    <View style={[s.statusPill, { backgroundColor: meta.bg, marginLeft: spacing.sm }]}>
                      <Text style={[s.statusPillText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                  </Pressable>
                </React.Fragment>
              );
            })}
            {totalCreated > MARKETS_CAP && (
              <Pressable
                style={({ pressed }) => [mktS.seeAllRow, pressed && mktS.seeAllRowPressed]}
                onPress={() => router.push("/(tabs)/markets?tab=mine")}
              >
                <Text style={mktS.seeAllText}>See all my markets</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.accent} />
              </Pressable>
            )}
          </>
        )}

        {/* Watchlist */}
        {displayWatchlist.length > 0 && (
          <>
            {displayCreated.length > 0 && <View style={[mktS.divider, { marginTop: spacing.md }]} />}
            <View style={mktS.watchlistHeader}>
              <Text style={mktS.subHeading}>Watchlist</Text>
              <Pressable onPress={watchlist.clear}>
                <Text style={mktS.clearBtn}>Clear all</Text>
              </Pressable>
            </View>
            {displayWatchlist.map((item, idx) => (
              <React.Fragment key={item.id}>
                {idx > 0 && <View style={mktS.divider} />}
                <WatchlistRow
                  item={item}
                  onRemove={() => watchlist.remove(item.id)}
                  onPress={() => router.push(`/market/${item.id}`)}
                />
              </React.Fragment>
            ))}
            {totalWatchlist > MARKETS_CAP && (
              <Pressable
                style={({ pressed }) => [mktS.seeAllRow, pressed && mktS.seeAllRowPressed]}
                onPress={() => router.push("/(tabs)/markets?tab=saved")}
              >
                <Text style={mktS.seeAllText}>See all saved</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.accent} />
              </Pressable>
            )}
          </>
        )}
      </View>
    </>
  );
}

const MY_MARKET_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  OPEN:           { label: "Open",     color: "#059669", bg: "#ECFDF5" },
  PENDING_REVIEW: { label: "Review",   color: "#D97706", bg: "#FFFBEB" },
  DRAFT:          { label: "Draft",    color: "#94A3B8", bg: "#F8FAFC" },
  RESOLVED:       { label: "Resolved", color: "#2563EB", bg: "#EFF6FF" },
  CANCELLED:      { label: "Cancelled",color: "#94A3B8", bg: "#F8FAFC" },
};

const makeMarketSectionStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.colors.surface,
      borderRadius: radius.lg,
      overflow: "hidden",
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: 0,
    },
    subHeading: {
      fontSize: 12,
      fontWeight: "700",
      color: t.colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: spacing.sm,
    },
    inlineRow: {
      borderBottomWidth: 0,
      paddingHorizontal: 0,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.colors.borderMuted,
    },
    watchlistHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
    },
    clearBtn: {
      fontSize: 13,
      fontWeight: "600",
      color: t.colors.accent,
    },
    seeAllRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: spacing.md,
      gap: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.colors.borderMuted,
      marginTop: spacing.xs,
    },
    seeAllRowPressed: {
      backgroundColor: t.colors.surfaceMuted,
    },
    seeAllText: {
      fontSize: 13,
      fontWeight: "600",
      color: t.colors.accent,
    },
  });

// ── StatsSection ──────────────────────────────────────────────────────────────

function StatsSection({
  pnl,
  categoryStats,
  hostStats,
  positions,
  accuracyScore,
  isFullyBrandNew,
}: {
  pnl: ApiPnlSummary | null;
  categoryStats: ApiCategoryStat[];
  hostStats: {
    hostTrustScore: number;
    hostedMarketsCount: number;
    cleanStreakCount: number;
  } | null | undefined;
  positions: ApiPositionSummary[];
  accuracyScore: number;
  isFullyBrandNew: boolean;
}) {
  const router = useRouter();

  return (
    <>
      <SectionHeader title="Track Record" />
      {isFullyBrandNew ? (
        <GetStartedCard router={router} />
      ) : (
        <PerformanceCard
          pnl={pnl}
          categoryStats={categoryStats}
          hostStats={hostStats}
          positions={positions}
          accuracyScore={accuracyScore}
        />
      )}
    </>
  );
}

// ── PerformanceCard ───────────────────────────────────────────────────────────

function PerformanceCard({
  pnl,
  categoryStats,
  hostStats,
  positions,
  accuracyScore,
}: {
  pnl: ApiPnlSummary | null;
  categoryStats: ApiCategoryStat[];
  hostStats: {
    hostTrustScore: number;
    hostedMarketsCount: number;
    cleanStreakCount: number;
  } | null | undefined;
  positions: ApiPositionSummary[];
  accuracyScore: number;
}) {
  const { colors } = useTheme();
  const perfStyles = useThemedStyles(makePerfStyles);
  const styles = useThemedStyles(makeStyles);
  // T5: category breakdown defaults expanded in single-scroll layout
  const [catExpanded, setCatExpanded] = useState(true);
  const [hostExpanded, setHostExpanded] = useState(false);

  const hasResolvedPnl = pnl !== null && pnl.resolvedMarketCount > 0;
  const netPnl = pnl?.netPnl ?? 0;

  const resolvedPositions = positions.filter((p) => p.market.status === "RESOLVED");
  const wonPositions = resolvedPositions.filter(
    (p) => p.market.winningSide != null && p.market.winningSide === p.side
  );
  const winRateStr =
    resolvedPositions.length > 0
      ? `${((wonPositions.length / resolvedPositions.length) * 100).toFixed(0)}%`
      : "—";

  const topCategory =
    categoryStats.length > 0
      ? [...categoryStats].sort((a, b) => b.accuracyScore - a.accuracyScore)[0].category
      : "—";

  const top3Categories = [...categoryStats]
    .sort((a, b) => b.accuracyScore - a.accuracyScore)
    .slice(0, 3);

  if (!hasResolvedPnl) {
    return <PerformanceSkeletonCard />;
  }

  const pnlColor =
    netPnl > 0 ? "#059669" : netPnl < 0 ? "#DC2626" : colors.textMuted;

  return (
    <View style={perfStyles.card}>
      {/* Row 1: Dominant net P&L */}
      <View style={perfStyles.pnlRow}>
        <Text style={[perfStyles.pnlNumber, { color: pnlColor }]}>
          {netPnl > 0 ? "+" : ""}
          {netPnl.toLocaleString()}
        </Text>
        <Text style={perfStyles.pnlSubtext}>Net P&L across resolved predictions</Text>
      </View>

      {/* Divider */}
      <View style={perfStyles.divider} />

      {/* Row 2: 4-stat pill grid (2×2) */}
      <View style={perfStyles.pillGrid}>
        <StatPill label="Accuracy" value={`${accuracyScore.toFixed(0)}%`} />
        <StatPill label="Predictions" value={String(positions.length)} />
        <StatPill label="Win Rate" value={winRateStr} />
        <StatPill label="Top Category" value={topCategory} />
      </View>

      {/* Row 3: Category Breakdown (collapsible, default expanded) */}
      {categoryStats.length > 0 && (
        <>
          <View style={perfStyles.divider} />
          <Pressable
            style={({ pressed }) => [perfStyles.collapseHeader, pressed && { opacity: 0.7 }]}
            onPress={() => setCatExpanded((v) => !v)}
          >
            <Text style={perfStyles.collapseLabel}>Category Breakdown</Text>
            <View style={perfStyles.collapseRight}>
              {!catExpanded && (
                <Text style={perfStyles.collapseTeaser}>
                  {categoryStats.length}{" "}
                  {categoryStats.length === 1 ? "category" : "categories"}
                </Text>
              )}
              <Ionicons
                name={catExpanded ? "chevron-up" : "chevron-down"}
                size={16}
                color={colors.textMuted}
              />
            </View>
          </Pressable>
          {catExpanded && (
            <View style={perfStyles.collapseBody}>
              {top3Categories.map((cs) => (
                <View key={cs.category} style={styles.catBreakRow}>
                  <Text style={styles.catBreakLabel}>{cs.category}</Text>
                  <View style={styles.catBreakBarTrack}>
                    <View
                      style={[
                        styles.catBreakBarFill,
                        { width: `${Math.min(100, cs.accuracyScore)}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.catBreakPct}>
                    {cs.accuracyScore.toFixed(0)}%
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {/* Row 4: Host Stats (only when present, collapsible, default collapsed) */}
      {hostStats != null && (
        <>
          <View style={perfStyles.divider} />
          <Pressable
            style={({ pressed }) => [perfStyles.collapseHeader, pressed && { opacity: 0.7 }]}
            onPress={() => setHostExpanded((v) => !v)}
          >
            <Text style={perfStyles.collapseLabel}>Host Stats</Text>
            <Ionicons
              name={hostExpanded ? "chevron-up" : "chevron-down"}
              size={16}
              color={colors.textMuted}
            />
          </Pressable>
          {hostExpanded && (
            <View style={[perfStyles.collapseBody, styles.hostStatsRow]}>
              <HostStat label="Trust Score" value={String(hostStats.hostTrustScore)} />
              <HostStat label="Markets" value={String(hostStats.hostedMarketsCount)} />
              <HostStat label="Clean Streak" value={String(hostStats.cleanStreakCount)} />
            </View>
          )}
        </>
      )}
    </View>
  );
}

// ── StatPill (T5: surfaceMuted bg, value 20px, label 11px + letterSpacing 0.4) ─

function StatPill({ label, value }: { label: string; value: string }) {
  const perfStyles = useThemedStyles(makePerfStyles);
  return (
    <View style={perfStyles.pill}>
      <Text style={perfStyles.pillValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={perfStyles.pillLabel}>{label}</Text>
    </View>
  );
}

// ── PerformanceSkeletonCard ───────────────────────────────────────────────────

function PerformanceSkeletonCard() {
  const { colors } = useTheme();
  const perfStyles = useThemedStyles(makePerfStyles);
  return (
    <View style={perfStyles.card}>
      <View style={perfStyles.skeletonPnlRow}>
        <View style={perfStyles.skeletonPnlBlock} />
        <View style={perfStyles.skeletonSubtextBlock} />
      </View>
      <View style={perfStyles.divider} />
      <View style={perfStyles.pillGrid}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={perfStyles.skeletonPill} />
        ))}
      </View>
      <View style={perfStyles.divider} />
      <View style={perfStyles.skeletonCta}>
        <Ionicons name="lock-closed-outline" size={16} color={colors.textMuted} />
        <Text style={perfStyles.skeletonCtaText}>
          Your stats unlock after your first resolved prediction
        </Text>
      </View>
    </View>
  );
}

const makePerfStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.colors.surface,
      borderRadius: radius.lg,
      overflow: "hidden",
    },

    // ── P&L Row (T5: more breathing room) ──
    pnlRow: {
      paddingVertical: 20,
      paddingHorizontal: spacing.lg,
      alignItems: "center",
    },
    pnlNumber: {
      fontSize: 36,
      fontWeight: "800",
      lineHeight: 42,
      letterSpacing: -1,
    },
    pnlSubtext: {
      marginTop: 4,
      fontSize: 12,
      color: t.colors.textMuted,
      textAlign: "center",
    },

    // ── Divider ──
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.colors.border,
      marginHorizontal: spacing.lg,
    },

    // ── Stat pill grid (T5: surfaceMuted bg, value 20px, label 11px 0.4) ──
    pillGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      padding: spacing.md,
      gap: spacing.sm,
    },
    pill: {
      flex: 1,
      minWidth: "44%",
      alignItems: "center",
      backgroundColor: t.colors.surfaceMuted,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.sm,
    },
    pillValue: {
      fontSize: 20,
      fontWeight: "700",
      color: t.colors.text,
      textAlign: "center",
    },
    pillLabel: {
      marginTop: 3,
      fontSize: 11,
      fontWeight: "600",
      color: t.colors.textMuted,
      textAlign: "center",
      letterSpacing: 0.4,
    },

    // ── Collapsible header ──
    collapseHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    collapseLabel: {
      fontSize: 14,
      fontWeight: "700",
      color: t.colors.text,
    },
    collapseRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    collapseTeaser: {
      fontSize: 12,
      color: t.colors.textMuted,
    },
    collapseBody: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
    },

    // ── Skeleton ──
    skeletonPnlRow: {
      padding: spacing.lg,
      alignItems: "center",
      gap: spacing.sm,
    },
    skeletonPnlBlock: {
      width: 120,
      height: 36,
      borderRadius: radius.md,
      backgroundColor: t.colors.border,
    },
    skeletonSubtextBlock: {
      width: 200,
      height: 12,
      borderRadius: radius.sm,
      backgroundColor: t.colors.border,
      opacity: 0.6,
    },
    skeletonPill: {
      flex: 1,
      minWidth: "44%",
      height: 60,
      borderRadius: radius.md,
      backgroundColor: t.colors.border,
      opacity: 0.5,
    },
    skeletonCta: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    skeletonCtaText: {
      fontSize: 13,
      color: t.colors.textMuted,
      fontWeight: "600",
      textAlign: "center",
    },
  });

// ── GetStartedCard ────────────────────────────────────────────────────────────

function GetStartedCard({ router }: { router: ReturnType<typeof useRouter> }) {
  const { colors } = useTheme();
  const getStartedStyles = useThemedStyles(makeGetStartedStyles);

  const rows: Array<{
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    route: string;
  }> = [
    { icon: "flash-outline",       label: "Make your first prediction",     route: "/(tabs)/feed" },
    { icon: "stats-chart-outline", label: "Explore markets to bet on",       route: "/(tabs)/markets" },
    { icon: "people-outline",      label: "Join a group with an invite code", route: "/(tabs)/groups" },
  ];

  return (
    <View style={getStartedStyles.card}>
      <Text style={getStartedStyles.heading}>Welcome to Predict Future</Text>
      <Text style={getStartedStyles.subtitle}>
        Your activity and predictions will appear here
      </Text>
      <View style={getStartedStyles.rowList}>
        {rows.map((row) => (
          <Pressable
            key={row.route}
            style={({ pressed }) => [getStartedStyles.row, pressed && { opacity: 0.7 }]}
            onPress={() => router.push(row.route as Parameters<typeof router.push>[0])}
          >
            <Ionicons name={row.icon} size={20} color={colors.accent} />
            <Text style={getStartedStyles.rowLabel}>{row.label}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const makeGetStartedStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    card: {
      padding: spacing.lg,
      backgroundColor: t.colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    heading: {
      fontSize: 16,
      fontWeight: "700",
      color: t.colors.text,
    },
    subtitle: {
      marginTop: 4,
      fontSize: 13,
      color: t.colors.textMuted,
      lineHeight: 18,
    },
    rowList: {
      marginTop: spacing.md,
      gap: 0,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.colors.border,
    },
    rowLabel: {
      flex: 1,
      fontSize: 14,
      fontWeight: "600",
      color: t.colors.text,
    },
  });

// ── Sub-components ────────────────────────────────────────────────────────────

function ActivityRow({
  item,
  router,
}: {
  item: ActivityItem;
  router: ReturnType<typeof useRouter>;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const callColor =
    item.call === "YES" ? "#059669" : item.call === "NO" ? "#DC2626" : colors.text;

  function outcomeIcon(): React.ReactNode {
    if (item.kind === "vote") {
      const sm = getStatusMeta(item.marketStatus, colors.textMuted, colors.background);
      if (item.marketStatus === "RESOLVED") {
        return <Ionicons name="checkmark-circle-outline" size={16} color={colors.textMuted} />;
      }
      return <Ionicons name="time-outline" size={16} color={sm.color} />;
    }
    if (item.marketStatus !== "RESOLVED" || item.winningSide == null) {
      return <Ionicons name="time-outline" size={16} color={colors.textSubtle} />;
    }
    if (item.call === item.winningSide) {
      return <Ionicons name="checkmark-circle" size={16} color="#059669" />;
    }
    return <Ionicons name="close-circle" size={16} color="#DC2626" />;
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.trackRow, pressed && styles.trackRowPressed]}
      onPress={() => router.push(`/market/${item.marketId}`)}
    >
      <View style={styles.trackRowLeft}>
        <Text style={styles.trackTitle} numberOfLines={2}>
          {item.marketTitle}
        </Text>
        <View style={styles.trackMeta}>
          <View style={[styles.statusPill, { backgroundColor: colors.surfaceMuted }]}>
            <Text
              style={[
                styles.statusPillText,
                { color: item.kind === "position" ? "#2563EB" : "#7C3AED" },
              ]}
            >
              {item.kind === "position" ? "Bet" : "Vote"}
            </Text>
          </View>
          <Text style={styles.trackVote}>
            <Text style={{ fontWeight: "700", color: callColor }}>{item.call}</Text>
          </Text>
          {item.amount != null && item.amount > 0 && (
            <Text style={styles.betAmountLabel}>
              {item.amount.toLocaleString()} pts
            </Text>
          )}
          <Text style={styles.trackCrowd}>{formatRelativeTime(item.createdAt)}</Text>
        </View>
      </View>
      {outcomeIcon()}
    </Pressable>
  );
}

function WatchlistRow({
  item,
  onRemove,
  onPress,
}: {
  item: WatchlistItem;
  onRemove: () => void;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const sm = getStatusMeta(item.status, colors.textMuted, colors.background);
  return (
    <Pressable style={styles.watchlistRow} onPress={onPress}>
      <View style={styles.watchlistRowLeft}>
        <Text style={styles.watchlistTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <View
          style={[
            styles.statusPill,
            { backgroundColor: sm.bg, alignSelf: "flex-start", marginTop: 4 },
          ]}
        >
          <Text style={[styles.statusPillText, { color: sm.color }]}>{sm.label}</Text>
        </View>
      </View>
      <Pressable onPress={onRemove} hitSlop={8}>
        <Ionicons name="bookmark" size={18} color={colors.accent} />
      </Pressable>
    </Pressable>
  );
}

function HostStat({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.hostStatBox}>
      <Text style={styles.hostStatValue}>{value}</Text>
      <Text style={styles.hostStatLabel}>{label}</Text>
    </View>
  );
}

function ActionRow({
  icon,
  label,
  sublabel,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sublabel?: string;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable style={styles.actionRow} onPress={onPress} disabled={!onPress}>
      <Ionicons name={icon} size={20} color={colors.text} />
      <View style={styles.actionTextWrap}>
        <Text style={styles.actionLabel}>{label}</Text>
        {sublabel ? <Text style={styles.actionSublabel}>{sublabel}</Text> : null}
      </View>
      {onPress && <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />}
    </Pressable>
  );
}


// ── Main screen ───────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const router = useRouter();
  const { session, status: sessionStatus } = useSession();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const userId = session?.userId;
  const watchlist = useWatchlist();

  // ── Phone verify prompt state ──
  const [phoneVerifyDismissed, setPhoneVerifyDismissed] = useState<boolean>(true);
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const phoneVerifyChecked = useRef(false);

  // ── Tier PnL notice banner state ──
  const [tierPnlNoticeDismissed, setTierPnlNoticeDismissed] = useState<boolean>(true);
  const tierPnlNoticeChecked = useRef(false);

  // ── Notification unread badge ──
  const [notifUnreadCount, setNotifUnreadCount] = useState(0);

  const fetcher = useCallback(() => mobileApi.getMyProfile(), []);
  const groupsFetcher = useCallback(() => mobileApi.getMyGroups(), []);
  const questsFetcher = useCallback(() => mobileApi.getQuestsToday(), []);
  const referralFetcher = useCallback(() => mobileApi.getMyReferralCode(), []);
  const leagueFetcher = useCallback(() => mobileApi.getMyCurrentLeague(), []);

  const enabled = sessionStatus === "authenticated" && Boolean(userId);

  const { data, status, error, loading, refetch } = useApiQuery<ApiMyProfile>(
    fetcher,
    [userId],
    { enabled, errorFallback: "Unable to load profile." }
  );
  const { data: groupsData, refetch: refetchGroups } = useApiQuery<{
    groups: Array<ApiGroupSummary & { memberCount?: number; marketCount?: number }>;
  }>(groupsFetcher, [userId], { enabled });
  const { data: questsData, refetch: refetchQuests } = useApiQuery<ApiDailyQuests>(
    questsFetcher,
    [userId],
    { enabled }
  );
  const { data: referralData } = useApiQuery<ApiReferralInfo>(
    referralFetcher,
    [userId],
    { enabled }
  );
  const { data: leagueData } = useApiQuery<ApiLeagueEntry>(
    leagueFetcher,
    [userId],
    { enabled }
  );

  // ── Check if phone verify card should show ──
  useEffect(() => {
    if (!userId || phoneVerifyChecked.current) return;
    void (async () => {
      try {
        const key = `phone_verify_dismissed_${userId}`;
        const dismissed = await AsyncStorage.getItem(key);
        setPhoneVerifyDismissed(dismissed === "true");
        phoneVerifyChecked.current = true;
      } catch {
        setPhoneVerifyDismissed(true);
        phoneVerifyChecked.current = true;
      }
    })();
  }, [userId]);

  // ── Check if tier PnL notice banner should show ──
  useEffect(() => {
    if (!userId || tierPnlNoticeChecked.current) return;
    void (async () => {
      try {
        const key = `tier_pnl_notice_dismissed`;
        const dismissed = await AsyncStorage.getItem(key);
        setTierPnlNoticeDismissed(dismissed === "true");
        tierPnlNoticeChecked.current = true;
      } catch {
        setTierPnlNoticeDismissed(true);
        tierPnlNoticeChecked.current = true;
      }
    })();
  }, [userId]);

  // Fetch unread notification count on focus
  useFocusEffect(
    useCallback(() => {
      if (sessionStatus !== "authenticated") return;
      void mobileApi
        .getNotificationsUnreadCount()
        .then((res) => { setNotifUnreadCount(res.count); })
        .catch(() => { /* non-fatal */ });
    }, [sessionStatus])
  );

  // ── Guard states ──
  if (sessionStatus !== "authenticated" || !userId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <View style={styles.unauthCard}>
          <Text style={styles.unauthTitle}>Sign in to see your profile</Text>
          <Text style={styles.unauthSubtitle}>
            Track your predictions, badges, and reputation score.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.signInBtn, pressed && { opacity: 0.8 }]}
            onPress={() => router.push("/(auth)/sign-in")}
          >
            <Text style={styles.signInBtnText}>Sign In</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if ((status === "loading" || status === "idle") && !data) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (status === "error") {
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={refetch} style={styles.retryBtn}>
          <Text style={styles.retryLabel}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const user = data?.user;
  if (!user) return null;

  const groups = groupsData?.groups ?? [];
  const votes = data?.votes ?? [];
  const positions = user.positions ?? [];
  const categoryStats = user.categoryStats ?? [];
  const pnl = data?.pnl ?? null;
  const createdMarkets = user.createdMarkets ?? [];

  const isFullyBrandNew =
    positions.length === 0 &&
    votes.length === 0 &&
    (pnl === null || pnl.resolvedMarketCount === 0);

  const betItems = buildBetItems(positions);
  const voteActivityItems = buildVoteItems(votes);

  function handleRefresh() {
    void refetch();
    void refetchGroups();
    void refetchQuests();
  }

  const quests = questsData?.quests ?? [];
  const questsCompletedCount = quests.filter((q) => q.completed).length;
  const questsTotalCount = quests.length;

  const accuracyScore = user.accuracyScore ?? 0;
  const hasAnyPredictions = positions.length > 0 || votes.length > 0;

  // Analyst headline text
  let analystHeadline: React.ReactNode;
  if (hasAnyPredictions && user.analystTier) {
    const tierLabel =
      ANALYST_TIER_LABELS[user.analystTier as AppAnalystTier] ?? user.analystTier;
    const netPts = user.stats?.totalNetPoints ?? 0;
    analystHeadline = (
      <Text style={styles.analystHeadline}>
        {tierLabel} · {netPts >= 0 ? "+" : ""}{netPts} net pts
      </Text>
    );
  } else if (!hasAnyPredictions) {
    analystHeadline = (
      <Pressable
        onPress={() => router.push("/(tabs)/feed")}
        style={({ pressed }) => [pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.analystHeadlineCta}>Make your first prediction</Text>
      </Pressable>
    );
  } else {
    // Has predictions but no tier yet
    analystHeadline = (
      <Text style={styles.analystHeadlineMuted}>Analyst in training</Text>
    );
  }

  return (
    <View style={styles.screen}>
      {/* ── Light header card (T1) — sticky above ScrollView ── */}
      <View style={[styles.headerCard, { paddingTop: insets.top + spacing.lg }]}>
        {/* Icon bar: bell + gear */}
        <View style={styles.iconBar}>
          <View style={styles.iconBtnWrap}>
            <Pressable
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
              onPress={() => {
                setNotifUnreadCount(0);
                router.push("/notifications");
              }}
              hitSlop={8}
            >
              <Ionicons name="notifications-outline" size={22} color={colors.textMuted} />
            </Pressable>
            {notifUnreadCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>
                  {notifUnreadCount > 99 ? "99+" : String(notifUnreadCount)}
                </Text>
              </View>
            )}
          </View>
          <Pressable
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            onPress={() => router.push("/settings")}
            hitSlop={8}
          >
            <Ionicons name="settings-outline" size={22} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* Avatar + name block */}
        <View style={styles.headerTop}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>
              {user.username.slice(0, 2).toUpperCase()}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.displayName}>{user.username}</Text>
            <Text style={styles.handle}>{`@${user.username}`}</Text>
            {analystHeadline}
            {user.wallet?.balance != null && (
              <View style={styles.balancePill}>
                <Text style={styles.balancePillText}>
                  {user.wallet.balance.toLocaleString()} pts
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* ── Single scrollable body (T2: all sections unconditional) ── */}
      <ScrollView
        style={styles.scrollBody}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
      >
        {/* Track Record (T2 + T5) */}
        <StatsSection
          pnl={pnl}
          categoryStats={categoryStats}
          hostStats={user.hostStats}
          positions={positions}
          accuracyScore={accuracyScore}
          isFullyBrandNew={isFullyBrandNew}
        />

        {/* Achievements (T3) */}
        <AchievementsSection
          user={user}
          leagueData={leagueData}
          onUpgradeTap={() => router.push("/(tabs)/markets")}
          onLeagueTap={() => router.push("/leagues")}
        />

        {/* Recent Activity (T4) */}
        <ActivitySection
          betItems={betItems}
          voteItems={voteActivityItems}
          isFullyBrandNew={isFullyBrandNew}
          router={router}
        />

        {/* Markets & Watchlist (T4) */}
        <MarketsSection
          createdMarkets={createdMarkets.slice(0, 8) as Array<{ id: string; title: string; status: AppMarketStatus }>}
          watchlist={watchlist}
          router={router}
        />

        {/* Tier PnL migration notice */}
        {!tierPnlNoticeDismissed && (
          <TierPnlNoticeCard
            onDismiss={async () => {
              try {
                await AsyncStorage.setItem("tier_pnl_notice_dismissed", "true");
              } catch {
                // Ignore storage errors.
              }
              setTierPnlNoticeDismissed(true);
            }}
          />
        )}

        {/* Phone Verify card — hidden for launch (SHOW_PHONE_VERIFY=false: OTP needs DLT approval) */}
        {SHOW_PHONE_VERIFY && user.phoneVerified === false && !phoneVerifyDismissed && (
          <PhoneVerifyCard
            userId={userId}
            onVerifyNow={() => setShowPhoneModal(true)}
            onDismiss={async () => {
              try {
                await AsyncStorage.setItem(`phone_verify_dismissed_${userId}`, "true");
              } catch {
                // Ignore storage errors.
              }
              setPhoneVerifyDismissed(true);
            }}
          />
        )}

        {/* Phone Verification Modal */}
        <PhoneVerifyModal
          visible={showPhoneModal}
          onClose={() => setShowPhoneModal(false)}
          onSuccess={() => {
            setShowPhoneModal(false);
            setPhoneVerifyDismissed(true);
            void refetch();
          }}
        />

        {/* Social card: Quests / Leagues / Leaderboard / Groups */}
        <SectionHeader title="Explore" />
        <View style={styles.socialCard}>
          <Pressable
            style={({ pressed }) => [styles.socialRow, pressed && { opacity: 0.75 }]}
            onPress={() => router.push("/quests")}
          >
            <Ionicons name="flame-outline" size={20} color={colors.accent} />
            <Text style={styles.socialRowLabel}>Daily Quests</Text>
            {questsTotalCount > 0 ? (
              <View style={styles.socialRowBadge}>
                <Text style={styles.socialRowBadgeText}>
                  {questsCompletedCount}/{questsTotalCount}
                </Text>
              </View>
            ) : null}
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>

          <View style={styles.socialDivider} />

          <Pressable
            style={({ pressed }) => [styles.socialRow, pressed && { opacity: 0.75 }]}
            onPress={() => router.push("/leagues")}
          >
            <Ionicons name="ribbon-outline" size={20} color={colors.accent} />
            <Text style={styles.socialRowLabel}>Leagues</Text>
            {leagueData ? (
              <View style={styles.leagueBadgeRow}>
                <View
                  style={[
                    styles.leagueTierPill,
                    { backgroundColor: TIER_COLORS[leagueData.tier] },
                  ]}
                >
                  <Text style={styles.leagueTierText}>{leagueData.tier}</Text>
                </View>
                {leagueData.rank != null && (
                  <Text style={styles.leagueRankText}>Rank #{leagueData.rank}</Text>
                )}
              </View>
            ) : (
              <Text style={styles.leagueUnranked}>Unranked</Text>
            )}
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>

          <View style={styles.socialDivider} />

          <Pressable
            style={({ pressed }) => [styles.socialRow, pressed && { opacity: 0.75 }]}
            onPress={() => router.push("/(tabs)/leaderboard")}
          >
            <Ionicons name="trophy-outline" size={20} color={colors.accent} />
            <Text style={styles.socialRowLabel}>Leaderboard</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>

          <View style={styles.socialDivider} />

          <Pressable
            style={({ pressed }) => [styles.socialRow, pressed && { opacity: 0.75 }]}
            onPress={() => router.push("/(tabs)/groups")}
          >
            <Ionicons name="people-outline" size={20} color={colors.accent} />
            <Text style={styles.socialRowLabel}>Groups</Text>
            {groups.length > 0 ? (
              <View style={styles.socialRowBadge}>
                <Text style={styles.socialRowBadgeText}>{groups.length}</Text>
              </View>
            ) : null}
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>

          {groups.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.groupsChipShelf}
            >
              {groups.map((g) => (
                <Pressable
                  key={g.id}
                  style={({ pressed }) => [styles.groupChip, pressed && { opacity: 0.75 }]}
                  onPress={() => router.push(`/group/${g.id}`)}
                >
                  <Text style={styles.groupChipName} numberOfLines={1}>
                    {g.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.socialEmptyHint}>Tap to join with an invite code</Text>
          )}
        </View>

        {/* Share portfolio */}
        <View style={styles.actionsCard}>
          <ActionRow
            icon="share-social-outline"
            label="Share my portfolio"
            sublabel="Share your track record with friends"
            onPress={async () => {
              const portfolioUrl = `https://predictfuture.app/portfolio/${user.username}`;
              try {
                await Share.share({
                  title: "My Predict Future Portfolio",
                  message: `Check out my Predict Future portfolio: ${portfolioUrl}\n\n${user.stats?.totalNetPoints != null && user.stats.totalNetPoints >= 0 ? "+" : ""}${user.stats?.totalNetPoints ?? 0} net pts · ${positions.length} predictions`,
                });
              } catch {
                // User cancelled or share unavailable.
              }
            }}
          />
        </View>

        {/* Invite Friends */}
        {referralData && <InviteFriendsCard referral={referralData} />}
      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.colors.background },
    scrollBody: { flex: 1, backgroundColor: t.colors.background },
    scrollContent: { paddingHorizontal: spacing.xl, paddingTop: 0, paddingBottom: 60 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
    errorText: { color: t.colors.danger, fontSize: 14 },
    retryBtn: {
      marginTop: spacing.lg,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: t.colors.accent,
    },
    retryLabel: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },

    // ── Header (T1: light surface, no dark hero) ──
    headerCard: {
      backgroundColor: t.colors.surface,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.colors.border,
    },
    iconBar: {
      flexDirection: "row",
      justifyContent: "flex-end",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    iconBtnWrap: { position: "relative" },
    iconBtn: { padding: 4 },
    headerTop: { flexDirection: "row", alignItems: "center", gap: spacing.lg },

    // Avatar: 60px, accentSoft bg, accent initials
    avatarCircle: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: t.colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { fontSize: 20, fontWeight: "800", color: t.colors.accent },

    headerRight: { flex: 1 },
    // Name (no @, LinkedIn-style)
    displayName: { fontSize: 20, fontWeight: "700", color: t.colors.text },
    handle: { fontSize: 13, color: t.colors.textMuted, marginTop: 1 },
    // Analyst headline: accent, 13/600
    analystHeadline: {
      marginTop: 4,
      fontSize: 13,
      fontWeight: "600",
      color: t.colors.accent,
    },
    analystHeadlineCta: {
      marginTop: 4,
      fontSize: 13,
      fontWeight: "600",
      color: t.colors.accent,
    },
    analystHeadlineMuted: {
      marginTop: 4,
      fontSize: 13,
      fontWeight: "500",
      color: t.colors.textMuted,
    },

    // ── Balance pill (T1) ──
    balancePill: {
      alignSelf: "flex-start",
      marginTop: 5,
      backgroundColor: t.colors.accentSoft,
      borderRadius: radius.pill,
      paddingHorizontal: 9,
      paddingVertical: 3,
    },
    balancePillText: {
      fontSize: 12,
      fontWeight: "700",
      color: t.colors.accent,
    },

    // ── Generic card ──
    card: {
      padding: spacing.lg,
      backgroundColor: t.colors.surface,
      borderRadius: radius.lg,
    },
    sectionTitle: { fontSize: 16, fontWeight: "700", color: t.colors.text },
    sectionTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.md,
    },
    clearBtn: { fontSize: 13, fontWeight: "600", color: t.colors.accent },

    // ── Track record (shared row styles) ──
    trackRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.colors.border,
    },
    trackRowPressed: { backgroundColor: t.colors.background },
    trackRowLeft: { flex: 1 },
    trackTitle: { fontSize: 13, fontWeight: "600", color: t.colors.text, lineHeight: 18 },
    trackMeta: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: 4,
      flexWrap: "wrap",
    },
    statusPill: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: radius.pill,
    },
    statusPillText: { fontSize: 10, fontWeight: "700" },
    trackVote: { fontSize: 12, color: t.colors.textMuted },
    trackCrowd: { fontSize: 11, color: t.colors.textMuted, fontWeight: "600" },
    betAmountLabel: { fontSize: 9, color: t.colors.textMuted, marginTop: 1 },

    // ── Watchlist ──
    watchlistRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.colors.border,
    },
    watchlistRowLeft: { flex: 1 },
    watchlistTitle: { fontSize: 14, fontWeight: "600", color: t.colors.text, lineHeight: 20 },

    // ── Social card ──
    socialCard: {
      backgroundColor: t.colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
      paddingVertical: spacing.xs,
    },
    socialRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    socialRowLabel: {
      flex: 1,
      fontSize: 14,
      fontWeight: "700",
      color: t.colors.text,
    },
    socialRowBadge: {
      minWidth: 22,
      height: 22,
      paddingHorizontal: 6,
      borderRadius: 11,
      backgroundColor: t.colors.accent + "1F",
      alignItems: "center",
      justifyContent: "center",
    },
    socialRowBadgeText: {
      fontSize: 11,
      fontWeight: "700",
      color: t.colors.accent,
    },
    socialDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.colors.border,
      marginHorizontal: spacing.md,
    },
    socialEmptyHint: {
      fontSize: 12,
      color: t.colors.textMuted,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.md,
      marginTop: -spacing.sm,
    },

    // ── Group chip shelf ──
    groupsChipShelf: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.md,
      gap: spacing.sm,
    },
    groupChip: {
      backgroundColor: t.colors.background,
      borderWidth: 1,
      borderColor: t.colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm - 2,
      borderRadius: radius.pill,
      maxWidth: 160,
    },
    groupChipName: {
      fontSize: 13,
      fontWeight: "600",
      color: t.colors.text,
    },

    // ── Host stats ──
    hostStatsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
    hostStatBox: {
      flex: 1,
      alignItems: "center",
      padding: spacing.sm,
      backgroundColor: t.colors.background,
      borderRadius: radius.md,
    },
    hostStatValue: { fontSize: 18, fontWeight: "700", color: t.colors.text },
    hostStatLabel: { fontSize: 10, color: t.colors.textMuted, marginTop: 2 },

    // ── Actions card ──
    actionsCard: {
      marginTop: spacing.md,
      backgroundColor: t.colors.surface,
      borderRadius: radius.lg,
      overflow: "hidden",
    },
    actionRow: {
      flexDirection: "row",
      alignItems: "center",
      padding: spacing.lg,
      gap: spacing.md,
    },
    actionTextWrap: { flex: 1 },
    actionLabel: { fontSize: 15, fontWeight: "600", color: t.colors.text },
    actionSublabel: { fontSize: 12, color: t.colors.textMuted, marginTop: 2 },

    // ── Notification badge ──
    notifBadge: {
      position: "absolute",
      top: -4,
      right: -4,
      backgroundColor: "#EF4444",
      borderRadius: 999,
      minWidth: 16,
      height: 16,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 3,
    },
    notifBadgeText: {
      color: "#FFFFFF",
      fontSize: 9,
      fontWeight: "700",
    },

    // ── Unauthenticated ──
    unauthCard: {
      backgroundColor: t.colors.surface,
      borderRadius: radius.lg,
      padding: spacing.xl,
      alignItems: "center",
      marginHorizontal: spacing.xl,
    },
    unauthTitle: { fontSize: 20, fontWeight: "700", color: t.colors.text, textAlign: "center" },
    unauthSubtitle: {
      marginTop: spacing.sm,
      fontSize: 14,
      color: t.colors.textMuted,
      textAlign: "center",
      lineHeight: 20,
    },
    signInBtn: {
      marginTop: spacing.lg,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
      borderRadius: radius.pill,
      backgroundColor: t.colors.accent,
    },
    signInBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },

    // ── Category breakdown ──
    catBreakRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      marginBottom: spacing.sm,
    },
    catBreakLabel: {
      width: 72,
      fontSize: 12,
      fontWeight: "600",
      color: t.colors.textMuted,
      textTransform: "capitalize",
    },
    catBreakBarTrack: {
      flex: 1,
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: t.colors.border,
      overflow: "hidden",
    },
    catBreakBarFill: {
      height: "100%",
      borderRadius: radius.pill,
      backgroundColor: t.colors.accent,
    },
    catBreakPct: {
      width: 36,
      textAlign: "right",
      fontSize: 12,
      fontWeight: "700",
      color: t.colors.text,
    },

    // ── Leagues ──
    leagueBadgeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginRight: spacing.sm,
    },
    leagueTierPill: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 999,
    },
    leagueTierText: {
      fontSize: 10,
      fontWeight: "800",
      color: "#1A1A2E",
      letterSpacing: 0.3,
    },
    leagueRankText: {
      fontSize: 12,
      fontWeight: "600",
      color: t.colors.textMuted,
    },
    leagueUnranked: {
      fontSize: 12,
      color: t.colors.textMuted,
      marginRight: spacing.sm,
    },
  });

// ── InviteFriendsCard ─────────────────────────────────────────────────────────

function InviteFriendsCard({ referral }: { referral: ApiReferralInfo }) {
  const { colors } = useTheme();
  const inviteStyles = useThemedStyles(makeInviteStyles);

  const shareMessage = `Join me on Predict Future! Use my code ${referral.referralCode} — we both get 250 points when you make your first prediction. https://predictfuture.app`;

  async function handleShare() {
    try {
      await Share.share({ message: shareMessage, title: "Join Predict Future" });
    } catch {
      // Share sheet dismissed
    }
  }

  return (
    <View style={inviteStyles.card}>
      <View style={inviteStyles.headerRow}>
        <Ionicons name="gift-outline" size={18} color={colors.accent} />
        <Text style={inviteStyles.title}>Invite Friends</Text>
      </View>
      <Text style={inviteStyles.subtitle}>
        You and a friend both earn{" "}
        <Text style={inviteStyles.highlight}>250 pts</Text>
        {" "}when they make their first prediction.
      </Text>
      <View style={inviteStyles.codeBox}>
        <Text style={inviteStyles.codeLabel}>Your Code</Text>
        <Text style={inviteStyles.code}>{referral.referralCode}</Text>
      </View>
      <Pressable
        style={({ pressed }) => [inviteStyles.shareBtn, pressed && { opacity: 0.75 }]}
        onPress={handleShare}
      >
        <Ionicons name="share-social-outline" size={16} color="#FFFFFF" />
        <Text style={inviteStyles.shareBtnText}>Share via WhatsApp</Text>
      </Pressable>
      {referral.referralCount > 0 && (
        <Text style={inviteStyles.stats}>
          {referral.referralCount}{" "}
          {referral.referralCount === 1 ? "friend" : "friends"} joined
          {referral.totalEarned > 0
            ? ` · ${referral.totalEarned.toLocaleString()} pts earned`
            : ""}
        </Text>
      )}
    </View>
  );
}

const makeInviteStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    card: {
      marginTop: spacing.md,
      backgroundColor: t.colors.surface,
      borderRadius: radius.lg,
      padding: spacing.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    title: { fontSize: 15, fontWeight: "700", color: t.colors.text },
    subtitle: { fontSize: 13, color: t.colors.textMuted, lineHeight: 19, marginBottom: spacing.md },
    highlight: { color: t.colors.text, fontWeight: "700" },
    codeBox: {
      backgroundColor: t.colors.background,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
    },
    codeLabel: {
      fontSize: 11,
      fontWeight: "600",
      color: t.colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    code: { fontSize: 18, fontWeight: "800", color: t.colors.text, letterSpacing: 2 },
    shareBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: "#25D366",
      borderRadius: radius.md,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.lg,
    },
    shareBtnText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
    stats: { marginTop: spacing.sm, fontSize: 12, color: t.colors.textMuted, textAlign: "center" },
  });

// ── TierPnlNoticeCard ─────────────────────────────────────────────────────────

function TierPnlNoticeCard({ onDismiss }: { onDismiss: () => void | Promise<void> }) {
  const { colors } = useTheme();
  const cardStyles = useThemedStyles(makeTierPnlCardStyles);
  return (
    <View style={cardStyles.card}>
      <View style={cardStyles.headerRow}>
        <Ionicons name="trending-up-outline" size={16} color={colors.accent} />
        <Text style={cardStyles.title}>Analyst tiers updated</Text>
        <Pressable
          onPress={onDismiss}
          hitSlop={12}
          style={({ pressed }) => [cardStyles.dismissBtn, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="close" size={15} color={colors.textMuted} />
        </Pressable>
      </View>
      <Text style={cardStyles.body}>
        Analyst tiers now reflect your net performance (points won), not accuracy. Your tier has been updated to match your lifetime net PnL.
      </Text>
    </View>
  );
}

const makeTierPnlCardStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    card: {
      marginTop: spacing.md,
      backgroundColor: t.colors.surface,
      borderRadius: radius.lg,
      padding: spacing.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.xs,
    },
    title: { flex: 1, fontSize: 14, fontWeight: "700", color: t.colors.text },
    dismissBtn: { padding: 2 },
    body: {
      fontSize: 13,
      color: t.colors.textMuted,
      lineHeight: 19,
    },
  });

// ── PhoneVerifyCard (S25-T6) ──────────────────────────────────────────────────

function PhoneVerifyCard({
  userId: _userId,
  onVerifyNow,
  onDismiss,
}: {
  userId: string;
  onVerifyNow: () => void;
  onDismiss: () => void | Promise<void>;
}) {
  const { colors } = useTheme();
  const pvCardStyles = useThemedStyles(makePvCardStyles);
  return (
    <View style={pvCardStyles.card}>
      <View style={pvCardStyles.headerRow}>
        <Ionicons name="shield-checkmark-outline" size={18} color={colors.accent} />
        <Text style={pvCardStyles.title}>Verify your phone number</Text>
        <Pressable
          onPress={onDismiss}
          hitSlop={12}
          style={({ pressed }) => [pvCardStyles.dismissBtn, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="close" size={16} color={colors.textMuted} />
        </Pressable>
      </View>
      <Text style={pvCardStyles.body}>
        Earn{" "}
        <Text style={pvCardStyles.highlight}>+100 pts</Text>
        {" "}and secure your account by verifying your phone number.
      </Text>
      <View style={pvCardStyles.ctaRow}>
        <Pressable
          style={({ pressed }) => [pvCardStyles.verifyBtn, pressed && { opacity: 0.8 }]}
          onPress={onVerifyNow}
        >
          <Text style={pvCardStyles.verifyBtnText}>Verify Now</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [pvCardStyles.laterBtn, pressed && { opacity: 0.7 }]}
          onPress={onDismiss}
        >
          <Text style={pvCardStyles.laterBtnText}>Maybe later</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makePvCardStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    card: {
      marginTop: spacing.md,
      backgroundColor: t.colors.surface,
      borderRadius: radius.lg,
      padding: spacing.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    title: { flex: 1, fontSize: 15, fontWeight: "700", color: t.colors.text },
    dismissBtn: { padding: 2 },
    body: {
      fontSize: 13,
      color: t.colors.textMuted,
      lineHeight: 19,
      marginBottom: spacing.md,
    },
    highlight: { color: t.colors.text, fontWeight: "700" },
    ctaRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
    verifyBtn: {
      backgroundColor: t.colors.accent,
      borderRadius: radius.md,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.lg,
    },
    verifyBtnText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
    laterBtn: { paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md },
    laterBtnText: { color: t.colors.textMuted, fontSize: 13, fontWeight: "500" },
  });

// ── PhoneVerifyModal (S25-T6) ─────────────────────────────────────────────────

type VerifyStep = "phone" | "otp" | "success";

function PhoneVerifyModal({
  visible,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { colors } = useTheme();
  const pvModalStyles = useThemedStyles(makePvModalStyles);
  const [step, setStep] = useState<VerifyStep>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setStep("phone");
      setPhone("");
      setOtp("");
      setLoading(false);
      setErrorMsg(null);
    }
  }, [visible]);

  async function handleSendOtp() {
    if (!phone.trim()) { setErrorMsg("Please enter your phone number."); return; }
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await mobileApi.requestPhoneVerification(phone.trim());
      setDevOtp(res.otp ?? null);
      setStep("otp");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to send OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmOtp() {
    if (!otp.trim()) { setErrorMsg("Please enter the OTP."); return; }
    setLoading(true);
    setErrorMsg(null);
    try {
      await mobileApi.confirmPhoneVerification(otp.trim());
      setStep("success");
      setTimeout(() => { onSuccess(); }, 1500);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : "Invalid or expired OTP. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={pvModalStyles.overlay}
      >
        <Pressable style={pvModalStyles.backdrop} onPress={onClose} />
        <View style={pvModalStyles.sheet}>
          <View style={pvModalStyles.handle} />
          <Pressable
            style={({ pressed }) => [pvModalStyles.closeBtn, pressed && { opacity: 0.6 }]}
            onPress={onClose}
            hitSlop={12}
          >
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </Pressable>

          {step === "phone" && (
            <>
              <Text style={pvModalStyles.heading}>Verify your phone</Text>
              <Text style={pvModalStyles.subheading}>
                Enter your 10-digit Indian mobile number to receive a one-time code.
              </Text>
              <TextInput
                style={pvModalStyles.input}
                placeholder="e.g. 9876543210"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
                maxLength={13}
                value={phone}
                onChangeText={(v) => { setPhone(v); setErrorMsg(null); }}
                autoFocus
              />
              {errorMsg ? <Text style={pvModalStyles.error}>{errorMsg}</Text> : null}
              <Pressable
                style={({ pressed }) => [
                  pvModalStyles.primaryBtn,
                  pressed && { opacity: 0.8 },
                  loading && pvModalStyles.btnDisabled,
                ]}
                onPress={handleSendOtp}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={pvModalStyles.primaryBtnText}>Send OTP</Text>
                )}
              </Pressable>
            </>
          )}

          {step === "otp" && (
            <>
              <Text style={pvModalStyles.heading}>Enter OTP</Text>
              <Text style={pvModalStyles.subheading}>
                A 6-digit code was sent to {phone}. Enter it below.
              </Text>
              {devOtp ? (
                <Pressable
                  onPress={() => setOtp(devOtp)}
                  style={{
                    backgroundColor: "rgba(245, 158, 11, 0.12)",
                    borderRadius: 8,
                    padding: 10,
                    marginBottom: 10,
                  }}
                >
                  <Text style={{ fontSize: 12, color: "#92400e", fontWeight: "700" }}>
                    DEV MODE — OTP: {devOtp}
                  </Text>
                  <Text style={{ fontSize: 11, color: "#92400e", marginTop: 2 }}>
                    Tap to autofill. Real SMS will be sent once DLT is approved.
                  </Text>
                </Pressable>
              ) : null}
              <TextInput
                style={pvModalStyles.input}
                placeholder="6-digit code"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                maxLength={6}
                value={otp}
                onChangeText={(v) => { setOtp(v); setErrorMsg(null); }}
                autoFocus
              />
              {errorMsg ? <Text style={pvModalStyles.error}>{errorMsg}</Text> : null}
              <Pressable
                style={({ pressed }) => [
                  pvModalStyles.primaryBtn,
                  pressed && { opacity: 0.8 },
                  loading && pvModalStyles.btnDisabled,
                ]}
                onPress={handleConfirmOtp}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={pvModalStyles.primaryBtnText}>Confirm</Text>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [pvModalStyles.secondaryBtn, pressed && { opacity: 0.7 }]}
                onPress={() => { setStep("phone"); setOtp(""); setErrorMsg(null); }}
              >
                <Text style={pvModalStyles.secondaryBtnText}>Change number</Text>
              </Pressable>
            </>
          )}

          {step === "success" && (
            <View style={pvModalStyles.successContainer}>
              <Ionicons name="checkmark-circle" size={56} color="#22C55E" />
              <Text style={pvModalStyles.successHeading}>Phone verified!</Text>
              <Text style={pvModalStyles.successBody}>
                +100 pts have been added to your account.
              </Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makePvModalStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    overlay: { flex: 1, justifyContent: "flex-end" },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
    sheet: {
      backgroundColor: t.colors.background,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.xl,
      paddingBottom: spacing.xl + 16,
      minHeight: 280,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.colors.border,
      alignSelf: "center",
      marginBottom: spacing.lg,
    },
    closeBtn: { position: "absolute", top: spacing.lg, right: spacing.lg, padding: 4 },
    heading: { fontSize: 20, fontWeight: "800", color: t.colors.text, marginBottom: spacing.sm },
    subheading: {
      fontSize: 14,
      color: t.colors.textMuted,
      lineHeight: 20,
      marginBottom: spacing.lg,
    },
    input: {
      borderWidth: 1,
      borderColor: t.colors.border,
      borderRadius: radius.md,
      paddingVertical: 12,
      paddingHorizontal: spacing.md,
      fontSize: 16,
      color: t.colors.text,
      backgroundColor: t.colors.surface,
      marginBottom: spacing.md,
    },
    error: { color: "#EF4444", fontSize: 13, marginBottom: spacing.sm },
    primaryBtn: {
      backgroundColor: t.colors.accent,
      borderRadius: radius.md,
      paddingVertical: 13,
      alignItems: "center",
      justifyContent: "center",
      marginTop: spacing.sm,
    },
    btnDisabled: { opacity: 0.6 },
    primaryBtnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
    secondaryBtn: { paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.sm },
    secondaryBtnText: { color: t.colors.textMuted, fontSize: 14, fontWeight: "500" },
    successContainer: {
      alignItems: "center",
      paddingTop: spacing.xl,
      paddingBottom: spacing.lg,
      gap: spacing.md,
    },
    successHeading: { fontSize: 22, fontWeight: "800", color: t.colors.text },
    successBody: { fontSize: 15, color: t.colors.textMuted, textAlign: "center", lineHeight: 22 },
  });
