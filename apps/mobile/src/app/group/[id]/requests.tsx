/**
 * S56: Group join-request approval inbox.
 *
 * Accessible only to OWNER and ADMIN of the group.
 * Non-admin visitors see an access-denied state (no crash, no 403 flash).
 *
 * Screen path: /group/[id]/requests
 * Sibling to members.tsx — consistent with the existing navigation pattern.
 */

import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, shadows, spacing } from "@predict-future/ui-tokens";
import { formatRelativeTime } from "@predict-future/utils";
import type { ApiGroupJoinRequestInboxItem } from "@predict-future/types";

import { mobileApi } from "@/lib/api";
import { trackGroupRequestEvent } from "@/lib/analytics";
import { useSession } from "@/providers/session-provider";

// ── Helpers ────────────────────────────────────────────────────────────

function normalizeParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" && value.length > 0 ? value : null;
}

// ── Screen ────────────────────────────────────────────────────────────

export default function GroupRequestsScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const groupId = normalizeParam(params.id);

  const { session } = useSession();

  const [requests, setRequests] = useState<ApiGroupJoinRequestInboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  // Reject sheet state
  const [rejectTarget, setRejectTarget] = useState<ApiGroupJoinRequestInboxItem | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const loadRequests = useCallback(
    async (reset = false) => {
      if (!groupId) return;
      if (reset) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await mobileApi.getGroupJoinRequests(groupId, {
          status: "PENDING",
          limit: 20
        });
        if (reset) {
          setRequests(res.requests);
        } else {
          setRequests((prev) => [...prev, ...res.requests]);
        }
        setNextCursor(res.nextCursor);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to load requests.";
        // Check if this is a 403 — surface access-denied UI instead of generic error.
        if (msg.toLowerCase().includes("owner or admin")) {
          setAccessDenied(true);
        } else {
          setError(msg);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [groupId]
  );

  useEffect(() => {
    void loadRequests(true);
  }, [loadRequests]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadRequests(true);
  }

  async function handleLoadMore() {
    if (!nextCursor || loadingMore || !groupId) return;
    setLoadingMore(true);
    try {
      const res = await mobileApi.getGroupJoinRequests(groupId, {
        status: "PENDING",
        cursor: nextCursor,
        limit: 20
      });
      setRequests((prev) => [...prev, ...res.requests]);
      setNextCursor(res.nextCursor);
    } catch {
      // Silently fail load-more
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleApprove(item: ApiGroupJoinRequestInboxItem) {
    if (!groupId) return;
    setApprovingId(item.id);
    try {
      await mobileApi.approveGroupJoinRequest(groupId, item.id);
      // Optimistic: remove from list.
      setRequests((prev) => prev.filter((r) => r.id !== item.id));
      trackGroupRequestEvent("group_request_approved", {
        groupId,
        requestId: item.id
      });
      Alert.alert("Approved", `@${item.username} is now a member.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not approve request.";
      if (msg.includes("group_full") || msg.includes("member_cap")) {
        Alert.alert("Group is full", "Increase the member cap first, then retry.");
      } else {
        Alert.alert("Error", msg);
      }
    } finally {
      setApprovingId(null);
    }
  }

  async function handleRejectConfirm() {
    if (!rejectTarget || !groupId) return;
    setRejectingId(rejectTarget.id);
    const note = rejectNote.trim() || undefined;
    try {
      await mobileApi.rejectGroupJoinRequest(groupId, rejectTarget.id, { note });
      // Optimistic: remove from list.
      setRequests((prev) => prev.filter((r) => r.id !== rejectTarget.id));
      trackGroupRequestEvent("group_request_rejected", {
        groupId,
        requestId: rejectTarget.id
      });
      setRejectTarget(null);
      setRejectNote("");
    } catch (err: unknown) {
      Alert.alert("Error", err instanceof Error ? err.message : "Could not reject request.");
    } finally {
      setRejectingId(null);
    }
  }

  const renderItem = ({ item }: { item: ApiGroupJoinRequestInboxItem }) => {
    const isApproving = approvingId === item.id;
    const isRejecting = rejectingId === item.id;

    return (
      <View style={styles.requestRow}>
        {/* Avatar */}
        <View style={styles.avatar}>
          <Text style={styles.avatarLetter}>
            {item.username.charAt(0).toUpperCase()}
          </Text>
        </View>

        {/* Info */}
        <View style={styles.requestInfo}>
          <Text style={styles.requestUsername}>@{item.username}</Text>
          <Text style={styles.requestedAt}>
            Requested {formatRelativeTime(item.requestedAt)}
          </Text>
        </View>

        {/* Actions */}
        <View style={styles.actionBtns}>
          <Pressable
            style={[styles.actionBtn, styles.approveBtn, isApproving && styles.actionBtnDisabled]}
            onPress={() => handleApprove(item)}
            disabled={isApproving || isRejecting}
          >
            {isApproving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.approveBtnText}>Approve</Text>
            )}
          </Pressable>
          <Pressable
            style={[styles.actionBtn, styles.rejectBtn, isRejecting && styles.actionBtnDisabled]}
            onPress={() => {
              setRejectNote("");
              setRejectTarget(item);
            }}
            disabled={isApproving || isRejecting}
          >
            {isRejecting ? (
              <ActivityIndicator color={colors.danger} size="small" />
            ) : (
              <Text style={styles.rejectBtnText}>Reject</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Pending Requests"
        }}
      />
      <View style={styles.screen}>
        {/* Reject sheet — inline below-list sheet (cross-platform) */}
        {rejectTarget ? (
          <View style={styles.rejectSheet}>
            <Text style={styles.rejectSheetTitle}>
              Reject @{rejectTarget.username}'s request?
            </Text>
            <TextInput
              style={styles.rejectNoteInput}
              placeholder="Optional reason (max 280 chars)"
              placeholderTextColor={colors.textMuted}
              value={rejectNote}
              onChangeText={(t) => setRejectNote(t.slice(0, 280))}
              multiline
              maxLength={280}
              returnKeyType="done"
            />
            <View style={styles.rejectSheetActions}>
              <Pressable
                style={[styles.rejectSheetBtn, styles.rejectSheetCancelBtn]}
                onPress={() => { setRejectTarget(null); setRejectNote(""); }}
              >
                <Text style={styles.rejectSheetCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.rejectSheetBtn, styles.rejectSheetConfirmBtn, rejectingId != null && styles.actionBtnDisabled]}
                onPress={handleRejectConfirm}
                disabled={rejectingId != null}
              >
                {rejectingId != null ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.rejectSheetConfirmText}>Reject</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
        ) : accessDenied ? (
          <View style={styles.centerState}>
            <Ionicons name="lock-closed-outline" size={40} color={colors.textMuted} />
            <Text style={styles.accessDeniedText}>
              You don't have access to this group's requests.
            </Text>
          </View>
        ) : error ? (
          <View style={styles.centerState}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => loadRequests(true)} style={styles.retryBtn}>
              <Text style={styles.retryLabel}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={requests}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={colors.accent}
              />
            }
            ListEmptyComponent={
              <View style={styles.centerState}>
                <Ionicons name="checkmark-circle-outline" size={40} color={colors.textMuted} />
                <Text style={styles.emptyText}>No pending requests.</Text>
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
    gap: spacing.md,
    minHeight: 200
  },
  accessDeniedText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    maxWidth: 280
  },
  errorText: {
    fontSize: 14,
    color: colors.danger,
    textAlign: "center"
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    fontStyle: "italic"
  },

  // Request row
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.xs,
    gap: spacing.md,
    ...shadows.card
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent + "20",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0
  },
  avatarLetter: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.accent
  },
  requestInfo: {
    flex: 1,
    gap: 2
  },
  requestUsername: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text
  },
  requestedAt: {
    fontSize: 11,
    color: colors.textMuted
  },
  actionBtns: {
    flexDirection: "row",
    gap: spacing.xs
  },
  actionBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 72
  },
  actionBtnDisabled: {
    opacity: 0.5
  },
  approveBtn: {
    backgroundColor: colors.accent
  },
  approveBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff"
  },
  rejectBtn: {
    backgroundColor: "#FEE2E2"
  },
  rejectBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.danger
  },

  // Reject sheet
  rejectSheet: {
    backgroundColor: colors.surface,
    padding: spacing.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.md
  },
  rejectSheetTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text
  },
  rejectNoteInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 14,
    color: colors.text,
    minHeight: 72,
    textAlignVertical: "top"
  },
  rejectSheetActions: {
    flexDirection: "row",
    gap: spacing.md
  },
  rejectSheetBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center"
  },
  rejectSheetCancelBtn: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border
  },
  rejectSheetCancelText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text
  },
  rejectSheetConfirmBtn: {
    backgroundColor: colors.danger
  },
  rejectSheetConfirmText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff"
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
