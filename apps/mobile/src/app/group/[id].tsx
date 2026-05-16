import * as Clipboard from "expo-clipboard";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { formatPoints, formatRelativeTime } from "@predict-future/utils";
import { colors, radius, shadows, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";

// ── Types ────────────────────────────────────────────────────────────

type GroupMember = {
  id: string;
  userId: string;
  role: string;
  joinedAt: string;
  user: { username: string; reputationScore: number };
};

type GroupMarket = {
  id: string;
  title: string;
  status: string;
  totalVolume?: number;
  totalParticipants?: number;
  closeAt?: string;
  creator?: { username: string };
};

type GroupData = {
  id: string;
  name: string;
  description?: string | null;
  ownerId: string;
  inviteCode?: string;
  owner?: { username: string };
  memberships?: GroupMember[];
  markets?: GroupMarket[];
};

// ── Status buckets ────────────────────────────────────────────────────

const LIVE_STATUSES = new Set(["OPEN"]);
const AWAITING_STATUSES = new Set(["CLOSED", "AWAITING_RESOLUTION"]);
const SETTLED_STATUSES = new Set(["RESOLVED", "CANCELLED", "HOST_TIMEOUT", "RESOLVING"]);
const LAUNCHABLE_STATUSES = new Set(["DRAFT", "PENDING_REVIEW"]);

function normalizeParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" && value.length > 0 ? value : null;
}

// ── Screen ────────────────────────────────────────────────────────────

export default function GroupDetailScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const groupId = normalizeParam(params.id);

  const fetcher = useCallback(
    () => mobileApi.getGroupById(groupId as string),
    [groupId]
  );

  const { data, status, error, refetch } = useApiQuery(fetcher, [groupId], {
    enabled: Boolean(groupId),
    errorFallback: "Unable to load group.",
  });

  const group = data ? (data as { group: GroupData }).group : null;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: group?.name ?? "Group",
        }}
      />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        {!groupId ? (
          <Text style={styles.errorText}>Missing group id.</Text>
        ) : status === "loading" || status === "idle" ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
        ) : status === "error" ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Could not load group</Text>
            <Text style={styles.muted}>{error}</Text>
            <Pressable onPress={refetch} style={styles.retryBtn}>
              <Text style={styles.retryLabel}>Retry</Text>
            </Pressable>
          </View>
        ) : group ? (
          <GroupBody group={group} groupId={groupId} onRefresh={refetch} />
        ) : (
          <Text style={styles.errorText}>Group not found.</Text>
        )}
      </ScrollView>
    </>
  );
}

// ── Body ─────────────────────────────────────────────────────────────

