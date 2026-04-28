import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import type {
  ApiCategoryStat,
  ApiGroupSummary,
  ApiLeaderboardEntry,
  ApiMyProfile,
  ApiPositionSummary,
  AppMarketCategory,
  AppMarketStatus,
} from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";
import { useWatchlist, type WatchlistItem } from "@/providers/watchlist-provider";

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

// ── Category config ───────────────────────────────────────────────────────────

const LEADERBOARD_CATEGORIES: Array<{ label: string; value: AppMarketCategory | undefined }> = [
  { label: "All",     value: undefined },
  { label: "Sports",  value: "SPORTS" },
  { label: "Tech",    value: "TECH" },
  { label: "Business",value: "BUSINESS" },
  { label: "General", value: "GENERAL" },
];

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const router = useRouter();
  const { session, status: sessionStatus, signOut } = useSession();
  const userId = session?.userId;
  const watchlist = useWatchlist();

  const fetcher = useCallback(
    () => mobileApi.getMyProfile({ userId: userId as string }),
    [userId]
  );
  const groupsFetcher = useCallback(
    () => mobileApi.getMyGroups({ userId: userId as string }),
    [userId]
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

  if (sessionStatus !== "authenticated" || !userId) {
    return (
      <View style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.title}>Profile</Text>
          <Text style={styles.subtitle}>
            Sign in to view your profile.
          </Text>
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

  const stats = user.stats;
  const groups = groupsData?.groups ?? [];
  const votes = data?.votes ?? [];
  const positions = user.positions ?? [];
  const badges = user.badges ?? [];
  const categoryStats = user.categoryStats ?? [];

  function handleRefresh() {
    void refetch();
    void refetchGroups();
  }

  function handleLogOut() {
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log Out", style: "destructive", onPress: signOut },
    ]);
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={handleRefresh} tintColor={colors.accent} />
      }
    >
      {/* ── Profile Header ── */}
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
            </View>
          </View>
        </View>

        <View style={styles.statsRow}>
          <Stat label="Accuracy" value={`${(user.accuracyScore ?? 0).toFixed(1)}%`} />
          <Stat label="Predictions" value={String(stats?.totalPredictions ?? 0)} />
          <Stat label="Net Pts" value={String(stats?.totalNetPoints ?? 0)} />
          <Stat label="Balance" value={String(user.wallet?.balance ?? 0)} />
        </View>

        {/* Rep score bar */}
        <View style={styles.repRow}>
          <Text style={styles.repLabel}>{user.reputationScore.toLocaleString()} reputation</Text>
          <View style={styles.repBarTrack}>
            <View
              style={[
                styles.repBarFill,
                { width: `${Math.min(100, (user.reputationScore / 5000) * 100)}%` },
              ]}
            />
          </View>
        </View>
      </View>

      {/* ── Badges ── */}
      {badges.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Badges</Text>
          <View style={styles.badgesGrid}>
            {badges.map((ub) => {
              const meta = getBadgeMeta(ub.badge.name);
              return (
                <View key={ub.badge.id} style={[styles.badgeCard, { backgroundColor: meta.bg }]}>
                  <Text style={styles.badgeEmoji}>{meta.emoji}</Text>
                  <Text style={[styles.badgeName, { color: meta.color }]}>{ub.badge.name}</Text>
                  {ub.badge.description ? (
                    <Text style={styles.badgeDesc} numberOfLines={2}>{ub.badge.description}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* ── My Predictions ── */}
      {(votes.length > 0 || positions.length > 0) && (
        <PredictionsSection
          votes={votes}
          positions={positions}
          categoryStats={categoryStats}
        />
      )}

      {/* ── Watchlist ── */}
      {watchlist.items.length > 0 && (
        <View style={styles.card}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>Watchlist</Text>
            <Pressable onPress={watchlist.clear}>
              <Text style={styles.clearBtn}>Clear all</Text>
            </Pressable>
          </View>
          {watchlist.items.map((item) => (
            <WatchlistRow
              key={item.id}
              item={item}
              onRemove={() => watchlist.remove(item.id)}
              onPress={() => router.push(`/market/${item.id}`)}
            />
          ))}
        </View>
      )}

      {/* ── Leaderboard ── */}
      <LeaderboardSection currentUserId={userId} />

      {/* ── Host Trust ── */}
      {user.hostStats && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Host Stats</Text>
          <View style={styles.hostStatsRow}>
            <HostStat label="Trust Score" value={String(user.hostStats.hostTrustScore)} />
            <HostStat label="Markets" value={String(user.hostStats.hostedMarketsCount)} />
            <HostStat label="Clean Streak" value={String(user.hostStats.cleanStreakCount)} />
          </View>
        </View>
      )}

      {/* ── Groups ── */}
      {groups.length > 0 && <GroupsAccordion groups={groups} />}

      {/* ── Actions ── */}
      <View style={styles.actionsCard}>
        <ActionRow
          icon="notifications-outline"
          label="Notifications"
          onPress={() => router.push("/notifications")}
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
  );
}

// ── PredictionsSection ────────────────────────────────────────────────────────

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

function PredictionsSection({
  votes,
  positions,
  categoryStats,
}: {
  votes: VoteItem[];
  positions: ApiPositionSummary[];
  categoryStats: ApiCategoryStat[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"bets" | "polls">("bets");
  const hasBets = positions.length > 0;
  const hasPolls = votes.length > 0;

  return (
    <View style={styles.card}>
      {/* Header + tabs */}
      <View style={styles.predHeader}>
        <Text style={styles.sectionTitle}>My Predictions</Text>
        <View style={styles.predTabs}>
          <Pressable
            style={[styles.predTab, tab === "bets" && styles.predTabActive]}
            onPress={() => setTab("bets")}
          >
            <Text style={[styles.predTabText, tab === "bets" && styles.predTabTextActive]}>
              Bets {positions.length > 0 ? `(${positions.length})` : ""}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.predTab, tab === "polls" && styles.predTabActive]}
            onPress={() => setTab("polls")}
          >
            <Text style={[styles.predTabText, tab === "polls" && styles.predTabTextActive]}>
              Polls {votes.length > 0 ? `(${votes.length})` : ""}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Category accuracy — polls tab only */}
      {tab === "polls" && categoryStats.length > 0 && (
        <View style={styles.categoryStatsRow}>
          {categoryStats.slice(0, 4).map((cs) => (
            <View key={cs.category} style={styles.catStatBox}>
              <Text style={styles.catStatValue}>{cs.accuracyScore.toFixed(0)}%</Text>
              <Text style={styles.catStatLabel}>{cs.category.slice(0, 4)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Fixed-height scrollable list */}
      <ScrollView
        style={styles.predScroll}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        {tab === "bets" ? (
          hasBets ? (
            positions.map((pos) => {
              const sm = getStatusMeta(pos.market.status);
              return (
                <Pressable
                  key={pos.id}
                  style={({ pressed }) => [styles.trackRow, pressed && styles.trackRowPressed]}
                  onPress={() => router.push(`/market/${pos.market.id}`)}
                >
                  <View style={styles.trackRowLeft}>
                    <Text style={styles.trackTitle}>
                      {pos.market.title}
                    </Text>
                    <View style={styles.trackMeta}>
                      <View style={[styles.statusPill, { backgroundColor: sm.bg }]}>
                        <Text style={[styles.statusPillText, { color: sm.color }]}>
                          {sm.label}
                        </Text>
                      </View>
                      {pos.side != null && (
                        <View
                          style={[
                            styles.sidePillSmall,
                            pos.side === "YES" ? styles.sideYes : styles.sideNo,
                          ]}
                        >
                          <Text
                            style={[
                              styles.sidePillSmallText,
                              { color: pos.side === "YES" ? "#059669" : "#DC2626" },
                            ]}
                          >
                            {pos.side}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={styles.betAmountWrap}>
                    <Text style={styles.betAmount}>{pos.amount.toLocaleString()}</Text>
                    <Text style={styles.betAmountLabel}>pts staked</Text>
                  </View>
                </Pressable>
              );
            })
          ) : (
            <View style={styles.predEmpty}>
              <Text style={styles.predEmptyText}>No bets yet.</Text>
              <Text style={styles.predEmptyHint}>
                Head to the Markets tab to stake points.
              </Text>
            </View>
          )
        ) : hasPolls ? (
          votes.map((vote) => {
            const sm = getStatusMeta(vote.market.status);
            const total = vote.market.yesCount + vote.market.noCount;
            const crowdYesPct = total > 0 ? Math.round((vote.market.yesCount / total) * 100) : 50;
            const userSide = vote.side ?? (vote.numericValue != null ? String(vote.numericValue) : "?");
            const agreedWithCrowd =
              (vote.side === "YES" && crowdYesPct >= 50) ||
              (vote.side === "NO" && crowdYesPct < 50);

            return (
              <Pressable
                key={vote.id}
                style={({ pressed }) => [styles.trackRow, pressed && styles.trackRowPressed]}
                onPress={() => router.push(`/market/${vote.market.id}`)}
              >
                <View style={styles.trackRowLeft}>
                  <Text style={styles.trackTitle}>
                    {vote.market.title}
                  </Text>
                  <View style={styles.trackMeta}>
                    <View style={[styles.statusPill, { backgroundColor: sm.bg }]}>
                      <Text style={[styles.statusPillText, { color: sm.color }]}>{sm.label}</Text>
                    </View>
                    {vote.side != null && (
                      <Text style={styles.trackVote}>
                        You:{" "}
                        <Text style={{ fontWeight: "700", color: vote.side === "YES" ? "#059669" : "#DC2626" }}>
                          {userSide}
                        </Text>
                      </Text>
                    )}
                    {total > 0 && vote.side != null && (
                      <Text style={[styles.trackCrowd, agreedWithCrowd && styles.trackCrowdAgree]}>
                        {agreedWithCrowd ? "↑ With crowd" : "↓ Contrarian"}
                      </Text>
                    )}
                  </View>
                </View>
                <View style={styles.trackBarWrap}>
                  <View style={styles.miniBarTrack}>
                    <View style={[styles.miniBarYes, { width: `${crowdYesPct}%` }]} />
                  </View>
                  <Text style={styles.miniBarLabel}>{crowdYesPct}% YES</Text>
                </View>
              </Pressable>
            );
          })
        ) : (
          <View style={styles.predEmpty}>
            <Text style={styles.predEmptyText}>No polls voted yet.</Text>
            <Text style={styles.predEmptyHint}>
              Swipe through the feed and share your opinion.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ── LeaderboardSection ────────────────────────────────────────────────────────

function LeaderboardSection({ currentUserId }: { currentUserId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [category, setCategory] = useState<AppMarketCategory | undefined>(undefined);

  const fetcher = useCallback(
    () => mobileApi.getLeaderboard({ category }),
    [category]
  );
  const { data, loading } = useApiQuery<{ entries: ApiLeaderboardEntry[] }>(
    fetcher,
    [category],
    { enabled: expanded }
  );

  const entries = data?.entries ?? [];

  return (
    <View style={styles.card}>
      <Pressable style={styles.sectionTitleRow} onPress={() => setExpanded((v) => !v)}>
        <Text style={styles.sectionTitle}>🏆 Leaderboard</Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.textMuted}
        />
      </Pressable>

      {expanded && (
        <>
          {/* Category filter */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.lbTabs}
          >
            {LEADERBOARD_CATEGORIES.map((cat) => (
              <Pressable
                key={cat.label}
                style={[styles.lbTab, category === cat.value && styles.lbTabActive]}
                onPress={() => setCategory(cat.value)}
              >
                <Text style={[styles.lbTabLabel, category === cat.value && styles.lbTabLabelActive]}>
                  {cat.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.lg }} />
          ) : (
            <View style={styles.lbList}>
              {entries.slice(0, 10).map((entry, i) => {
                const raw = entry as Record<string, unknown>;
                const userObj = (raw.user ?? raw) as Record<string, unknown>;
                const username = String(userObj.username ?? "unknown");
                const rep = Number(userObj.reputationScore ?? 0);
                const isCurrentUser = String(userObj.id ?? raw.id ?? "") === currentUserId;
                const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;

                return (
                  <View
                    key={String(i)}
                    style={[
                      styles.lbRow,
                      isCurrentUser && styles.lbRowHighlight,
                    ]}
                  >
                    <Text style={styles.lbRank}>
                      {medal ?? `#${i + 1}`}
                    </Text>
                    <View style={styles.lbUserInfo}>
                      <Text style={[styles.lbUsername, isCurrentUser && styles.lbUsernameSelf]}>
                        @{username}{isCurrentUser ? " (you)" : ""}
                      </Text>
                      <Text style={styles.lbScore}>{rep.toLocaleString()} rep</Text>
                    </View>
                  </View>
                );
              })}
              {entries.length === 0 && (
                <Text style={styles.emptyHint}>No entries yet.</Text>
              )}
            </View>
          )}
        </>
      )}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
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

function GroupsAccordion({
  groups,
}: {
  groups: Array<ApiGroupSummary & { memberCount?: number; marketCount?: number }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <View style={styles.grpCard}>
      <Pressable style={styles.grpHeader} onPress={() => setExpanded((prev) => !prev)}>
        <View style={styles.grpHeaderLeft}>
          <Ionicons name="people" size={20} color={colors.accent} />
          <Text style={styles.grpHeaderLabel}>
            {groups.length} {groups.length === 1 ? "Group" : "Groups"}
          </Text>
        </View>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
      </Pressable>
      {expanded && (
        <View style={styles.grpList}>
          {groups.map((g) => {
            const isSelected = selectedId === g.id;
            return (
              <View key={g.id}>
                <Pressable
                  style={[styles.grpRow, isSelected && styles.grpRowActive]}
                  onPress={() => setSelectedId(isSelected ? null : g.id)}
                >
                  <View style={styles.grpRowLeft}>
                    <Text style={styles.grpRowName} numberOfLines={1}>{g.name}</Text>
                    <View style={styles.grpRowMeta}>
                      {g.memberCount != null && (
                        <Text style={styles.grpRowMetaText}>{g.memberCount} members</Text>
                      )}
                      {g.marketCount != null && (
                        <Text style={styles.grpRowMetaText}> · {g.marketCount} markets</Text>
                      )}
                    </View>
                  </View>
                  <Ionicons name={isSelected ? "chevron-up" : "chevron-down"} size={14} color={colors.textMuted} />
                </Pressable>
                {isSelected && g.inviteCode && (
                  <View style={styles.grpDetail}>
                    {g.description ? (
                      <Text style={styles.grpDetailDesc}>{g.description}</Text>
                    ) : null}
                    <Pressable
                      style={styles.grpInviteRow}
                      onPress={() => Alert.alert("Invite Code", g.inviteCode!, [{ text: "OK" }])}
                    >
                      <Ionicons name="link-outline" size={14} color={colors.accent} />
                      <Text style={styles.grpInviteLabel}>Invite:</Text>
                      <Text style={styles.grpInviteCode}>{g.inviteCode}</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.xl, paddingBottom: 60 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  title: { fontSize: 28, fontWeight: "700", color: colors.text },
  subtitle: { marginTop: spacing.md, fontSize: 15, color: colors.textMuted, textAlign: "center", lineHeight: 22 },
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
    borderRadius: radius.lg,
    padding: spacing.xl,
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
  statsRow: { flexDirection: "row", marginTop: spacing.lg, gap: spacing.sm },
  statBox: {
    flex: 1,
    alignItems: "center",
    padding: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: radius.md,
  },
  statValue: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
  statLabel: { fontSize: 10, color: "rgba(255,255,255,0.6)", marginTop: 2 },
  repRow: { marginTop: spacing.lg, gap: 6 },
  repLabel: { fontSize: 12, color: "rgba(255,255,255,0.6)", fontWeight: "600" },
  repBarTrack: { height: 4, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.15)", overflow: "hidden" },
  repBarFill: { height: "100%", borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.8)" },

  // ── Generic card ──
  card: {
    marginTop: spacing.lg,
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

  // ── Badges ──
  badgesGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  badgeCard: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    minWidth: 80,
    alignItems: "center",
    gap: 3,
  },
  badgeEmoji: { fontSize: 24 },
  badgeName: { fontSize: 12, fontWeight: "700", textAlign: "center" },
  badgeDesc: { fontSize: 10, color: colors.textMuted, textAlign: "center", lineHeight: 14 },

  // ── Predictions (Bets / Polls) ──
  predHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  predTabs: {
    flexDirection: "row",
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: 2,
  },
  predTab: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.sm,
  },
  predTabActive: {
    backgroundColor: colors.text,
  },
  predTabText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  predTabTextActive: {
    color: "#FFFFFF",
  },
  predScroll: {
    maxHeight: 280,
    marginTop: spacing.sm,
  },
  predEmpty: {
    paddingVertical: spacing.xl,
    alignItems: "center",
  },
  predEmptyText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
  },
  predEmptyHint: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
  },
  sidePillSmall: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  sideYes: { backgroundColor: "#ECFDF5" },
  sideNo: { backgroundColor: "#FFF1F2" },
  sidePillSmallText: { fontSize: 10, fontWeight: "700" },
  betAmountWrap: { alignItems: "center", minWidth: 56 },
  betAmount: { fontSize: 15, fontWeight: "700", color: colors.text },
  betAmountLabel: { fontSize: 9, color: colors.textMuted, marginTop: 1 },

  // ── Track record (shared row styles) ──
  categoryStatsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  catStatBox: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
  },
  catStatValue: { fontSize: 16, fontWeight: "700", color: colors.text },
  catStatLabel: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  trackRecordList: { gap: spacing.sm, marginTop: spacing.sm },
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
  trackCrowdAgree: { color: "#059669" },
  trackBarWrap: { alignItems: "center", width: 60 },
  miniBarTrack: { width: 52, height: 5, borderRadius: radius.pill, backgroundColor: "#FEE2E2", overflow: "hidden" },
  miniBarYes: { height: "100%", borderRadius: radius.pill, backgroundColor: "#059669" },
  miniBarLabel: { fontSize: 10, color: colors.textMuted, marginTop: 3 },

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

  // ── Leaderboard ──
  lbTabs: { gap: spacing.sm, paddingVertical: spacing.md },
  lbTab: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lbTabActive: { backgroundColor: colors.text, borderColor: colors.text },
  lbTabLabel: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
  lbTabLabelActive: { color: "#FFFFFF" },
  lbList: { gap: spacing.sm },
  lbRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  lbRowHighlight: { backgroundColor: "#EFF6FF", borderWidth: 1, borderColor: colors.accent },
  lbRank: { fontSize: 18, width: 40, textAlign: "center" },
  lbUserInfo: { flex: 1 },
  lbUsername: { fontSize: 14, fontWeight: "600", color: colors.text },
  lbUsernameSelf: { color: colors.accent },
  lbScore: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  emptyHint: { textAlign: "center", color: colors.textMuted, paddingVertical: spacing.md },

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
    marginTop: spacing.lg,
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

  // ── Groups ──
  grpCard: { marginTop: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.lg, overflow: "hidden" },
  grpHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg },
  grpHeaderLeft: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  grpHeaderLabel: { fontSize: 15, fontWeight: "700", color: colors.text },
  grpList: { borderTopWidth: 1, borderTopColor: colors.border },
  grpRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  grpRowActive: { backgroundColor: colors.accent + "08" },
  grpRowLeft: { flex: 1, marginRight: spacing.sm },
  grpRowName: { fontSize: 14, fontWeight: "600", color: colors.text },
  grpRowMeta: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  grpRowMetaText: { fontSize: 12, color: colors.textMuted },
  grpDetail: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.background },
  grpDetailDesc: { fontSize: 13, color: colors.textMuted, lineHeight: 18, paddingTop: spacing.sm },
  grpInviteRow: {
    flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm,
    backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.md, alignSelf: "flex-start",
  },
  grpInviteLabel: { fontSize: 12, color: colors.textMuted },
  grpInviteCode: { fontSize: 13, fontWeight: "700", color: colors.accent, fontFamily: "Courier" },

  // ── Log out ──
  logoutBtn: {
    marginTop: spacing.xl,
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
