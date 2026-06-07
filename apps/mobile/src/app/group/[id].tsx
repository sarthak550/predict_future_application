import * as Clipboard from "expo-clipboard";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, shadows, spacing } from "@predict-future/ui-tokens";
import { formatRelativeTime } from "@predict-future/utils";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";
import { trackGroupRequestEvent } from "@/lib/analytics";
import { useSession } from "@/providers/session-provider";
import type { AppMarketCategory } from "@predict-future/types";

// ── Types ────────────────────────────────────────────────────────────

type GroupMember = {
  id: string;
  userId: string;
  role: string;
  joinedAt: string;
  bannedAt?: string | null;
  user: { username: string; avatarUrl?: string | null };
};

type GroupMarket = {
  id: string;
  title: string;
  status: string;
  category?: string;
  totalVolume?: number;
  totalParticipants?: number;
  closeAt?: string;
  creator?: { username: string };
};

type CallerJoinRequest = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  decisionNote: string | null;
} | null;

type GroupData = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  ownerId: string;
  visibility: "INVITE_ONLY" | "OPEN" | "REQUEST_TO_JOIN";
  category?: AppMarketCategory | null;
  memberCap?: number;
  coverImageUrl?: string | null;
  inviteCode?: string;
  owner?: { username: string };
  memberships?: GroupMember[];
  markets?: GroupMarket[];
  /** S56: Caller's current join request — populated for non-members on REQUEST_TO_JOIN groups. */
  callerJoinRequest?: CallerJoinRequest;
  /** S56: Count of PENDING join requests. Populated for OWNER/ADMIN callers only. */
  pendingRequestCount?: number | null;
};

// ── Category colours ─────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  FINANCE: "#1D4ED8",
  SPORTS: "#15803D",
  BUSINESS: "#7C3AED",
  TECH: "#0891B2",
  ENTERTAINMENT: "#DB2777",
  WEATHER: "#D97706",
  GENERAL: "#4B5563",
  PRODUCT: "#9333EA",
  COMPANY: "#059669"
};

function categoryColor(cat?: string | null): string {
  return CATEGORY_COLORS[cat ?? ""] ?? "#4B5563";
}

function categoryLabel(cat?: string | null): string {
  if (!cat) return "";
  return cat.charAt(0) + cat.slice(1).toLowerCase();
}

// ── Helpers ────────────────────────────────────────────────────────────

function normalizeParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" && value.length > 0 ? value : null;
}

// ── Member status ────────────────────────────────────────────────────
//
// S56 extension: two new states for REQUEST_TO_JOIN flow.

type MemberStatus =
  | "owner"
  | "admin"
  | "member"
  | "banned"
  | "request_pending"   // S56: user has a live PENDING join request
  | "request_rejected"  // S56: user was rejected within the last 7 days
  | "none";

function resolveMemberStatus(
  group: GroupData,
  userId?: string | null
): MemberStatus {
  if (!userId) return "none";

  const membership = group.memberships?.find((m) => m.userId === userId);

  if (membership) {
    if (membership.bannedAt) return "banned";
    if (membership.role === "OWNER") return "owner";
    if (membership.role === "ADMIN") return "admin";
    return "member";
  }

  // No membership — check join request state (S56).
  const jr = group.callerJoinRequest;
  if (jr?.status === "PENDING") return "request_pending";
  if (jr?.status === "REJECTED") return "request_rejected";

  return "none";
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
    errorFallback: "Unable to load group."
  });

  const group = data
    ? ((data as { group: GroupData }).group ?? null)
    : null;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: group?.name ?? "Group"
        }}
      />
      <View style={styles.screen}>
        {!groupId ? (
          <View style={styles.centerState}>
            <Text style={styles.errorText}>Missing group id.</Text>
          </View>
        ) : status === "loading" || status === "idle" ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
        ) : status === "error" ? (
          <View style={styles.centerState}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={refetch} style={styles.retryBtn}>
              <Text style={styles.retryLabel}>Retry</Text>
            </Pressable>
          </View>
        ) : group ? (
          <GroupBody group={group} groupId={groupId} onRefresh={refetch} />
        ) : (
          <View style={styles.centerState}>
            <Text style={styles.errorText}>Group not found.</Text>
          </View>
        )}
      </View>
    </>
  );
}

// ── Cover Banner ─────────────────────────────────────────────────────