function GroupBody({
  group,
  groupId,
  onRefresh,
}: {
  group: GroupData;
  groupId: string;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const { session } = useSession();
  const [launching, setLaunching] = useState(false);

  const isOwner = session?.userId != null && session.userId === group.ownerId;
  const markets = group.markets ?? [];
  const memberships = group.memberships ?? [];

  const liveMarkets = markets.filter((m) => LIVE_STATUSES.has(m.status));
  const awaitingMarkets = markets.filter((m) => AWAITING_STATUSES.has(m.status));
  const settledMarkets = markets.filter((m) => SETTLED_STATUSES.has(m.status));
  const launchableCount = markets.filter((m) => LAUNCHABLE_STATUSES.has(m.status)).length;

  const canLaunch = isOwner && launchableCount > 0;

  async function handleLaunch() {
    if (launching) return;
    setLaunching(true);
    try {
      const result = await mobileApi.launchGroup(groupId);
      Alert.alert(
        "Matchday started!",
        `${result.launched} ${result.launched === 1 ? "market" : "markets"} are now live.`,
        [{ text: "OK", onPress: onRefresh }]
      );
    } catch (err: unknown) {
      Alert.alert(
        "Launch failed",
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
    } finally {
      setLaunching(false);
    }
  }

  async function handleCopyInviteCode() {
    if (!group.inviteCode) return;
    try {
      await Clipboard.setStringAsync(group.inviteCode);
      Alert.alert("Copied!", "Invite code copied to clipboard.");
    } catch {
      Alert.alert("Invite Code", group.inviteCode);
    }
  }

  return (
    <View style={styles.container}>
      {/* Header card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{group.name}</Text>
        {group.description ? (
          <Text style={styles.subtitle}>{group.description}</Text>
        ) : null}

        <View style={styles.metaRow}>
          {group.owner?.username ? (
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Host</Text>
              <Text style={styles.metaValue}>@{group.owner.username}</Text>
            </View>
          ) : null}
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Members</Text>
            <Text style={styles.metaValue}>{memberships.length}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Markets</Text>
            <Text style={styles.metaValue}>{markets.length}</Text>
          </View>
        </View>

        {group.inviteCode ? (
          <Pressable style={styles.inviteRow} onPress={handleCopyInviteCode}>
            <View style={styles.inviteCodeBox}>
              <Text style={styles.inviteLabel}>Invite Code</Text>
              <Text style={styles.inviteCode}>{group.inviteCode}</Text>
            </View>
            <View style={styles.copyBtn}>
              <Text style={styles.copyBtnText}>Copy</Text>
            </View>
          </Pressable>
        ) : null}
      </View>

      {/* Start Matchday button — owner only, when launchable markets exist */}
      {canLaunch ? (
        <Pressable
          style={[styles.launchBtn, launching && styles.btnDisabled]}
          onPress={handleLaunch}
          disabled={launching}
        >
          {launching ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.launchBtnText}>Start Matchday</Text>
              <Text style={styles.launchBtnSub}>
                Launch {launchableCount} pending {launchableCount === 1 ? "market" : "markets"}
              </Text>
            </>
          )}
        </Pressable>
      ) : null}

      {/* Live markets */}
      <MarketSection
        title="Live"
        accent="#16A34A"
        markets={liveMarkets}
        renderItem={(m) => (
          <Pressable
            key={m.id}
            style={styles.marketRow}
            onPress={() => router.push(`/market/${m.id}`)}
          >
            <View style={styles.marketRowContent}>
              <Text style={styles.marketTitle} numberOfLines={2}>{m.title}</Text>
              <View style={styles.marketMeta}>
                {m.totalParticipants != null ? (
                  <Text style={styles.marketMetaText}>{m.totalParticipants} players</Text>
                ) : null}
                {m.closeAt ? (
                  <Text style={styles.marketMetaText}>Closes {formatRelativeTime(m.closeAt)}</Text>
                ) : null}
                {m.totalVolume != null ? (
                  <Text style={styles.marketMetaText}>{formatPoints(m.totalVolume)} pts</Text>
                ) : null}
              </View>
            </View>
            <View style={[styles.statusDot, { backgroundColor: "#16A34A" }]} />
          </Pressable>
        )}
      />

      {/* Awaiting Resolution markets */}
      <MarketSection
        title="Awaiting Resolution"
        accent="#D97706"
        markets={awaitingMarkets}
        renderItem={(m) => (
          <Pressable
            key={m.id}
            style={styles.marketRow}
            onPress={() => router.push(`/market/${m.id}`)}
          >
            <View style={styles.marketRowContent}>
              <Text style={styles.marketTitle} numberOfLines={2}>{m.title}</Text>
              <View style={styles.awaitingBadge}>
                <Text style={styles.awaitingBadgeText}>Needs resolution</Text>
              </View>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        )}
      />

      {/* Settled markets */}
      <MarketSection
        title="Settled"
        accent={colors.textMuted}
        markets={settledMarkets}
        renderItem={(m) => (
          <View key={m.id} style={styles.marketRow}>
            <View style={styles.marketRowContent}>
              <Text style={[styles.marketTitle, styles.marketTitleMuted]} numberOfLines={2}>
                {m.title}
              </Text>
            </View>
            <StatusBadge status={m.status} />
          </View>
        )}
      />

      {/* Members */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Members</Text>
        {memberships.length === 0 ? (
          <Text style={styles.noneYet}>No members yet.</Text>
        ) : (
          memberships.map((membership) => (
            <View key={membership.id} style={styles.memberRow}>
              <View style={styles.memberLeft}>
                <Text style={styles.memberUsername}>@{membership.user.username}</Text>
                {membership.role !== "MEMBER" ? (
                  <View style={styles.rolePill}>
                    <Text style={styles.rolePillText}>{membership.role}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.memberRep}>
                {formatPoints(membership.user.reputationScore)} rep
              </Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function MarketSection({
  title,
  accent,
  markets,
  renderItem,
}: {
  title: string;
  accent: string;
  markets: GroupMarket[];
  renderItem: (m: GroupMarket) => React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionAccentBar, { backgroundColor: accent }]} />
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.sectionCountBadge}>
          <Text style={styles.sectionCountText}>{markets.length}</Text>
        </View>
      </View>
      {markets.length === 0 ? (
        <Text style={styles.noneYet}>None yet.</Text>
      ) : (
        markets.map(renderItem)
      )}
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_BADGE_CONFIG[status] ?? { label: status, bg: "#F3F4F6", text: "#6B7280" };
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <Text style={[styles.badgeText, { color: config.text }]}>{config.label}</Text>
    </View>
  );
}

const STATUS_BADGE_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  RESOLVED: { label: "Resolved", bg: "#DCFCE7", text: "#15803D" },
  RESOLVING: { label: "Resolving", bg: "#DBEAFE", text: "#1D4ED8" },
  CANCELLED: { label: "Cancelled", bg: "#F3F4F6", text: "#6B7280" },
  HOST_TIMEOUT: { label: "Timed Out", bg: "#FEF3C7", text: "#92400E" },
};

// ── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 100,
  },
  container: {
    gap: spacing.lg,
  },
  centerState: {
    paddingTop: 100,
    alignItems: "center",
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
  },

  // Cards
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    ...shadows.card,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.text,
    lineHeight: 28,
  },
  subtitle: {
    marginTop: spacing.sm,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
  },

  // Meta row in header card
  metaRow: {
    marginTop: spacing.xl,
    flexDirection: "row",
    gap: spacing.xl,
  },
  metaItem: {
    alignItems: "center",
    minWidth: 60,
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  metaValue: {
    marginTop: 3,
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },

  // Invite code
  inviteRow: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#C7D2FE",
  },
  inviteCodeBox: {
    flex: 1,
  },
  inviteLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6366F1",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  inviteCode: {
    marginTop: 2,
    fontSize: 18,
    fontWeight: "800",
    color: "#4F46E5",
    letterSpacing: 2,
  },
  copyBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: "#4F46E5",
  },
  copyBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },

  // Launch button
  launchBtn: {
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: "#16A34A",
    alignItems: "center",
    gap: spacing.xs,
    ...shadows.card,
  },
  launchBtnText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.3,
  },
  launchBtnSub: {
    fontSize: 13,
    fontWeight: "500",
    color: "rgba(255,255,255,0.8)",
  },
  btnDisabled: {
    opacity: 0.5,
  },

  // Section headers
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionAccentBar: {
    width: 3,
    height: 16,
    borderRadius: 2,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.text,
    flex: 1,
  },
  sectionCountBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: "#F1F5F9",
  },
  sectionCountText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
  },
  noneYet: {
    fontSize: 14,
    color: colors.textMuted,
    fontStyle: "italic",
  },

  // Market rows
  marketRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  marketRowContent: {
    flex: 1,
    gap: 4,
  },
  marketTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    lineHeight: 20,
  },
  marketTitleMuted: {
    color: colors.textMuted,
  },
  marketMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  marketMetaText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  awaitingBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: "#FEF3C7",
  },
  awaitingBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#92400E",
  },
  chevron: {
    fontSize: 20,
    color: colors.textMuted,
    lineHeight: 22,
  },

  // Status badge
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },

  // Members
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  memberLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flex: 1,
  },
  memberUsername: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  rolePill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: "#EEF2FF",
  },
  rolePillText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#4F46E5",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  memberRep: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
  },

  // Retry
  retryBtn: {
    marginTop: spacing.lg,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  retryLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.surface,
  },
  muted: {
    marginTop: spacing.sm,
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },
});
