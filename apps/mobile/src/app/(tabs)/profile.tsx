import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { resetOnboarding } from "@/components/onboarding-walkthrough";

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
  AppUserDisplayMode,
} from "@predict-future/types";
import { formatPoints, formatRelativeTime } from "@predict-future/utils";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";
import { useWatchlist, type WatchlistItem } from "@/providers/watchlist-provider";

// ── Sub-tab types ─────────────────────────────────────────────────────────────

type ProfileTab = "activity" | "stats" | "markets";

// ── Badge config ─────────────────────────────────────────────────────────────

type BadgeMeta = { emoji: string; bg: string; color: string };

function getBadgeMeta(name: string): BadgeMeta {
  const lower = name.toLowerCase();
  if (lower.includes("oracle") || lower.includes("predict")) return { emoji: "🔮", bg: "#F5F3FF", color: "#7C3AED" };
  if (lower.includes("streak") || lower.includes("fire"))    return { emoji: "🔥", bg: "#FFF7ED", color: "#EA580C" };
  if (lower.includes("contrarian") || lower.includes("upset")) return { emoji: "🎯", bg: "#FFF1F2", color: "#E11D48" };
  if (lower.includes("early") || lower.includes("first"))    return { emoji: "⚡", bg: "#FFFBEB", color: "#D97706" };
  if (lower.includes("expert") || lower.includes("master"))  return { emoji: "🏆", bg: "#ECFDF5", color: "#059669" };
  if (lower.includes("sport"))  return { emoji: "⚽", bg: "#FFF1F2", color: "#DC2626" };
  if (lower.includes("tech"))   return { emoji: "💻", bg: "#EFF6FF", color: "#2563EB" };
  if (lower.includes("business") || lower.includes("finance")) return { emoji: "📈", bg: "#F0FDF4", color: "#16A34A" };
  return { emoji: "⭐", bg: "#EFF6FF", color: "#0369A1" };
}

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

function getStatusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, color: colors.textMuted, bg: colors.background };
}

// ── League tier helpers ───────────────────────────────────────────────────────

const TIER_COLORS: Record<AppLeagueTier, string> = {
  BRONZE:   "#CD7F32",
  SILVER:   "#A8A9AD",
  GOLD:     "#FFD700",
  PLATINUM: "#E5E4E2",
  DIAMOND:  "#B9F2FF",
};

function TierBadge({
  tier,
  onPress,
}: {
  tier: AppLeagueTier | null | undefined;
  onPress: () => void;
}) {
  const bg = tier ? TIER_COLORS[tier] : "rgba(255,255,255,0.15)";
  const label = tier ?? "Unranked";
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [tierBadgeStyles.pill, { backgroundColor: bg }, pressed && { opacity: 0.75 }]}
      hitSlop={8}
    >
      <Text style={tierBadgeStyles.label} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const tierBadgeStyles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    color: "#1A1A2E",
    letterSpacing: 0.3,
  },
});

// ── Analyst Tier helpers ───────────────────────────────────────────────────────

const ANALYST_TIER_LABELS: Record<AppAnalystTier, string> = {
  ROOKIE: "Rookie",
  ANALYST: "Analyst",
  SENIOR_ANALYST: "Senior Analyst",
  CHIEF_ANALYST: "Chief Analyst",
};

// ── Tier Progress Section ─────────────────────────────────────────────────────

function TierProgressSection({
  tierProgress,
  onUpgradeTap,
}: {
  tierProgress: ApiTierProgress;
  onUpgradeTap: () => void;
}) {
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
          <Ionicons name="arrow-up-circle" size={13} color="#7C3AED" />
          <Text style={tierProgressStyles.eligibleText}>
            {" Upgrade available — make one more call"}
          </Text>
        </Pressable>
      </Animated.View>
    );
  }

  const currentPct = Math.round(tierProgress.currentAccuracy * 100);
  const neededPct = Math.round(tierProgress.accuracyNeeded * 100);
  const totalPredictions = tierProgress.predictionsNeeded - tierProgress.predictionsToGo;
  const predFraction = tierProgress.predictionsNeeded > 0
    ? Math.min(1, totalPredictions / tierProgress.predictionsNeeded)
    : 1;
  const accFraction = tierProgress.accuracyNeeded > 0
    ? Math.min(1, tierProgress.currentAccuracy / tierProgress.accuracyNeeded)
    : 1;

  return (
    <View style={tierProgressStyles.barsWrap}>
      <View style={tierProgressStyles.barItem}>
        <Text style={tierProgressStyles.barLabel}>
          {`Predictions: ${totalPredictions}/${tierProgress.predictionsNeeded}`}
        </Text>
        <View style={tierProgressStyles.trackOuter}>
          <View style={[tierProgressStyles.trackFill, { width: `${Math.round(predFraction * 100)}%` }]} />
        </View>
      </View>
      <View style={tierProgressStyles.barItem}>
        <Text style={tierProgressStyles.barLabel}>
          {`Accuracy: ${currentPct}%/${neededPct}%`}
        </Text>
        <View style={tierProgressStyles.trackOuter}>
          <View style={[tierProgressStyles.trackFill, { width: `${Math.round(accFraction * 100)}%` }]} />
        </View>
      </View>
    </View>
  );
}

const tierProgressStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.xs,
  },
  topTierText: {
    fontSize: 11,
    color: colors.success,
    fontWeight: "600",
  },
  eligibleChip: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.xs,
    backgroundColor: "#F5F3FF",
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  eligibleText: {
    fontSize: 11,
    color: "#7C3AED",
    fontWeight: "700",
  },
  barsWrap: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  barItem: {
    flex: 1,
  },
  barLabel: {
    fontSize: 10,
    color: "rgba(255,255,255,0.6)",
    marginBottom: 3,
  },
  trackOuter: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 2,
    overflow: "hidden",
  },
  trackFill: {
    height: 4,
    backgroundColor: colors.accent,
    borderRadius: 2,
  },
});

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
  call: string;          // e.g. "YES", "NO", "42"
  amount: number | null; // for positions
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

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const router = useRouter();
  const { session, status: sessionStatus, signOut } = useSession();
  const userId = session?.userId;
  const watchlist = useWatchlist();

  const [activeTab, setActiveTab] = useState<ProfileTab>("activity");

  // ── Phone verify prompt state ──
  const [phoneVerifyDismissed, setPhoneVerifyDismissed] = useState<boolean>(true);
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const phoneVerifyChecked = useRef(false);

  // ── Notification unread badge (S30-T4) ──
  const [notifUnreadCount, setNotifUnreadCount] = useState(0);

  // ── Anonymous mode toggle state (S26-T5) ──
  // Initialised from the profile response; optimistically updated on toggle.
  const [displayMode, setDisplayModeState] = useState<AppUserDisplayMode>("USERNAME");
  // Track whether we have synced displayMode from the server response yet.
  const displayModeSynced = useRef(false);

  const fetcher = useCallback(
    () => mobileApi.getMyProfile(),
    []
  );
  const groupsFetcher = useCallback(
    () => mobileApi.getMyGroups(),
    []
  );
  const questsFetcher = useCallback(
    () => mobileApi.getQuestsToday(),
    []
  );
  const referralFetcher = useCallback(
    () => mobileApi.getMyReferralCode(),
    []
  );
  const leagueFetcher = useCallback(
    () => mobileApi.getMyCurrentLeague(),
    []
  );

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

  // ── Sync displayMode from server on first data load ──
  useEffect(() => {
    if (displayModeSynced.current) return;
    const serverMode = data?.user?.displayMode as AppUserDisplayMode | undefined;
    if (serverMode) {
      setDisplayModeState(serverMode);
      displayModeSynced.current = true;
    }
  }, [data]);

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
        // Best-effort — default to dismissed=true to avoid noise on storage errors.
        setPhoneVerifyDismissed(true);
        phoneVerifyChecked.current = true;
      }
    })();
  }, [userId]);

  // Fetch unread notification count whenever the Profile tab comes into focus (S30-T4).
  useFocusEffect(
    useCallback(() => {
      if (sessionStatus !== "authenticated") return;
      void mobileApi.getNotificationsUnreadCount().then((res) => {
        setNotifUnreadCount(res.count);
      }).catch(() => {
        // Non-fatal — badge simply won't show on error
      });
    }, [sessionStatus])
  );

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
  const badges = user.badges ?? [];
  const categoryStats = user.categoryStats ?? [];
  const pnl = data?.pnl ?? null;
  const createdMarkets = user.createdMarkets ?? [];

  // Determine "fully brand-new" state (all four empty simultaneously)
  const isFullyBrandNew =
    positions.length === 0 &&
    votes.length === 0 &&
    badges.length === 0 &&
    (pnl === null || pnl.resolvedMarketCount === 0);

  // Build separate activity arrays for Bets and Votes
  const betItems = buildBetItems(positions);
  const voteActivityItems = buildVoteItems(votes);

  // Markets tab data availability
  const hasMarkets = createdMarkets.length > 0 || watchlist.items.length > 0;

  function handleRefresh() {
    void refetch();
    void refetchGroups();
    void refetchQuests();
  }

  function handleLogOut() {
    Alert.alert("Sign out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: () => {
          signOut();
          router.replace("/(auth)/sign-in");
        },
      },
    ]);
  }

  // ── Quests summary ──
  const quests = questsData?.quests ?? [];
  const questsCompletedCount = quests.filter((q) => q.completed).length;
  const questsTotalCount = quests.length;

  // ── Performance Strip data ──
  const netPnl = pnl?.netPnl ?? 0;
  const balanceFormatted = formatPoints(user.wallet?.balance ?? 0);
  const accuracyScore = user.accuracyScore ?? 0;
  const hasAnyPredictions = positions.length > 0 || votes.length > 0;

  return (
    <View style={styles.screen}>
      {/* ── Sticky Profile Header (outside ScrollView — stays pinned while body scrolls) ── */}
      <View style={styles.headerCard}>
        <View style={styles.headerTop}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>
              {user.username.slice(0, 2).toUpperCase()}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.username}>@{user.username}</Text>
            <View style={styles.tagRow}>
              {user.level != null && <Tag label={`Lv ${user.level}`} />}
              {(user.streak ?? 0) > 0 && (
                <Tag label={`🔥 ${user.streak} streak`} accent />
              )}
              <TierBadge
                tier={leagueData?.tier ?? null}
                onPress={() => router.push("/leagues")}
              />
            </View>
            {/* ── Performance Strip ── */}
            {hasAnyPredictions ? (
              <Text style={styles.performanceStrip}>
                {balanceFormatted} pts{" · "}{positions.length} predictions{" · "}{accuracyScore.toFixed(0)}% accuracy{" · "}{netPnl > 0 ? "+" : ""}{netPnl} net
              </Text>
            ) : (
              <Pressable
                onPress={() => router.push("/(tabs)/feed")}
                style={({ pressed }) => [styles.performanceStripCta, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.performanceStripCtaText}>Make your first prediction</Text>
                <Ionicons name="arrow-forward" size={12} color="rgba(255,255,255,0.6)" />
              </Pressable>
            )}
            {/* ── Analyst Tier badge + progress ── */}
            {user.analystTier && (
              <View style={styles.analystTierRow}>
                <View style={styles.analystTierBadge}>
                  <Text style={styles.analystTierText}>
                    {ANALYST_TIER_LABELS[user.analystTier as AppAnalystTier] ?? user.analystTier}
                  </Text>
                </View>
                {user.tierProgress && (
                  <TierProgressSection
                    tierProgress={user.tierProgress}
                    onUpgradeTap={() => router.push("/(tabs)/markets")}
                  />
                )}
              </View>
            )}
          </View>
        </View>
      </View>

      {/* ── Sub-tab bar (sticky, below header) ── */}
      <SubTabBar activeTab={activeTab} onSelect={setActiveTab} />

      {/* ── Scrollable body ── */}
      <ScrollView
        style={styles.scrollBody}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={handleRefresh} tintColor={colors.accent} />
        }
      >
        {/* ── Tab content ── */}
        {activeTab === "activity" && (
          <ActivityTabContent
            betItems={betItems}
            voteItems={voteActivityItems}
            isFullyBrandNew={isFullyBrandNew}
            router={router}
          />
        )}

        {activeTab === "stats" && (
          <StatsTabContent
            pnl={pnl}
            categoryStats={categoryStats}
            hostStats={user.hostStats}
            positions={positions}
            accuracyScore={accuracyScore}
            isFullyBrandNew={isFullyBrandNew}
          />
        )}

        {activeTab === "markets" && (
          <MarketsTabContent
            createdMarkets={createdMarkets.slice(0, 6) as Array<{ id: string; title: string; status: AppMarketStatus }>}
            watchlist={watchlist}
            hasMarkets={hasMarkets}
            router={router}
          />
        )}

        {/* ────────────────────────────────────────────────────────────────────
            Navigation items — ALWAYS VISIBLE regardless of selected sub-tab
            (Leaderboard + Groups + Notifications/Logout footer)
        ──────────────────────────────────────────────────────────────────── */}

        {/* ── Phone Verification prompt card (S25-T6) ── */}
        {user.phoneVerified === false && !phoneVerifyDismissed && (
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

        {/* ── Phone Verification Modal ── */}
        <PhoneVerifyModal
          visible={showPhoneModal}
          onClose={() => setShowPhoneModal(false)}
          onSuccess={() => {
            setShowPhoneModal(false);
            setPhoneVerifyDismissed(true);
            void refetch();
          }}
        />

        {/* ── Social card: Daily Quests + Leaderboard + Groups ── */}
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
                  <Text style={styles.groupChipName} numberOfLines={1}>{g.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.socialEmptyHint}>Tap to join with an invite code</Text>
          )}
        </View>

        {/* ── Invite Friends card (S24-T6) ── */}
        {referralData && (
          <InviteFriendsCard referral={referralData} />
        )}

        {/* ── Anonymous mode toggle (S26-T5) ── */}
        <AnonymousToggleCard
          displayMode={displayMode}
          userId={user.id}
          onToggle={async (enabled) => {
            const newMode: AppUserDisplayMode = enabled ? "ANONYMOUS" : "USERNAME";
            // Optimistic update.
            setDisplayModeState(newMode);
            try {
              await mobileApi.setDisplayMode(newMode);
            } catch {
              // Revert on error.
              setDisplayModeState(enabled ? "USERNAME" : "ANONYMOUS");
              Alert.alert(
                "Could not update",
                "Failed to change display mode. Please try again.",
                [{ text: "OK" }]
              );
            }
          }}
        />

        {/* ── Actions ── */}
        <View style={styles.actionsCard}>
          <ActionRow
            icon="share-social-outline"
            label="Share my portfolio"
            sublabel="Share your track record with friends"
            onPress={async () => {
              const portfolioUrl = `https://predictfuture.app/portfolio/${user.username}`;
              const accuracyDisplay = accuracyScore.toFixed(0);
              const predictionsDisplay = positions.length;
              try {
                await Share.share({
                  title: "My Predict Future Portfolio",
                  message: `Check out my Predict Future portfolio: ${portfolioUrl}\n\n${accuracyDisplay}% accuracy · ${predictionsDisplay} predictions`,
                });
              } catch {
                // User cancelled or share unavailable — silently ignore.
              }
            }}
          />
          <View style={styles.actionDivider} />
          {/* Notifications row with unread badge (S30-T4) */}
          <Pressable
            style={styles.actionRow}
            onPress={() => { setNotifUnreadCount(0); router.push("/notifications"); }}
          >
            <Ionicons name="notifications-outline" size={20} color={colors.text} />
            <View style={styles.actionTextWrap}>
              <Text style={styles.actionLabel}>Notifications</Text>
            </View>
            {notifUnreadCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>
                  {notifUnreadCount > 99 ? "99+" : String(notifUnreadCount)}
                </Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
          <ActionRow
            icon="help-circle-outline"
            label="Replay Tutorial"
            sublabel="Re-run the first-run walkthrough"
            onPress={async () => {
              await resetOnboarding();
              Alert.alert(
                "Tutorial reset",
                "Re-open the app or switch tabs to see the walkthrough again.",
                [{ text: "OK" }]
              );
            }}
          />
        </View>

        {/* ── Log Out ── */}
        <Pressable
          style={({ pressed }) => [styles.logoutBtn, pressed && styles.logoutPressed]}
          onPress={handleLogOut}
        >
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={styles.logoutText}>Log Out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ── SubTabBar ─────────────────────────────────────────────────────────────────

function SubTabBar({
  activeTab,
  onSelect,
}: {
  activeTab: ProfileTab;
  onSelect: (tab: ProfileTab) => void;
}) {
  const tabs: Array<{ key: ProfileTab; label: string }> = [
    { key: "activity", label: "Activity" },
    { key: "stats",    label: "Stats" },
    { key: "markets",  label: "Markets" },
  ];

  return (
    <View style={subTabStyles.bar}>
      <View style={subTabStyles.segmented}>
        {tabs.map((t) => (
          <Pressable
            key={t.key}
            style={({ pressed }) => [
              subTabStyles.pill,
              activeTab === t.key && subTabStyles.pillActive,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => onSelect(t.key)}
          >
            <Text
              style={[
                subTabStyles.pillLabel,
                activeTab === t.key && subTabStyles.pillLabelActive,
              ]}
            >
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const subTabStyles = StyleSheet.create({
  bar: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 3,
    alignSelf: "stretch",
  },
  pill: {
    flex: 1,
    paddingVertical: 7,
    alignItems: "center",
    borderRadius: radius.md,
  },
  pillActive: {
    backgroundColor: colors.text,
  },
  pillLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
  },
  pillLabelActive: {
    color: "#FFFFFF",
  },
});

// ── ActivityTabContent ────────────────────────────────────────────────────────

const ACTIVITY_SECTION_MAX_HEIGHT = 320;
const MARKETS_SECTION_MAX_HEIGHT = 320;

type ActivitySubTab = "bets" | "votes";

function ActivityTabContent({
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
  const [activitySubTab, setActivitySubTab] = useState<ActivitySubTab>("bets");

  // For truly brand-new users (all four categories empty), show GetStartedCard
  // and skip the pill toggle entirely.
  if (isFullyBrandNew) {
    return <GetStartedCard router={router} />;
  }

  const subTabs: Array<{ key: ActivitySubTab; label: string }> = [
    { key: "bets",  label: "Bets" },
    { key: "votes", label: "Votes" },
  ];

  return (
    <View style={styles.card}>
      {/* ── Pill toggle: Bets | Votes ── */}
      <View style={activityTabStyles.subPillBar}>
        {subTabs.map((t) => (
          <Pressable
            key={t.key}
            style={({ pressed }) => [
              activityTabStyles.subPill,
              activitySubTab === t.key && activityTabStyles.subPillActive,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => setActivitySubTab(t.key)}
          >
            <Text
              style={[
                activityTabStyles.subPillLabel,
                activitySubTab === t.key && activityTabStyles.subPillLabelActive,
              ]}
            >
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── Bets list ── */}
      {activitySubTab === "bets" && (
        betItems.length === 0 ? (
          <Text style={activityTabStyles.sectionEmptyText}>
            No bets yet — head to Markets to stake your first prediction.
          </Text>
        ) : (
          <ScrollView
            style={{ maxHeight: ACTIVITY_SECTION_MAX_HEIGHT }}
            nestedScrollEnabled={true}
            showsVerticalScrollIndicator={betItems.length > 4}
          >
            {betItems.map((item) => (
              <ActivityRow key={`pos-${item.id}`} item={item} router={router} />
            ))}
          </ScrollView>
        )
      )}

      {/* ── Votes list ── */}
      {activitySubTab === "votes" && (
        voteItems.length === 0 ? (
          <Text style={activityTabStyles.sectionEmptyText}>
            No poll votes yet — vote on news cards in the Feed.
          </Text>
        ) : (
          <ScrollView
            style={{ maxHeight: ACTIVITY_SECTION_MAX_HEIGHT }}
            nestedScrollEnabled={true}
            showsVerticalScrollIndicator={voteItems.length > 4}
          >
            {voteItems.map((item) => (
              <ActivityRow key={`vote-${item.id}`} item={item} router={router} />
            ))}
          </ScrollView>
        )
      )}
    </View>
  );
}

const activityTabStyles = StyleSheet.create({
  // ── Pill toggle (subordinate to main SubTabBar) ──
  subPillBar: {
    flexDirection: "row",
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: 2,
    alignSelf: "flex-start",
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  subPill: {
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
  },
  subPillActive: {
    backgroundColor: colors.text,
  },
  subPillLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  subPillLabelActive: {
    color: "#FFFFFF",
  },
  sectionEmptyText: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
    paddingBottom: spacing.sm,
  },
});

function ActivityRow({
  item,
  router,
}: {
  item: ActivityItem;
  router: ReturnType<typeof useRouter>;
}) {
  const callColor = item.call === "YES" ? "#059669" : item.call === "NO" ? "#DC2626" : colors.text;

  function outcomeIcon(): React.ReactNode {
    if (item.kind === "vote") {
      // Votes don't have a winningSide tracked in the same way — show clock unless resolved
      const sm = getStatusMeta(item.marketStatus);
      if (item.marketStatus === "RESOLVED") {
        return <Ionicons name="checkmark-circle-outline" size={16} color={colors.textMuted} />;
      }
      return <Ionicons name="time-outline" size={16} color={sm.color} />;
    }
    // Position
    if (item.marketStatus !== "RESOLVED" || item.winningSide == null) {
      return <Ionicons name="time-outline" size={16} color="#94A3B8" />;
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
          {/* Kind badge */}
          <View style={[styles.statusPill, { backgroundColor: item.kind === "position" ? "#EFF6FF" : "#F5F3FF" }]}>
            <Text style={[styles.statusPillText, { color: item.kind === "position" ? "#2563EB" : "#7C3AED" }]}>
              {item.kind === "position" ? "Bet" : "Vote"}
            </Text>
          </View>
          {/* Call */}
          <Text style={styles.trackVote}>
            <Text style={{ fontWeight: "700", color: callColor }}>{item.call}</Text>
          </Text>
          {/* Amount (positions only) */}
          {item.amount != null && item.amount > 0 && (
            <Text style={styles.betAmountLabel}>{item.amount.toLocaleString()} pts</Text>
          )}
          {/* Relative time */}
          <Text style={styles.trackCrowd}>{formatRelativeTime(item.createdAt)}</Text>
        </View>
      </View>
      {outcomeIcon()}
    </Pressable>
  );
}

// ── StatsTabContent ───────────────────────────────────────────────────────────

function StatsTabContent({
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
  // Fully brand-new users: suppress the card — GetStartedCard on Activity tab
  // already handles the empty state. Show a simple message instead.
  if (isFullyBrandNew) {
    return (
      <View style={tabEmptyStyles.container}>
        <Ionicons name="bar-chart-outline" size={28} color={colors.textMuted} />
        <Text style={tabEmptyStyles.text}>Complete your first prediction to unlock stats.</Text>
      </View>
    );
  }

  return (
    <PerformanceCard
      pnl={pnl}
      categoryStats={categoryStats}
      hostStats={hostStats}
      positions={positions}
      accuracyScore={accuracyScore}
    />
  );
}

// ── PerformanceCard ───────────────────────────────────────────────────────────
//
// Consolidated single card that replaces the three separate cards
// (PnlSummaryCard + CategoryBreakdownSection + Host Stats card) on the Stats tab.
//
// Predictions count: uses positions.length (bets placed), not positions + votes.
// Rationale: positions represent genuine financial commitment with a point stake;
// votes are lightweight poll opinions. The "Predictions" pill on this card
// specifically tracks staked predictions, which is the meaningful engagement
// signal for the performance view.
//
// Win Rate: computed from positions where market.status === 'RESOLVED'.
// wonCount  = positions where market.winningSide === position.side
// resolvedCount = positions where market.status === 'RESOLVED'
// winRate = (wonCount / resolvedCount) * 100 if resolvedCount > 0 else "—"

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
  const [catExpanded, setCatExpanded] = useState(false);
  const [hostExpanded, setHostExpanded] = useState(false);

  // ── Derived stats ──
  const hasResolvedPnl = pnl !== null && pnl.resolvedMarketCount > 0;
  const netPnl = pnl?.netPnl ?? 0;

  // Win rate from positions array
  const resolvedPositions = positions.filter((p) => p.market.status === "RESOLVED");
  const wonPositions = resolvedPositions.filter(
    (p) => p.market.winningSide != null && p.market.winningSide === p.side
  );
  const winRateStr =
    resolvedPositions.length > 0
      ? `${((wonPositions.length / resolvedPositions.length) * 100).toFixed(0)}%`
      : "—";

  // Top category: highest accuracyScore from categoryStats
  const topCategory =
    categoryStats.length > 0
      ? [...categoryStats].sort((a, b) => b.accuracyScore - a.accuracyScore)[0].category
      : "—";

  // Top 3 categories for the breakdown bars
  const top3Categories = [...categoryStats]
    .sort((a, b) => b.accuracyScore - a.accuracyScore)
    .slice(0, 3);

  // ── Skeleton: has activity but no resolved predictions ──
  if (!hasResolvedPnl) {
    return <PerformanceSkeletonCard />;
  }

  // ── P&L color ──
  const pnlColor =
    netPnl > 0 ? "#059669" : netPnl < 0 ? "#DC2626" : colors.textMuted;

  return (
    <View style={perfStyles.card}>
      {/* Row 1: Dominant net P&L */}
      <View style={perfStyles.pnlRow}>
        <Text style={[perfStyles.pnlNumber, { color: pnlColor }]}>
          {netPnl > 0 ? "+" : ""}{netPnl.toLocaleString()}
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

      {/* Row 3: Category Breakdown (collapsible) */}
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
                  {categoryStats.length} {categoryStats.length === 1 ? "category" : "categories"}
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
                  <Text style={styles.catBreakPct}>{cs.accuracyScore.toFixed(0)}%</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {/* Row 4: Host Stats (only when present, collapsible) */}
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

// ── StatPill ─────────────────────────────────────────────────────────────────

function StatPill({ label, value }: { label: string; value: string }) {
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
// Shown when user has activity (positions or votes) but no resolved predictions yet.
// Uses muted-grey placeholder blocks to show the layout shape, plus a CTA.

function PerformanceSkeletonCard() {
  return (
    <View style={perfStyles.card}>
      {/* Skeleton: dominant number area */}
      <View style={perfStyles.skeletonPnlRow}>
        <View style={perfStyles.skeletonPnlBlock} />
        <View style={perfStyles.skeletonSubtextBlock} />
      </View>

      <View style={perfStyles.divider} />

      {/* Skeleton: 4 pill placeholders */}
      <View style={perfStyles.pillGrid}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={perfStyles.skeletonPill} />
        ))}
      </View>

      {/* CTA */}
      <View style={perfStyles.divider} />
      <View style={perfStyles.skeletonCta}>
        <Ionicons name="lock-closed-outline" size={16} color={colors.textMuted} />
        <Text style={perfStyles.skeletonCtaText}>
          Make 3 predictions to unlock your stats
        </Text>
      </View>
    </View>
  );
}

const perfStyles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
  },

  // ── P&L Row ──
  pnlRow: {
    padding: spacing.lg,
    alignItems: "center",
  },
  pnlNumber: {
    fontSize: 36,
    fontWeight: "800",
    lineHeight: 42,
    letterSpacing: -0.5,
  },
  pnlSubtext: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
  },

  // ── Divider ──
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginHorizontal: spacing.lg,
  },

  // ── Stat pill grid ──
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
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  pillValue: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
  },
  pillLabel: {
    marginTop: 3,
    fontSize: 10,
    fontWeight: "600",
    color: colors.textMuted,
    textAlign: "center",
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
    color: colors.text,
  },
  collapseRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  collapseTeaser: {
    fontSize: 12,
    color: colors.textMuted,
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
    backgroundColor: colors.border,
  },
  skeletonSubtextBlock: {
    width: 200,
    height: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.border,
    opacity: 0.6,
  },
  skeletonPill: {
    flex: 1,
    minWidth: "44%",
    height: 60,
    borderRadius: radius.md,
    backgroundColor: colors.border,
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
    color: colors.textMuted,
    fontWeight: "600",
    textAlign: "center",
  },
});

// ── MarketsTabContent ─────────────────────────────────────────────────────────

function MarketsTabContent({
  createdMarkets,
  watchlist,
  hasMarkets,
  router,
}: {
  createdMarkets: Array<{ id: string; title: string; status: AppMarketStatus }>;
  watchlist: ReturnType<typeof useWatchlist>;
  hasMarkets: boolean;
  router: ReturnType<typeof useRouter>;
}) {
  if (!hasMarkets) {
    return (
      <View style={tabEmptyStyles.container}>
        <Ionicons name="bookmark-outline" size={28} color={colors.textMuted} />
        <Text style={tabEmptyStyles.text}>Markets you create or watch will appear here.</Text>
      </View>
    );
  }

  return (
    <View>
      {/* My Markets */}
      {createdMarkets.length > 0 && (
        <MyMarketsSection createdMarkets={createdMarkets} />
      )}

      {/* Watchlist */}
      {watchlist.items.length > 0 && (
        <View style={styles.card}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>Watchlist</Text>
            <Pressable onPress={watchlist.clear}>
              <Text style={styles.clearBtn}>Clear all</Text>
            </Pressable>
          </View>
          <ScrollView
            style={{ maxHeight: MARKETS_SECTION_MAX_HEIGHT }}
            nestedScrollEnabled={true}
            showsVerticalScrollIndicator={watchlist.items.length > 4}
          >
            {watchlist.items.map((item) => (
              <WatchlistRow
                key={item.id}
                item={item}
                onRemove={() => watchlist.remove(item.id)}
                onPress={() => router.push(`/market/${item.id}`)}
              />
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// ── Tab empty state ───────────────────────────────────────────────────────────

const tabEmptyStyles = StyleSheet.create({
  container: {
    marginTop: spacing.xl,
    alignItems: "center",
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  text: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
    textAlign: "center",
    maxWidth: 260,
  },
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
    maxWidth: 260,
  },
});

// ── GetStartedCard ────────────────────────────────────────────────────────────

function GetStartedCard({ router }: { router: ReturnType<typeof useRouter> }) {
  const rows: Array<{
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    route: string;
  }> = [
    { icon: "flash-outline",       label: "Make your first prediction",   route: "/(tabs)/feed" },
    { icon: "stats-chart-outline", label: "Explore markets to bet on",     route: "/(tabs)/markets" },
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

const getStartedStyles = StyleSheet.create({
  card: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  heading: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textMuted,
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
    borderTopColor: colors.border,
  },
  rowLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
});

// ── MyMarketsSection ──────────────────────────────────────────────────────────

const MY_MARKET_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  OPEN:           { label: "Open",    color: "#059669", bg: "#ECFDF5" },
  PENDING_REVIEW: { label: "Review",  color: "#D97706", bg: "#FFFBEB" },
  DRAFT:          { label: "Draft",   color: "#94A3B8", bg: "#F8FAFC" },
  RESOLVED:       { label: "Resolved",color: "#2563EB", bg: "#EFF6FF" },
  CANCELLED:      { label: "Cancelled",color: "#94A3B8", bg: "#F8FAFC" },
};

function MyMarketsSection({
  createdMarkets,
}: {
  createdMarkets: Array<{ id: string; title: string; status: AppMarketStatus }>;
}) {
  const router = useRouter();

  return (
    <View style={styles.card}>
      <Text style={[styles.sectionTitle, { marginBottom: spacing.md }]}>My Markets</Text>
      <ScrollView
        style={{ maxHeight: MARKETS_SECTION_MAX_HEIGHT }}
        nestedScrollEnabled={true}
        showsVerticalScrollIndicator={createdMarkets.length > 4}
      >
        {createdMarkets.map((m) => {
          const meta =
            MY_MARKET_STATUS_META[m.status] ??
            { label: m.status, color: colors.textMuted, bg: colors.background };
          return (
            <Pressable
              key={m.id}
              style={({ pressed }) => [styles.trackRow, pressed && styles.trackRowPressed]}
              onPress={() => router.push(`/market/${m.id}`)}
            >
              <Text style={[styles.trackTitle, { flex: 1 }]} numberOfLines={2}>
                {m.title}
              </Text>
              <View style={[styles.statusPill, { backgroundColor: meta.bg, marginLeft: spacing.sm }]}>
                <Text style={[styles.statusPillText, { color: meta.color }]}>{meta.label}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function WatchlistRow({
  item,
  onRemove,
  onPress,
}: {
  item: WatchlistItem;
  onRemove: () => void;
  onPress: () => void;
}) {
  const sm = getStatusMeta(item.status);
  return (
    <Pressable style={styles.watchlistRow} onPress={onPress}>
      <View style={styles.watchlistRowLeft}>
        <Text style={styles.watchlistTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <View style={[styles.statusPill, { backgroundColor: sm.bg, alignSelf: "flex-start", marginTop: 4 }]}>
          <Text style={[styles.statusPillText, { color: sm.color }]}>{sm.label}</Text>
        </View>
      </View>
      <Pressable onPress={onRemove} hitSlop={8}>
        <Ionicons name="bookmark" size={18} color={colors.accent} />
      </Pressable>
    </Pressable>
  );
}

function Tag({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <View style={[styles.tag, accent && styles.tagAccent]}>
      <Text style={styles.tagText}>{label}</Text>
    </View>
  );
}

function HostStat({ label, value }: { label: string; value: string }) {
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

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scrollBody: { flex: 1, backgroundColor: colors.background },
  scrollContent: { paddingHorizontal: spacing.xl, paddingTop: 0, paddingBottom: 60 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  errorText: { color: colors.danger, fontSize: 14 },
  retryBtn: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  retryLabel: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },

  // ── Header ──
  headerCard: {
    backgroundColor: colors.text,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  headerTop: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 18, fontWeight: "800", color: "#FFFFFF" },
  headerRight: { flex: 1 },
  username: { fontSize: 22, fontWeight: "700", color: "#FFFFFF" },
  tagRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  tagAccent: { backgroundColor: "rgba(251,191,36,0.3)" },
  tagText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
  performanceStrip: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: "rgba(255,255,255,0.65)",
    fontWeight: "500",
    lineHeight: 18,
  },
  performanceStripCta: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  performanceStripCtaText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.65)",
    fontWeight: "600",
  },
  analystTierRow: {
    marginTop: spacing.sm,
    flexDirection: "column",
    gap: 0,
  },
  analystTierBadge: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  analystTierText: {
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(255,255,255,0.9)",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },

  // ── Generic card ──
  card: {
    marginTop: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  clearBtn: { fontSize: 13, fontWeight: "600", color: colors.accent },

  // ── Track record (shared row styles) ──
  trackRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  trackRowPressed: {
    backgroundColor: colors.background,
  },
  trackRowLeft: { flex: 1 },
  trackTitle: { fontSize: 13, fontWeight: "600", color: colors.text, lineHeight: 18 },
  trackMeta: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 4, flexWrap: "wrap" },
  statusPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  statusPillText: { fontSize: 10, fontWeight: "700" },
  trackVote: { fontSize: 12, color: colors.textMuted },
  trackCrowd: { fontSize: 11, color: colors.textMuted, fontWeight: "600" },
  betAmountLabel: { fontSize: 9, color: colors.textMuted, marginTop: 1 },

  // ── Watchlist ──
  watchlistRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  watchlistRowLeft: { flex: 1 },
  watchlistTitle: { fontSize: 14, fontWeight: "600", color: colors.text, lineHeight: 20 },

  // ── Social card (Leaderboard + Groups unified) ──
  socialCard: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
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
    color: colors.text,
  },
  socialRowBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: colors.accent + "1F",
    alignItems: "center",
    justifyContent: "center",
  },
  socialRowBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.accent,
  },
  socialDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  socialEmptyHint: {
    fontSize: 12,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    marginTop: -spacing.sm,
  },

  // ── Group chip shelf (inside social card) ──
  groupsChipShelf: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  groupChip: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
    borderRadius: radius.pill,
    maxWidth: 160,
  },
  groupChipName: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
  },

  // ── Host stats ──
  hostStatsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  hostStatBox: {
    flex: 1,
    alignItems: "center",
    padding: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
  },
  hostStatValue: { fontSize: 18, fontWeight: "700", color: colors.text },
  hostStatLabel: { fontSize: 10, color: colors.textMuted, marginTop: 2 },

  // ── Actions card ──
  actionsCard: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
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
  actionLabel: { fontSize: 15, fontWeight: "600", color: colors.text },
  actionSublabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  actionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  // Notification unread badge (S30-T4)
  notifBadge: {
    backgroundColor: "#EF4444",
    borderRadius: 999,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  notifBadgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },

  // ── Unauthenticated ──
  unauthCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    marginHorizontal: spacing.xl,
  },
  unauthTitle: { fontSize: 20, fontWeight: "700", color: colors.text, textAlign: "center" },
  unauthSubtitle: {
    marginTop: spacing.sm,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
  signInBtn: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
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
    color: colors.textMuted,
    textTransform: "capitalize",
  },
  catBreakBarTrack: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  catBreakBarFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  catBreakPct: { width: 36, textAlign: "right", fontSize: 12, fontWeight: "700", color: colors.text },

  // ── Leagues row ──
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
    color: colors.textMuted,
  },
  leagueUnranked: {
    fontSize: 12,
    color: colors.textMuted,
    marginRight: spacing.sm,
  },

  // ── Log out ──
  logoutBtn: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  logoutPressed: { opacity: 0.7 },
  logoutText: { fontSize: 15, fontWeight: "600", color: colors.danger },
});

// ── InviteFriendsCard ─────────────────────────────────────────────────────────

function InviteFriendsCard({ referral }: { referral: ApiReferralInfo }) {
  const shareMessage = `Join me on Predict Future! Use my code ${referral.referralCode} — we both get 250 points when you make your first prediction. https://predictfuture.app`;

  async function handleShare() {
    try {
      await Share.share({
        message: shareMessage,
        title: "Join Predict Future",
      });
    } catch (err) {
      // Share sheet dismissed — no action needed
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

      {/* Referral code display */}
      <View style={inviteStyles.codeBox}>
        <Text style={inviteStyles.codeLabel}>Your Code</Text>
        <Text style={inviteStyles.code}>{referral.referralCode}</Text>
      </View>

      {/* Share button */}
      <Pressable
        style={({ pressed }) => [inviteStyles.shareBtn, pressed && { opacity: 0.75 }]}
        onPress={handleShare}
      >
        <Ionicons name="share-social-outline" size={16} color="#FFFFFF" />
        <Text style={inviteStyles.shareBtnText}>Share via WhatsApp</Text>
      </Pressable>

      {/* Stats */}
      {referral.referralCount > 0 && (
        <Text style={inviteStyles.stats}>
          {referral.referralCount} {referral.referralCount === 1 ? "friend" : "friends"} joined
          {referral.totalEarned > 0 ? ` · ${referral.totalEarned.toLocaleString()} pts earned` : ""}
        </Text>
      )}
    </View>
  );
}

const inviteStyles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
    marginBottom: spacing.md,
  },
  highlight: {
    color: colors.text,
    fontWeight: "700",
  },
  codeBox: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  codeLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  code: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: 2,
  },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: "#25D366", // WhatsApp green
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
  },
  shareBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  stats: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
  },
});

// ── AnonymousToggleCard (S26-T5) ─────────────────────────────────────────────

/**
 * "Show as anonymous" toggle card.
 *
 * When enabled the user's calls appear as "AnonymousAnalyst_XXXXXX" on all
 * public-facing surfaces (leaderboard, market detail, comments, etc.). Their
 * accuracy record, league tier, and quest rewards continue to accrue to their
 * real account regardless of this setting.
 *
 * Own-view exception: the user always sees their real username on this screen.
 */
function AnonymousToggleCard({
  displayMode,
  userId: _userId,
  onToggle,
}: {
  displayMode: AppUserDisplayMode;
  userId: string;
  onToggle: (enabled: boolean) => Promise<void>;
}) {
  const isAnonymous = displayMode === "ANONYMOUS";

  function handleValueChange(value: boolean) {
    if (value) {
      // Show confirmation dialog before enabling anonymous mode.
      Alert.alert(
        "Show as anonymous?",
        "Your calls will appear as AnonymousAnalyst_XXXXXX on leaderboards, comments, and market details. Your accuracy record still accrues to your account and is fully preserved when you switch back.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Enable",
            style: "default",
            onPress: () => { void onToggle(true); },
          },
        ]
      );
    } else {
      void onToggle(false);
    }
  }

  return (
    <View style={anonStyles.card}>
      <View style={anonStyles.row}>
        <View style={anonStyles.iconWrap}>
          <Ionicons name="eye-off-outline" size={18} color={colors.textMuted} />
        </View>
        <View style={anonStyles.textWrap}>
          <Text style={anonStyles.label}>Show as anonymous</Text>
          <Text style={anonStyles.sublabel}>
            {isAnonymous
              ? "Public view: AnonymousAnalyst_XXXXXX (tap to reveal)"
              : "Your real username is visible publicly"}
          </Text>
        </View>
        <Switch
          value={isAnonymous}
          onValueChange={handleValueChange}
          trackColor={{ false: colors.border, true: colors.accent }}
          thumbColor="#FFFFFF"
        />
      </View>
      {isAnonymous && (
        <Text style={anonStyles.hint}>
          Your calls will appear as AnonymousAnalyst_XXXXXX. Your accuracy and
          track record still count.
        </Text>
      )}
    </View>
  );
}

const anonStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  iconWrap: {
    width: 32,
    alignItems: "center",
  },
  textWrap: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  sublabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  hint: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
    paddingLeft: 32 + spacing.md,
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

const pvCardStyles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  dismissBtn: {
    padding: 2,
  },
  body: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
    marginBottom: spacing.md,
  },
  highlight: {
    color: colors.text,
    fontWeight: "700",
  },
  ctaRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
  },
  verifyBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
  },
  verifyBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  laterBtn: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  laterBtnText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "500",
  },
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
  const [step, setStep] = useState<VerifyStep>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset on open.
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
    if (!phone.trim()) {
      setErrorMsg("Please enter your phone number.");
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      await mobileApi.requestPhoneVerification(phone.trim());
      setStep("otp");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send OTP. Please try again.";
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmOtp() {
    if (!otp.trim()) {
      setErrorMsg("Please enter the OTP.");
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      await mobileApi.confirmPhoneVerification(otp.trim());
      setStep("success");
      // Auto-close after brief success display.
      setTimeout(() => {
        onSuccess();
      }, 1500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid or expired OTP. Please try again.";
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={pvModalStyles.overlay}
      >
        <Pressable style={pvModalStyles.backdrop} onPress={onClose} />
        <View style={pvModalStyles.sheet}>
          <View style={pvModalStyles.handle} />

          {/* Close button */}
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
                onChangeText={(t) => { setPhone(t); setErrorMsg(null); }}
                autoFocus
              />
              {errorMsg ? <Text style={pvModalStyles.error}>{errorMsg}</Text> : null}
              <Pressable
                style={({ pressed }) => [pvModalStyles.primaryBtn, pressed && { opacity: 0.8 }, loading && pvModalStyles.btnDisabled]}
                onPress={handleSendOtp}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#FFFFFF" size="small" />
                  : <Text style={pvModalStyles.primaryBtnText}>Send OTP</Text>
                }
              </Pressable>
            </>
          )}

          {step === "otp" && (
            <>
              <Text style={pvModalStyles.heading}>Enter OTP</Text>
              <Text style={pvModalStyles.subheading}>
                A 6-digit code was sent to {phone}. Enter it below.
              </Text>
              <TextInput
                style={pvModalStyles.input}
                placeholder="6-digit code"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                maxLength={6}
                value={otp}
                onChangeText={(t) => { setOtp(t); setErrorMsg(null); }}
                autoFocus
              />
              {errorMsg ? <Text style={pvModalStyles.error}>{errorMsg}</Text> : null}
              <Pressable
                style={({ pressed }) => [pvModalStyles.primaryBtn, pressed && { opacity: 0.8 }, loading && pvModalStyles.btnDisabled]}
                onPress={handleConfirmOtp}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#FFFFFF" size="small" />
                  : <Text style={pvModalStyles.primaryBtnText}>Confirm</Text>
                }
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
              <Text style={pvModalStyles.successBody}>+100 pts have been added to your account.</Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const pvModalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    backgroundColor: colors.background,
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
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: spacing.lg,
  },
  closeBtn: {
    position: "absolute",
    top: spacing.lg,
    right: spacing.lg,
    padding: 4,
  },
  heading: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subheading: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
  error: {
    color: "#EF4444",
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryBtn: {
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  secondaryBtnText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "500",
  },
  successContainer: {
    alignItems: "center",
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  successHeading: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
  },
  successBody: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 22,
  },
});
