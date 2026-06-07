import { Stack, useLocalSearchParams } from "expo-router";
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

import { colors, radius, shadows, spacing } from "@predict-future/ui-tokens";
import { formatRelativeTime } from "@predict-future/utils";

import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";
import type { ApiGroupMember } from "@predict-future/types";

// ── Types ─────────────────────────────────────────────────────────────

function normalizeParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" && value.length > 0 ? value : null;
}

// ── Screen ────────────────────────────────────────────────────────────

export default function GroupMembersScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const groupId = normalizeParam(params.id);
  const { session } = useSession();

  const [members, setMembers] = useState<ApiGroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callerRole, setCallerRole] = useState<string | null>(null);
  const [callerOwnerId, setCallerOwnerId] = useState<string | null>(null);

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

  function showMemberActions(member: ApiGroupMember) {
    const isBanned = member.bannedAt != null;
    const isOwner = member.role === "OWNER";

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
    const canShowKebab = isAdminOrOwner && !isSelf && !isItemOwner;

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

        {/* Kebab */}
        {canShowKebab ? (
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

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Members"
        }}
      />
      <View style={styles.screen}>
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
  if (role === "MEMBER") return null;
  const config =
    role === "OWNER"
      ? { bg: "#EEF2FF", text: "#4F46E5" }
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background
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
    color: colors.danger,
    fontSize: 14,
    textAlign: "center"
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    fontStyle: "italic"
  },

  // Member row
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.xs,
    gap: spacing.md,
    ...shadows.card
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
    color: colors.text
  },
  memberUsernameMuted: {
    color: colors.textMuted
  },
  joinedAt: {
    fontSize: 11,
    color: colors.textMuted
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
    color: colors.accent
  },

  // Retry
  retryBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accent
  },
  retryLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.surface
  }
});
