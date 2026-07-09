/**
 * S56: Group join-request approval inbox.
 * S59-T4: Added multi-select mode (long-press) + bulk approve/reject footer.
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

import { radius, spacing } from "@predict-future/ui-tokens";
import { formatRelativeTime } from "@predict-future/utils";
import type { ApiGroupJoinRequestInboxItem } from "@predict-future/types";

import { mobileApi } from "@/lib/api";
import { trackGroupRequestEvent } from "@/lib/analytics";
import { useSession } from "@/providers/session-provider";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

const MAX_SELECTION = 50;

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
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

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

  // S59-T4: Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkRejectSheetOpen, setBulkRejectSheetOpen] = useState(false);
  const [bulkRejectNote, setBulkRejectNote] = useState("");

  const loadRequests = useCallback(
    async (reset = false) => {
      if (!groupId) return;
      if (reset) {
        setLoading(true);
        setError(null);
        setSelectMode(false);
        setSelectedIds(new Set());
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

  // ── Single-row approve / reject ──────────────────────────────────────

  async function handleApprove(item: ApiGroupJoinRequestInboxItem) {
    if (!groupId) return;
    setApprovingId(item.id);
    try {
      await mobileApi.approveGroupJoinRequest(groupId, item.id);
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

  // ── Multi-select handlers ─────────────────────────────────────────────

  function handleLongPress(item: ApiGroupJoinRequestInboxItem) {
    if (selectMode) return;
    setSelectMode(true);
    setSelectedIds(new Set([item.id]));
  }

  function handleToggleSelect(item: ApiGroupJoinRequestInboxItem) {
    if (!selectMode) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else if (next.size < MAX_SELECTION) {
        next.add(item.id);
      } else {
        Alert.alert("Limit reached", `You can select up to ${MAX_SELECTION} requests at once.`);
      }
      return next;
    });
  }

  function handleCancelSelect() {
    setSelectMode(false);
    setSelectedIds(new Set());
    setBulkRejectSheetOpen(false);
    setBulkRejectNote("");
  }

  async function handleBulkApprove() {
    if (!groupId || selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      const requestIds = Array.from(selectedIds);
      const res = await mobileApi.bulkApproveGroupJoinRequests(groupId, { requestIds });
      const successIds = new Set(
        res.results.filter((r) => r.success).map((r) => r.requestId)
      );
      const failCount = res.results.filter((r) => !r.success).length;

      setRequests((prev) => prev.filter((r) => !successIds.has(r.id)));
      handleCancelSelect();

      const msg = failCount > 0
        ? `${successIds.size} approved, ${failCount} failed (member cap or already processed).`
        : `${successIds.size} approved.`;
      Alert.alert("Done", msg);

      trackGroupRequestEvent("group_request_bulk_approved", {
        groupId,
        count: String(successIds.size)
      });
    } catch (err: unknown) {
      Alert.alert("Error", err instanceof Error ? err.message : "Bulk approve failed.");
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleBulkRejectConfirm() {
    if (!groupId || selectedIds.size === 0) return;
    setBulkLoading(true);
    const note = bulkRejectNote.trim() || undefined;
    try {
      const requestIds = Array.from(selectedIds);
      const res = await mobileApi.bulkRejectGroupJoinRequests(groupId, { requestIds, note });
      const successIds = new Set(
        res.results.filter((r) => r.success).map((r) => r.requestId)
      );
      const failCount = res.results.filter((r) => !r.success).length;

      setRequests((prev) => prev.filter((r) => !successIds.has(r.id)));
      handleCancelSelect();

      const msg = failCount > 0
        ? `${successIds.size} rejected, ${failCount} failed.`
        : `${successIds.size} rejected.`;
      Alert.alert("Done", msg);

      trackGroupRequestEvent("group_request_bulk_rejected", {
        groupId,
        count: String(successIds.size)
      });
    } catch (err: unknown) {
      Alert.alert("Error", err instanceof Error ? err.message : "Bulk reject failed.");
    } finally {
      setBulkLoading(false);
      setBulkRejectSheetOpen(false);
      setBulkRejectNote("");
    }
  }

  // ── Render item ──────────────────────────────────────────────────────

  const renderItem = ({ item }: { item: ApiGroupJoinRequestInboxItem }) => {
    const isApproving = approvingId === item.id;
    const isRejecting = rejectingId === item.id;
    const isSelected = selectedIds.has(item.id);

    return (
      <Pressable
        style={[
          styles.requestRow,
          isSelected && styles.requestRowSelected,
        ]}
        onPress={() => {
          if (selectMode) {
            handleToggleSelect(item);
          }
        }}
        onLongPress={() => handleLongPress(item)}
        delayLongPress={400}
      >
        {/* Checkbox (visible in select mode) */}
        {selectMode ? (
          <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
            {isSelected && (
              <Ionicons name="checkmark" size={14} color="#fff" />
            )}
          </View>
        ) : (
          /* Avatar */
          <View style={styles.avatar}>
            <Text style={styles.avatarLetter}>
              {item.username.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}

        {/* Info */}
        <View style={styles.requestInfo}>
          <Text style={styles.requestUsername}>@{item.username}</Text>
          <Text style={styles.requestedAt}>
            Requested {formatRelativeTime(item.requestedAt)}
          </Text>
        </View>

        {/* Single-row actions — hidden in select mode */}
        {!selectMode && (
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
        )}
      </Pressable>
    );
  };

  const selectedCount = selectedIds.size;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: selectMode ? `${selectedCount} selected` : "Pending Requests",
          headerRight: selectMode
            ? () => (
                <Pressable onPress={handleCancelSelect} hitSlop={8} style={{ marginRight: 8 }}>
                  <Text style={styles.cancelSelectText}>Cancel</Text>
                </Pressable>
              )
            : undefined,
        }}
      />
      <View style={styles.screen}>
        {/* Reject sheet — single row */}
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

        {/* Bulk reject note sheet */}
        {bulkRejectSheetOpen ? (
          <View style={styles.rejectSheet}>
            <Text style={styles.rejectSheetTitle}>
              Reject {selectedCount} request{selectedCount !== 1 ? "s" : ""}?
            </Text>
            <TextInput
              style={styles.rejectNoteInput}
              placeholder="Optional reason for all (max 280 chars)"
              placeholderTextColor={colors.textMuted}
              value={bulkRejectNote}
              onChangeText={(t) => setBulkRejectNote(t.slice(0, 280))}
              multiline
              maxLength={280}
              returnKeyType="done"
            />
            <View style={styles.rejectSheetActions}>
              <Pressable
                style={[styles.rejectSheetBtn, styles.rejectSheetCancelBtn]}
                onPress={() => { setBulkRejectSheetOpen(false); setBulkRejectNote(""); }}
              >
                <Text style={styles.rejectSheetCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.rejectSheetBtn, styles.rejectSheetConfirmBtn, bulkLoading && styles.actionBtnDisabled]}
                onPress={handleBulkRejectConfirm}
                disabled={bulkLoading}
              >
                {bulkLoading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.rejectSheetConfirmText}>Reject All</Text>
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
          <>
            <FlatList
              data={requests}
              renderItem={renderItem}
              keyExtractor={(item) => item.id}
              contentContainerStyle={[
                styles.listContent,
                selectMode && { paddingBottom: 100 } // Make room for footer
              ]}
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

            {/* S59-T4: Multi-select footer action bar */}
            {selectMode && !bulkRejectSheetOpen && !rejectTarget && (
              <View style={styles.bulkFooter}>
                <Text style={styles.bulkSelectionCount}>
                  {selectedCount} selected {selectedCount === MAX_SELECTION ? `(max ${MAX_SELECTION})` : ""}
                </Text>
                <View style={styles.bulkActions}>
                  <Pressable
                    style={[
                      styles.bulkBtn,
                      styles.bulkApproveBtn,
                      (bulkLoading || selectedCount === 0) && styles.actionBtnDisabled,
                    ]}
                    onPress={handleBulkApprove}
                    disabled={bulkLoading || selectedCount === 0}
                  >
                    {bulkLoading ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.bulkApproveBtnText}>
                        Approve {selectedCount > 0 ? selectedCount : ""}
                      </Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={[
                      styles.bulkBtn,
                      styles.bulkRejectBtn,
                      (bulkLoading || selectedCount === 0) && styles.actionBtnDisabled,
                    ]}
                    onPress={() => setBulkRejectSheetOpen(true)}
                    disabled={bulkLoading || selectedCount === 0}
                  >
                    <Text style={styles.bulkRejectBtnText}>
                      Reject {selectedCount > 0 ? selectedCount : ""}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          </>
        )}
      </View>
    </>
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
    gap: spacing.md,
    minHeight: 200
  },
  accessDeniedText: {
    fontSize: 14,
    color: t.colors.textMuted,
    textAlign: "center",
    maxWidth: 280
  },
  errorText: {
    fontSize: 14,
    color: t.colors.danger,
    textAlign: "center"
  },
  emptyText: {
    fontSize: 14,
    color: t.colors.textMuted,
    fontStyle: "italic"
  },

  // Request row
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: t.colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.xs,
    gap: spacing.md,
    ...t.shadows.card
  },
  requestRowSelected: {
    borderWidth: 2,
    borderColor: t.colors.accent,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.colors.accent + "20",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0
  },
  avatarLetter: {
    fontSize: 16,
    fontWeight: "700",
    color: t.colors.accent
  },
  // S59-T4: Checkbox in select mode
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: t.colors.border,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  checkboxSelected: {
    backgroundColor: t.colors.accent,
    borderColor: t.colors.accent,
  },
  requestInfo: {
    flex: 1,
    gap: 2
  },
  requestUsername: {
    fontSize: 14,
    fontWeight: "700",
    color: t.colors.text
  },
  requestedAt: {
    fontSize: 11,
    color: t.colors.textMuted
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
    backgroundColor: t.colors.accent
  },
  approveBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff"
  },
  rejectBtn: {
    backgroundColor: t.colors.dangerSoft
  },
  rejectBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: t.colors.danger
  },

  // Reject sheet
  rejectSheet: {
    backgroundColor: t.colors.surface,
    padding: spacing.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.border,
    gap: spacing.md
  },
  rejectSheetTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: t.colors.text
  },
  rejectNoteInput: {
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 14,
    color: t.colors.text,
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
    backgroundColor: t.colors.background,
    borderWidth: 1,
    borderColor: t.colors.border
  },
  rejectSheetCancelText: {
    fontSize: 14,
    fontWeight: "600",
    color: t.colors.text
  },
  rejectSheetConfirmBtn: {
    backgroundColor: t.colors.danger
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

  // S59-T4: Multi-select header cancel
  cancelSelectText: {
    fontSize: 14,
    fontWeight: "600",
    color: t.colors.accent,
  },

  // S59-T4: Bulk footer action bar
  bulkFooter: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: t.colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    paddingBottom: Platform.OS === "ios" ? 28 : spacing.md,
    gap: spacing.sm,
    ...t.shadows.card,
  },
  bulkSelectionCount: {
    fontSize: 12,
    color: t.colors.textMuted,
    textAlign: "center",
  },
  bulkActions: {
    flexDirection: "row",
    gap: spacing.md,
  },
  bulkBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  bulkApproveBtn: {
    backgroundColor: t.colors.accent,
  },
  bulkApproveBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  bulkRejectBtn: {
    backgroundColor: t.colors.dangerSoft,
    borderWidth: 1,
    borderColor: t.colors.danger + "40",
  },
  bulkRejectBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: t.colors.danger,
  },
});
