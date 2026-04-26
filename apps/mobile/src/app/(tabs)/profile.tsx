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

import type { ApiGroupSummary, ApiMyProfile } from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";

export default function ProfileScreen() {
  const router = useRouter();
  const { session, status: sessionStatus, signOut } = useSession();
  const userId = session?.userId;

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
            Sign in to view your profile. For local dev, set{" "}
            <Text style={styles.code}>EXPO_PUBLIC_DEMO_USER_ID</Text>.
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
        <Text style={styles.username}>@{user.username}</Text>
        <View style={styles.tagRow}>
          {user.level != null && <Tag label={`Lv ${user.level}`} />}
          <Tag label={`${user.reputationScore} rep`} />
          {(user.streak ?? 0) > 0 && <Tag label={`${user.streak} streak`} accent />}
        </View>

        <View style={styles.statsRow}>
          <Stat label="Accuracy" value={`${(user.accuracyScore ?? 0).toFixed(1)}%`} />
          <Stat label="Predictions" value={String(stats?.totalPredictions ?? 0)} />
          <Stat label="Net Pts" value={String(stats?.totalNetPoints ?? 0)} />
          <Stat label="Balance" value={String(user.wallet?.balance ?? 0)} />
        </View>
      </View>

      {/* ── Quick Actions ── */}
      <View style={styles.actionsCard}>
        <ActionRow
          icon="notifications-outline"
          label="Notifications"
          onPress={() => router.push("/notifications")}
        />
        <View style={styles.divider} />
        <ActionRow
          icon="trophy-outline"
          label="Leaderboard"
          onPress={() => router.push("/(tabs)/leaderboard")}
        />
        {user.hostStats && (
          <>
            <View style={styles.divider} />
            <ActionRow
              icon="shield-checkmark-outline"
              label={`Host Trust: ${user.hostStats.hostTrustScore}`}
              sublabel={`${user.hostStats.validFinalizedHostedMarketsCount} markets hosted`}
            />
          </>
        )}
      </View>

      {/* ── Groups ── */}
      {groups.length > 0 && <GroupsAccordion groups={groups} />}

      {/* ── Badges ── */}
      {user.badges && user.badges.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Badges</Text>
          <View style={styles.badgesWrap}>
            {user.badges.map((ub) => (
              <View key={ub.badge.id} style={styles.earnedBadge}>
                <Text style={styles.earnedBadgeText}>{ub.badge.name}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ── Activity ── */}
      {(user.positions?.length ?? 0) > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          {user.positions!.slice(0, 5).map((p) => (
            <View key={p.id} style={styles.listRow}>
              <Text style={styles.listTitle} numberOfLines={1}>
                {p.market.title}
              </Text>
              <Text style={styles.listMeta}>
                {p.side} · {p.amount} pts
              </Text>
            </View>
          ))}
        </View>
      )}

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

/* ── Sub-components ── */

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
  const selected = groups.find((g) => g.id === selectedId);

  return (
    <View style={styles.grpCard}>
      {/* Header — always visible */}
      <Pressable style={styles.grpHeader} onPress={() => setExpanded((prev) => !prev)}>
        <View style={styles.grpHeaderLeft}>
          <Ionicons name="people" size={20} color={colors.accent} />
          <Text style={styles.grpHeaderLabel}>
            {groups.length} {groups.length === 1 ? "Group" : "Groups"}
          </Text>
        </View>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.textMuted}
        />
      </Pressable>

      {/* Expanded list */}
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
                    <Text style={styles.grpRowName} numberOfLines={1}>
                      {g.name}
                    </Text>
                    <View style={styles.grpRowMeta}>
                      {g.memberCount != null && (
                        <Text style={styles.grpRowMetaText}>
                          {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
                        </Text>
                      )}
                      {g.marketCount != null && (
                        <>
                          <Text style={styles.grpRowDot}> · </Text>
                          <Text style={styles.grpRowMetaText}>
                            {g.marketCount} {g.marketCount === 1 ? "market" : "markets"}
                          </Text>
                        </>
                      )}
                    </View>
                  </View>
                  <Ionicons
                    name={isSelected ? "chevron-up" : "chevron-down"}
                    size={14}
                    color={colors.textMuted}
                  />
                </Pressable>

                {/* Detail panel */}
                {isSelected && (
                  <View style={styles.grpDetail}>
                    {g.description ? (
                      <Text style={styles.grpDetailDesc}>{g.description}</Text>
                    ) : null}
                    {g.inviteCode ? (
                      <Pressable
                        style={styles.grpInviteRow}
                        onPress={() =>
                          Alert.alert("Invite Code", g.inviteCode!, [{ text: "OK" }])
                        }
                      >
                        <Ionicons name="link-outline" size={14} color={colors.accent} />
                        <Text style={styles.grpInviteLabel}>Invite:</Text>
                        <Text style={styles.grpInviteCode}>{g.inviteCode}</Text>
                      </Pressable>
                    ) : null}
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

/* ── Styles ── */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.xl, paddingBottom: 60 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  title: { fontSize: 28, fontWeight: "700", color: colors.text },
  subtitle: {
    marginTop: spacing.md,
    fontSize: 15,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 22,
  },
  code: { fontFamily: "Courier" },
  errorText: { color: colors.danger, fontSize: 14 },
  retryBtn: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  retryLabel: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },

  // Header
  headerCard: {
    backgroundColor: colors.text,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  username: { fontSize: 24, fontWeight: "700", color: "#FFFFFF" },
  tagRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  tagAccent: { backgroundColor: "rgba(251,191,36,0.3)" },
  tagText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
  statsRow: {
    flexDirection: "row",
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  statBox: {
    flex: 1,
    alignItems: "center",
    padding: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: radius.md,
  },
  statValue: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
  statLabel: { fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 2 },

  // Actions card
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
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.lg },

  // Generic card
  card: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.md,
  },

  // Groups accordion
  grpCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  grpHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.lg,
  },
  grpHeaderLeft: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  grpHeaderLabel: { fontSize: 15, fontWeight: "700", color: colors.text },
  grpList: { borderTopWidth: 1, borderTopColor: colors.border },
  grpRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  grpRowActive: { backgroundColor: colors.accent + "08" },
  grpRowLeft: { flex: 1, marginRight: spacing.sm },
  grpRowName: { fontSize: 14, fontWeight: "600", color: colors.text },
  grpRowMeta: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  grpRowMetaText: { fontSize: 12, color: colors.textMuted },
  grpRowDot: { fontSize: 12, color: colors.textMuted },
  grpDetail: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.background,
  },
  grpDetailDesc: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
    paddingTop: spacing.sm,
  },
  grpInviteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignSelf: "flex-start",
  },
  grpInviteLabel: { fontSize: 12, color: colors.textMuted },
  grpInviteCode: { fontSize: 13, fontWeight: "700", color: colors.accent, fontFamily: "Courier" },

  // Badges
  badgesWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  earnedBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  earnedBadgeText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },

  // Activity list
  listRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  listTitle: { fontSize: 14, color: colors.text, fontWeight: "500" },
  listMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  // Log out
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