function CoverBanner({
  coverImageUrl,
  category
}: {
  coverImageUrl?: string | null;
  category?: string | null;
}) {
  if (coverImageUrl) {
    return (
      <Image
        source={{ uri: coverImageUrl }}
        style={styles.coverImage}
        resizeMode="cover"
      />
    );
  }
  return (
    <View
      style={[styles.coverGradient, { backgroundColor: categoryColor(category) }]}
    >
      <Ionicons name="people" size={40} color="rgba(255,255,255,0.5)" />
    </View>
  );
}

// ── Join CTA ─────────────────────────────────────────────────────────

function JoinCTA({
  group,
  memberStatus,
  joinRequest,
  onJoin,
  onRequestJoin,
  onCancelRequest,
  onLeave,
  joining,
  requestingJoin,
  cancellingRequest
}: {
  group: GroupData;
  memberStatus: MemberStatus;
  joinRequest: CallerJoinRequest;
  onJoin: () => void;
  onRequestJoin: () => void;
  onCancelRequest: () => void;
  onLeave: () => void;
  joining: boolean;
  requestingJoin: boolean;
  cancellingRequest: boolean;
}) {
  const router = useRouter();

  if (memberStatus === "owner" || memberStatus === "admin") {
    return null;
  }

  if (memberStatus === "member") {
    // S57: MEMBER can voluntarily leave. OWNER and ADMIN use the kebab menu.
    return (
      <View style={styles.ctaBar}>
        <Pressable style={styles.ctaBtnGhost} onPress={onLeave}>
          <Text style={[styles.ctaBtnGhostText, { color: colors.danger }]}>Leave group</Text>
        </Pressable>
      </View>
    );
  }

  if (memberStatus === "banned") {
    return (
      <View style={styles.ctaBar}>
        <View style={[styles.ctaBtn, styles.ctaBtnDisabled]}>
          <Text style={styles.ctaBtnTextMuted}>Can't join</Text>
        </View>
      </View>
    );
  }

  // S56: Request pending state — show muted pill + cancel action.
  if (memberStatus === "request_pending") {
    return (
      <View style={styles.ctaBar}>
        <View style={[styles.ctaBtn, styles.ctaBtnMuted]}>
          <Ionicons name="time-outline" size={15} color={colors.textMuted} style={{ marginRight: 6 }} />
          <Text style={styles.ctaBtnTextMuted}>Request pending</Text>
        </View>
        <Pressable
          style={styles.ctaBtnGhost}
          onPress={onCancelRequest}
          disabled={cancellingRequest}
        >
          {cancellingRequest ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <Text style={styles.ctaBtnGhostText}>Cancel request</Text>
          )}
        </Pressable>
      </View>
    );
  }

  // S56: Request rejected state — muted label, tap again to re-request.
  if (memberStatus === "request_rejected") {
    return (
      <View style={styles.ctaBar}>
        <View style={[styles.ctaBtn, styles.ctaBtnMuted]}>
          <Ionicons name="close-circle-outline" size={15} color={colors.danger} style={{ marginRight: 6 }} />
          <Text style={[styles.ctaBtnTextMuted, { color: colors.danger }]}>Request not approved</Text>
        </View>
        {joinRequest?.decisionNote ? (
          <Text style={styles.decisionNote}>{joinRequest.decisionNote}</Text>
        ) : null}
        <Pressable
          style={styles.ctaBtnGhost}
          onPress={onRequestJoin}
          disabled={requestingJoin}
        >
          {requestingJoin ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <Text style={styles.ctaBtnGhostText}>Request again</Text>
          )}
        </Pressable>
      </View>
    );
  }

  // memberStatus === "none"
  if (group.visibility === "OPEN") {
    return (
      <View style={styles.ctaBar}>
        <Pressable
          style={[styles.ctaBtn, joining && styles.ctaBtnDisabled]}
          onPress={onJoin}
          disabled={joining}
        >
          {joining ? (
            <ActivityIndicator color={colors.surface} size="small" />
          ) : (
            <Text style={styles.ctaBtnText}>Join Group</Text>
          )}
        </Pressable>
      </View>
    );
  }

  // S56: REQUEST_TO_JOIN — primary "Request to join" button.
  if (group.visibility === "REQUEST_TO_JOIN") {
    return (
      <View style={styles.ctaBar}>
        <Pressable
          style={[styles.ctaBtn, requestingJoin && styles.ctaBtnDisabled]}
          onPress={onRequestJoin}
          disabled={requestingJoin}
        >
          {requestingJoin ? (
            <ActivityIndicator color={colors.surface} size="small" />
          ) : (
            <Text style={styles.ctaBtnText}>Request to join</Text>
          )}
        </Pressable>
      </View>
    );
  }

  // INVITE_ONLY
  return (
    <View style={styles.ctaBar}>
      <View style={[styles.ctaBtn, styles.ctaBtnDisabled]}>
        <Ionicons name="lock-closed" size={14} color={colors.textMuted} style={{ marginRight: 6 }} />
        <Text style={styles.ctaBtnTextMuted}>Invite only</Text>
      </View>
      <Pressable
        style={styles.ctaBtnGhost}
        onPress={() => router.push("/(tabs)/groups")}
      >
        <Text style={styles.ctaBtnGhostText}>Enter invite code</Text>
      </Pressable>
    </View>
  );
}

