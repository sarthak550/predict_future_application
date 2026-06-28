import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { radius, spacing } from "@predict-future/ui-tokens";
import { formatRelativeTime } from "@predict-future/utils";

import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";
import type { ApiGroupMember } from "@predict-future/types";

// ── Types ─────────────────────────────────────────────────────────────

function normalizeParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" && value.length > 0 ? value : null;
}

// ── Screen ────────────────────────────────────────────────────────────

export default function GroupMembersScreen() {
  const params = useLocalSearchParams<{ id: string | string[]; mode?: string | string[] }>();
  const groupId = normalizeParam(params.id);
  const modeParam = normalizeParam(params.mode);
  const router = useRouter();
  const { session } = useSession();
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const [members, setMembers] = useState<ApiGroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callerRole, setCallerRole] = useState<string | null>(null);
  const [callerOwnerId, setCallerOwnerId] = useState<string | null>(null);

  // S57: transfer mode — active when mode=transfer query param is present AND caller is OWNER.
  // Non-OWNER callers landing with mode=transfer see normal mode (guard applied in render).
  const isTransferMode = modeParam === "transfer";

  const loadMembers = useCallback(
    async (reset = false) => {
      if (!groupId) return;
      if (reset) setLoading(true);
      setError(null);
      try {
        const res = await mobileApi.getGroupMembers(groupId, {
          limit: 20
        });
        if (reset) {
          setMembers(res.members);
        } else {
          setMembers((prev) => [...prev, ...res.members]);
        }
        setNextCursor(res.nextCursor);
        // Derive caller role from member list
        if (session?.userId) {
          const caller = res.members.find((m) => m.userId === session.userId);
          if (caller) {
            setCallerRole(caller.role);
          }
          // Owner is the OWNER-role member
          const owner = res.members.find((m) => m.role === "OWNER");
          if (owner) setCallerOwnerId(owner.userId);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load members.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [groupId, session?.userId]
  );

  // Initial load
  useEffect(() => {
    void loadMembers(true);
  }, [loadMembers]);

  async function handleLoadMore() {
    if (!nextCursor || loadingMore || !groupId) return;
    setLoadingMore(true);
    try {
      const res = await mobileApi.getGroupMembers(groupId, {
        cursor: nextCursor,
        limit: 20
      });
      setMembers((prev) => [...prev, ...res.members]);
      setNextCursor(res.nextCursor);
    } catch {
      // Silently fail load-more
    } finally {
      setLoadingMore(false);
    }
  }

  const isAdminOrOwner =
    callerRole === "OWNER" || callerRole === "ADMIN";

  async function handleRemoveMember(member: ApiGroupMember) {
    if (!groupId) return;
    Alert.alert(
      "Remove member",
      `Remove @${member.user.username} from this group?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await mobileApi.removeGroupMember(groupId, member.userId);
              setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
            } catch (err: unknown) {
              Alert.alert(
                "Error",
                err instanceof Error ? err.message : "Could not remove member."
              );
            }
          }
        }
      ]
    );
  }

  async function handleBanMember(member: ApiGroupMember) {
    if (!groupId) return;
    Alert.prompt(
      "Ban user",
      `Reason (optional) for banning @${member.user.username}:`,
      async (reason) => {
        try {
          await mobileApi.banGroupMember(groupId, {
            userId: member.userId,
            reason: reason ?? undefined
          });
          // Update row to show as banned
          setMembers((prev) =>
            prev.map((m) =>
              m.userId === member.userId
                ? { ...m, bannedAt: new Date().toISOString() }
                : m
            )
          );
        } catch (err: unknown) {
          Alert.alert(
            "Error",
            err instanceof Error ? err.message : "Could not ban user."
          );
        }
      },
      "plain-text",
      "",
      "default"
    );
  }

  async function handleUnbanMember(member: ApiGroupMember) {
    if (!groupId) return;
    Alert.alert(
      "Unban user",
      `Remove ban for @${member.user.username}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unban",
          onPress: async () => {
            try {
              await mobileApi.unbanGroupMember(groupId, { userId: member.userId });
              setMembers((prev) =>
                prev.map((m) =>
                  m.userId === member.userId ? { ...m, bannedAt: null } : m
                )
              );
            } catch (err: unknown) {
              Alert.alert(
                "Error",
                err instanceof Error ? err.message : "Could not unban user."
              );
            }
          }
        }
      ]
    );
  }

  // S57: Transfer ownership to a selected member (transfer mode only).
  async function handleTransferTo(member: ApiGroupMember) {
    if (!groupId) return;
    Alert.alert(
      "Transfer ownership?",
      `Transfer ownership of this group to @${member.user.username}? You will become an admin.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Transfer",
          // Default (not destructive) — this is a deliberate power handoff, not a danger.
          onPress: async () => {
            try {
              await mobileApi.transferOwnership(groupId, { newOwnerId: member.userId });
              // Navigate back to group profile. The group detail will reload and the
              // caller's memberStatus will now be "admin".
              router.replace(`/group/${groupId}`);
            } catch (err: unknown) {
              const code =
                err != null && typeof err === "object" && "code" in err
                  ? (err as { code: unknown }).code
                  : undefined;
              if (code === "ineligible_target") {
                Alert.alert("Cannot transfer", "This member cannot receive ownership.");
              } else {
                Alert.alert(
                  "Transfer failed",
                  err instanceof Error ? err.message : "Something went wrong."
                );
              }
            }
          }
        }
      ]
    );
  }

  function showMemberActions(member: ApiGroupMember) {
    const isBanned = member.bannedAt != null;

    const options = isBanned
      ? ["Unban", "Cancel"]
      : ["Remove from group", "Ban user", "Cancel"];

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          destructiveButtonIndex: isBanned ? undefined : 0,
          cancelButtonIndex: options.length - 1
        },
        (index) => {
          if (isBanned && index === 0) void handleUnbanMember(member);
          if (!isBanned && index === 0) void handleRemoveMember(member);
          if (!isBanned && index === 1) void handleBanMember(member);
        }
      );
    } else {
      // Android: simple Alert menu
      if (isBanned) {
        Alert.alert("Actions", `@${member.user.username}`, [
          { text: "Unban", onPress: () => handleUnbanMember(member) },
          { text: "Cancel", style: "cancel" }
        ]);
      } else {
        Alert.alert("Actions", `@${member.user.username}`, [
          {
            text: "Remove from group",
            style: "destructive",
            onPress: () => handleRemoveMember(member)
          },
          { text: "Ban user", onPress: () => handleBanMember(member) },
          { text: "Cancel", style: "cancel" }
        ]);
      }
    }
  }

  const renderItem = ({ item }: { item: ApiGroupMember }) => {
    const isSelf = item.userId === session?.userId;
    const isItemOwner = item.role === "OWNER";
    const isBanned = item.bannedAt != null;
    const canShowKebab = isAdminOrOwner && !isSelf && !isItemOwner && !isTransferMode;

    // S57: in transfer mode, eligible candidates are non-OWNER, non-banned, non-self members.
    // Only the OWNER can be in transfer mode (guard applied in render, not here, for consistency).
    const isTransferCandidate =
      isTransferMode &&
      callerRole === "OWNER" &&
      !isItemOwner &&
      !isBanned &&
      !isSelf;

    return (
      <View
        style={[
          styles.memberRow,
          isBanned && styles.memberRowBanned
        ]}
      >
        {/* Avatar */}
        <View
          style={[
            styles.avatar,
            { backgroundColor: isBanned ? colors.border : colors.accent + "20" }
          ]}
        >
          <Text
            style={[
              styles.avatarLetter,
              { color: isBanned ? colors.textMuted : colors.accent }
            ]}
          >
            {item.user.username.charAt(0).toUpperCase()}
          </Text>
        </View>

        {/* Info */}
        <View style={styles.memberInfo}>
          <View style={styles.memberNameRow}>
            <Text
              style={[
                styles.memberUsername,
                isBanned && styles.memberUsernameMuted
              ]}
            >
              @{item.user.username}
            </Text>
            <RoleBadge role={item.role} />
            {isBanned ? (
              <View style={styles.bannedBadge}>
                <Text style={styles.bannedBadgeText}>Banned</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.joinedAt}>
            {isBanned
              ? "Banned"
              : `Joined ${formatRelativeTime(item.joinedAt)}`}
          </Text>
        </View>

        {/* S57: Transfer mode — show "Make Owner" button for eligible candidates */}
        {isTransferCandidate ? (
          <Pressable
            style={styles.makeOwnerBtn}
            onPress={() => void handleTransferTo(item)}
          >
            <Text style={styles.makeOwnerText}>Make Owner</Text>
          </Pressable>
        ) : canShowKebab ? (
          <Pressable
            style={styles.kebabBtn}
            onPress={() => showMemberActions(item)}
          >
            <Ionicons name="ellipsis-vertical" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
    );
  };

  // S57: In transfer mode, eligible candidates are non-OWNER, non-banned, non-self active members.
  // If the caller is the OWNER in transfer mode and there are no eligible candidates, show empty state.
  const showTransferMode = isTransferMode && callerRole === "OWNER";
  const eligibleCandidates = showTransferMode
    ? members.filter(
        (m) => m.role !== "OWNER" && m.bannedAt == null && m.userId !== session?.userId
      )
    : [];
  const showTransferEmptyState = showTransferMode && !loading && eligibleCandidates.length === 0;

  function handleArchiveFromTransferEmptyState() {
    if (!groupId) return;
    // Navigate back to group detail — the owner can open the archive action from the kebab.
    router.replace(`/group/${groupId}`);
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: showTransferMode ? "Transfer Ownership" : "Members"
        }}
      />
      <View style={styles.screen}>
        {/* S57: Transfer mode banner — shown only to OWNER callers with mode=transfer */}
        {showTransferMode ? (
          <View style={styles.transferBanner}>
            <Text style={styles.transferBannerText}>
              Select a member to transfer ownership to
            </Text>
            <Pressable
              onPress={() => router.replace(`/group/${groupId}`)}
              style={styles.transferCancelBtn}
            >
              <Text style={styles.transferCancelText}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
        ) : error ? (
          <View style={styles.centerState}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => loadMembers(true)} style={styles.retryBtn}>
              <Text style={styles.retryLabel}>Retry</Text>
            </Pressable>
          </View>
        ) : showTransferEmptyState ? (
          // S57: No eligible transfer candidates — owner is the only active member.
          <View style={styles.centerState}>
            <Text style={styles.emptyText}>
              No eligible members to transfer to.
            </Text>
            <Text style={[styles.emptyText, { marginTop: spacing.xs }]}>
              Archive the group instead?
            </Text>
            <Pressable
              style={styles.retryBtn}
              onPress={handleArchiveFromTransferEmptyState}
            >
              <Text style={styles.retryLabel}>Archive Group</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={members}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.centerState}>
                <Text style={styles.emptyText}>No members yet.</Text>
              </View>
            }
            ListFooterComponent={
              nextCursor ? (
                <Pressable
                  style={styles.loadMoreBtn}
                  onPress={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <ActivityIndicator color={colors.accent} size="small" />
                  ) : (
                    <Text style={styles.loadMoreText}>Load more</Text>
                  )}
                </Pressable>
              ) : null
            }
          />
        )}
      </View>
    </>
  );
}

// ── Role Badge ────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  if (role === "MEMBER") return null;
  const config =
    role === "OWNER"
      ? { bg: colors.accentSoft, text: colors.accent }
      : { bg: "#FEF3C7", text: "#92400E" };
  return (
    <View style={[styles.roleBadge, { backgroundColor: config.bg }]}>
      <Text style={[styles.roleBadgeText, { color: config.text }]}>
        {role}
      </Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: t.colors.background
  },
  listContent: {
    padding: spacing.md,
    paddingBottom: 40
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md
  },
  errorText: {
    color: t.colors.danger,
    fontSize: 14,
    textAlign: "center"
  },
  emptyText: {
    fontSize: 14,
    color: t.colors.textMuted,
    fontStyle: "italic"
  },

  // Member row
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: t.colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.xs,
    gap: spacing.md,
    ...t.shadows.card
  },
  memberRowBanned: {
    opacity: 0.6
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center"
  },
  avatarLetter: {
    fontSize: 16,
    fontWeight: "700"
  },
  memberInfo: {
    flex: 1,
    gap: 2
  },
  memberNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexWrap: "wrap"
  },
  memberUsername: {
    fontSize: 14,
    fontWeight: "700",
    color: t.colors.text
  },
  memberUsernameMuted: {
    color: t.colors.textMuted
  },
  joinedAt: {
    fontSize: 11,
    color: t.colors.textMuted
  },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3
  },
  bannedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "#FEE2E2"
  },
  bannedBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#DC2626",
    textTransform: "uppercase",
    letterSpacing: 0.3
  },
  kebabBtn: {
    padding: 6
  },

  // Load more
  loadMoreBtn: {
    alignItems: "center",
    paddingVertical: spacing.lg
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: "600",
    color: t.colors.accent
  },

  // Retry
  retryBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: t.colors.accent
  },
  retryLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: t.colors.surface
  },

  // S57: Transfer mode banner
  transferBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: t.colors.accent + "15",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.accent + "30"
  },
  transferBannerText: {
    fontSize: 13,
    fontWeight: "600",
    color: t.colors.accent,
    flex: 1
  },
  transferCancelBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs
  },
  transferCancelText: {
    fontSize: 13,
    fontWeight: "600",
    color: t.colors.textMuted
  },

  // S57: Make Owner button on each eligible member row
  makeOwnerBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: t.colors.accent,
    alignItems: "center",
    justifyContent: "center"
  },
  makeOwnerText: {
    fontSize: 12,
    fontWeight: "700",
    color: t.colors.surface
  }
});