// ── Body ─────────────────────────────────────────────────────────────

function GroupBody({
  group,
  groupId,
  onRefresh
}: {
  group: GroupData;
  groupId: string;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.userId ?? null;

  const [joining, setJoining] = useState(false);
  const [requestingJoin, setRequestingJoin] = useState(false);
  const [cancellingRequest, setCancellingRequest] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);

  // Derive join request state from group data — updated optimistically.
  const [localJoinRequest, setLocalJoinRequest] = useState<CallerJoinRequest>(
    group.callerJoinRequest ?? null
  );

  const memberStatus = resolveMemberStatus(
    { ...group, callerJoinRequest: localJoinRequest },
    userId
  );
  const isAdminOrOwner = memberStatus === "owner" || memberStatus === "admin";
  const memberships = group.memberships ?? [];
  const memberCount = memberships.filter((m) => !m.bannedAt).length;
  const markets = (group.markets ?? []).slice(0, 10);

  const pendingCount = group.pendingRequestCount ?? 0;

  async function handleJoin() {
    setJoining(true);
    try {
      await mobileApi.joinOpenGroup(groupId);
      onRefresh();
    } catch (err: unknown) {
      Alert.alert(
        "Could not join",
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setJoining(false);
    }
  }

  async function handleRequestJoin() {
    setRequestingJoin(true);
    try {
      const res = await mobileApi.submitGroupJoinRequest(groupId);
      if ("requestId" in res) {
        // Optimistic state flip — no full reload needed.
        setLocalJoinRequest({
          id: res.requestId,
          status: "PENDING",
          decisionNote: null
        });
        trackGroupRequestEvent("group_request_submitted", {
          groupId,
          requestId: res.requestId,
          surface: "group_profile"
        });
      }
    } catch (err: unknown) {
      Alert.alert(
        "Could not submit request",
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setRequestingJoin(false);
    }
  }

  async function handleCancelRequest() {
    if (!localJoinRequest) return;
    setCancellingRequest(true);
    try {
      await mobileApi.cancelGroupJoinRequest(groupId, localJoinRequest.id);
      // Optimistic: reset to "none" state.
      setLocalJoinRequest(null);
      trackGroupRequestEvent("group_request_cancelled", {
        groupId,
        requestId: localJoinRequest.id
      });
    } catch (err: unknown) {
      Alert.alert(
        "Could not cancel request",
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setCancellingRequest(false);
    }
  }

  async function handleLeave() {
    Alert.alert(
      "Leave group?",
      `Leave ${group.name}? You will lose access to its markets and members.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: async () => {
            try {
              await mobileApi.leaveGroup(groupId);
              router.replace("/(tabs)/groups");
            } catch (err: unknown) {
              const code =
                err != null && typeof err === "object" && "code" in err
                  ? (err as { code: unknown }).code
                  : undefined;
              if (code === "owner_must_transfer_or_archive") {
                Alert.alert(
                  "You're the owner",
                  "Transfer ownership or archive the group first."
                );
              } else {
                Alert.alert(
                  "Could not leave group",
                  err instanceof Error ? err.message : "Something went wrong."
                );
              }
            }
          }
        }
      ]
    );
  }

  async function handleArchive() {
    Alert.alert(
      "Archive group?",
      `Archive ${group.name}? This will close the group and remove it from discovery. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: async () => {
            try {
              await mobileApi.archiveGroup(groupId);
              router.replace("/(tabs)/groups");
            } catch (err: unknown) {
              Alert.alert(
                "Could not archive group",
                err instanceof Error ? err.message : "Something went wrong."
              );
            }
          }
        }
      ]
    );
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

  function openAdminActions() {
    const actions: Array<{ text: string; onPress?: () => void; style?: "default" | "cancel" | "destructive" }> = [
      {
        text: "Manage Members",
        onPress: () => router.push(`/group/${groupId}/members`)
      }
    ];

    // S56: Pending requests inbox entry (owner/admin only, show count badge).
    if (pendingCount > 0) {
      actions.push({
        text: `Pending Requests (${pendingCount})`,
        onPress: () => router.push(`/group/${groupId}/requests`)
      });
    } else {
      actions.push({
        text: "Pending Requests",
        onPress: () => router.push(`/group/${groupId}/requests`)
      });
    }

    actions.push({
      text: "Edit Group",
      onPress: () =>
        Alert.alert("Coming soon", "Group settings are in a future sprint.")
    });

    // S57: Owner-only self-service actions.
    if (memberStatus === "owner") {
      actions.push({
        text: "Transfer Ownership",
        onPress: () => router.push(`/group/${groupId}/members?mode=transfer`)
      });
      actions.push({
        text: "Archive Group",
        style: "destructive",
        onPress: () => void handleArchive()
      });
    }

    actions.push({ text: "Cancel", style: "cancel" });

    Alert.alert("Group Actions", "", actions);
  }

  return (
    <View style={styles.bodyContainer}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Cover */}
        <CoverBanner
          coverImageUrl={group.coverImageUrl}
          category={group.category}
        />

        {/* Header info */}
        <View style={styles.headerCard}>
          <View style={styles.headerTopRow}>
            <Text style={styles.groupName}>{group.name}</Text>
            {/* Admin / owner action menu */}
            {isAdminOrOwner ? (
              <Pressable
                style={styles.kebabBtn}
                onPress={openAdminActions}
              >
                {pendingCount > 0 ? (
                  <View>
                    <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
                    <View style={styles.pendingBadge}>
                      <Text style={styles.pendingBadgeText}>
                        {pendingCount > 9 ? "9+" : String(pendingCount)}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
                )}
              </Pressable>
            ) : null}
          </View>

          <View style={styles.pillRow}>
            {/* Category pill */}
            {group.category ? (
              <View
                style={[
                  styles.pill,
                  { backgroundColor: categoryColor(group.category) + "20" }
                ]}
              >
                <Text
                  style={[styles.pillText, { color: categoryColor(group.category) }]}
                >
                  {categoryLabel(group.category)}
                </Text>
              </View>
            ) : null}

            {/* Visibility pill */}
            <View
              style={[
                styles.pill,
                group.visibility === "OPEN"
                  ? styles.pillOpen
                  : group.visibility === "REQUEST_TO_JOIN"
                  ? styles.pillRTJ
                  : styles.pillInviteOnly
              ]}
            >
              <Text
                style={[
                  styles.pillText,
                  group.visibility === "OPEN"
                    ? styles.pillTextOpen
                    : group.visibility === "REQUEST_TO_JOIN"
                    ? styles.pillTextRTJ
                    : styles.pillTextInviteOnly
                ]}
              >
                {group.visibility === "OPEN"
                  ? "Open"
                  : group.visibility === "REQUEST_TO_JOIN"
                  ? "Request to join"
                  : "Invite only"}
              </Text>
            </View>

            {/* Role chip */}
            {memberStatus === "owner" ? (
              <View style={[styles.pill, styles.pillOwner]}>
                <Text style={[styles.pillText, styles.pillTextOwner]}>Owner</Text>
              </View>
            ) : memberStatus === "admin" ? (
              <View style={[styles.pill, styles.pillAdmin]}>
                <Text style={[styles.pillText, styles.pillTextAdmin]}>Admin</Text>
              </View>
            ) : memberStatus === "member" ? (
              <View style={[styles.pill, styles.pillMember]}>
                <Ionicons name="checkmark" size={11} color="#15803D" />
                <Text style={[styles.pillText, styles.pillTextMember]}>Member</Text>
              </View>
            ) : null}
          </View>

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Ionicons name="people-outline" size={14} color={colors.textMuted} />
              <Text style={styles.statText}>{memberCount} members</Text>
            </View>
            <Text style={styles.statSep}>·</Text>
            <View style={styles.statItem}>
              <Ionicons name="bar-chart-outline" size={14} color={colors.textMuted} />
              <Text style={styles.statText}>{markets.length} markets</Text>
            </View>
          </View>

          {/* Owner info */}
          {group.owner?.username ? (
            <Text style={styles.ownerText}>
              Hosted by @{group.owner.username}
            </Text>
          ) : null}

          {/* Invite code (owner/admin only) */}
          {isAdminOrOwner && group.inviteCode ? (
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

        {/* Description (collapsible after 3 lines) */}
        {group.description ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text
              style={styles.descriptionText}
              numberOfLines={descExpanded ? undefined : 3}
            >
              {group.description}
            </Text>
            <Pressable
              onPress={() => setDescExpanded((prev) => !prev)}
              style={styles.expandBtn}
            >
              <Text style={styles.expandBtnText}>
                {descExpanded ? "Show less" : "Show more"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Recent Markets */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Recent Markets</Text>
          {markets.length === 0 ? (
            <Text style={styles.emptyText}>No markets yet.</Text>
          ) : (
            markets.map((m, i) => (
              <Pressable
                key={m.id}
                style={[styles.marketRow, i > 0 && styles.marketRowBorder]}
                onPress={() => router.push(`/market/${m.id}`)}
              >
                <View style={styles.marketRowLeft}>
                  <Text style={styles.marketTitle} numberOfLines={2}>
                    {m.title}
                  </Text>
                  <View style={styles.marketMeta}>
                    {m.category ? (
                      <Text style={styles.marketCategory}>
                        {categoryLabel(m.category)}
                      </Text>
                    ) : null}
                    <MarketStatusBadge status={m.status} />
                    {m.totalParticipants != null ? (
                      <Text style={styles.marketMetaText}>
                        {m.totalParticipants} players
                      </Text>
                    ) : null}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </Pressable>
            ))
          )}
        </View>

        {/* Member preview */}
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Members</Text>
            {memberships.length > 5 ? (
              <Pressable onPress={() => router.push(`/group/${groupId}/members`)}>
                <Text style={styles.seeAllText}>
                  See all {memberCount}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {memberships.filter((m) => !m.bannedAt).slice(0, 5).length === 0 ? (
            <Text style={styles.emptyText}>No members yet.</Text>
          ) : (
            memberships
              .filter((m) => !m.bannedAt)
              .slice(0, 5)
              .map((m) => (
                <View key={m.id} style={styles.memberPreviewRow}>
                  <View style={styles.avatarPlaceholder}>
                    <Text style={styles.avatarLetter}>
                      {m.user.username.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.memberUsername}>@{m.user.username}</Text>
                  {m.role !== "MEMBER" ? (
                    <View style={styles.rolePill}>
                      <Text style={styles.rolePillText}>{m.role}</Text>
                    </View>
                  ) : null}
                </View>
              ))
          )}
          {isAdminOrOwner ? (
            <Pressable
              style={styles.manageBtn}
              onPress={() => router.push(`/group/${groupId}/members`)}
            >
              <Ionicons
                name="settings-outline"
                size={14}
                color={colors.accent}
                style={{ marginRight: 4 }}
              />
              <Text style={styles.manageBtnText}>Manage Members</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Spacer so content clears the sticky CTA bar */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Sticky Join CTA */}
      <JoinCTA
        group={group}
        memberStatus={memberStatus}
        joinRequest={localJoinRequest}
        onJoin={handleJoin}
        onRequestJoin={handleRequestJoin}
        onCancelRequest={handleCancelRequest}
        onLeave={handleLeave}
        joining={joining}
        requestingJoin={requestingJoin}
        cancellingRequest={cancellingRequest}
      />
    </View>
  );
}

// ── Market Status Badge ───────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  OPEN: { label: "Live", bg: "#DCFCE7", text: "#15803D" },
  RESOLVED: { label: "Resolved", bg: "#F3F4F6", text: "#6B7280" },
  CLOSED: { label: "Closed", bg: "#FEF3C7", text: "#92400E" },
  AWAITING_RESOLUTION: { label: "Awaiting", bg: "#DBEAFE", text: "#1D4ED8" },
  CANCELLED: { label: "Cancelled", bg: "#F3F4F6", text: "#6B7280" },
  DRAFT: { label: "Draft", bg: "#F3F4F6", text: "#9CA3AF" }
};

function MarketStatusBadge({ status }: { status: string }) {
  const cfg = STATUS_BADGE[status] ?? { label: status, bg: "#F3F4F6", text: "#6B7280" };
  return (
    <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.statusBadgeText, { color: cfg.text }]}>{cfg.label}</Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background
  },
  bodyContainer: {
    flex: 1
  },
  scroll: {
    flex: 1
  },
  content: {
    paddingBottom: 16
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

  // Cover
  coverImage: {
    width: "100%",
    height: 180
  },
  coverGradient: {
    width: "100%",
    height: 180,
    alignItems: "center",
    justifyContent: "center"
  },

  // Header card
  headerCard: {
    backgroundColor: colors.surface,
    padding: spacing.xl,
    marginBottom: spacing.sm,
    ...shadows.card
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: spacing.sm
  },
  groupName: {
    fontSize: 24,
    fontWeight: "800",
    color: colors.text,
    flex: 1,
    lineHeight: 30
  },
  kebabBtn: {
    padding: 4,
    marginLeft: spacing.sm
  },
  pendingBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3
  },
  pendingBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#fff"
  },

  // Pills
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.md
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
    flexDirection: "row",
    alignItems: "center",
    gap: 3
  },
  pillText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3
  },
  pillOpen: { backgroundColor: "#DCFCE7" },
  pillTextOpen: { color: "#15803D" },
  pillRTJ: { backgroundColor: "#DBEAFE" },
  pillTextRTJ: { color: "#1D4ED8" },
  pillInviteOnly: { backgroundColor: "#F3F4F6" },
  pillTextInviteOnly: { color: "#6B7280" },
  pillOwner: { backgroundColor: "#EEF2FF" },
  pillTextOwner: { color: "#4F46E5" },
  pillAdmin: { backgroundColor: "#FEF3C7" },
  pillTextAdmin: { color: "#92400E" },
  pillMember: { backgroundColor: "#DCFCE7" },
  pillTextMember: { color: "#15803D" },

  // Stats
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.sm
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  statText: {
    fontSize: 13,
    color: colors.textMuted
  },
  statSep: {
    fontSize: 13,
    color: colors.border
  },
  ownerText: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.sm
  },

  // Invite code
  inviteRow: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#C7D2FE"
  },
  inviteCodeBox: { flex: 1 },
  inviteLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#6366F1",
    textTransform: "uppercase",
    letterSpacing: 0.5
  },
  inviteCode: {
    marginTop: 2,
    fontSize: 18,
    fontWeight: "800",
    color: "#4F46E5",
    letterSpacing: 2
  },
  copyBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: "#4F46E5"
  },
  copyBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff"
  },

  // Generic card
  card: {
    backgroundColor: colors.surface,
    padding: spacing.xl,
    marginBottom: spacing.sm,
    ...shadows.card
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.md
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.accent
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    fontStyle: "italic"
  },

  // Description
  descriptionText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted
  },
  expandBtn: {
    marginTop: spacing.sm
  },
  expandBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.accent
  },

  // Markets
  marketRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    gap: spacing.sm
  },
  marketRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border
  },
  marketRowLeft: {
    flex: 1,
    gap: 4
  },
  marketTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    lineHeight: 20
  },
  marketMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.xs
  },
  marketCategory: {
    fontSize: 11,
    color: colors.textMuted
  },
  marketMetaText: {
    fontSize: 11,
    color: colors.textMuted
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: "700"
  },

  // Members preview
  memberPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border
  },
  avatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent + "20",
    alignItems: "center",
    justifyContent: "center"
  },
  avatarLetter: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.accent
  },
  memberUsername: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    flex: 1
  },
  rolePill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: "#EEF2FF"
  },
  rolePillText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#4F46E5",
    letterSpacing: 0.3,
    textTransform: "uppercase"
  },
  manageBtn: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border
  },
  manageBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.accent
  },

  // Sticky CTA bar
  ctaBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.xl,
    paddingBottom: 32,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.sm,
    ...shadows.card
  },
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.accent
  },
  ctaBtnDisabled: {
    backgroundColor: colors.border
  },
  ctaBtnMuted: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border
  },
  ctaBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.surface
  },
  ctaBtnTextMuted: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textMuted
  },
  ctaBtnGhost: {
    alignItems: "center",
    paddingVertical: 10
  },
  ctaBtnGhostText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.accent
  },
  decisionNote: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
    paddingHorizontal: spacing.md,
    fontStyle: "italic"
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
