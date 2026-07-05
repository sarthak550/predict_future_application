import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { radius, spacing } from "@predict-future/ui-tokens";
import type { ApiDiscoverGroup, ApiGroupSummary, AppMarketCategory } from "@predict-future/types";

import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";
import { SectionHelp } from "@/components/section-help";

// ── Category filter config ─────────────────────────────────────────────

type CategoryOption = { label: string; value: AppMarketCategory | "ALL" };

const CATEGORY_OPTIONS: CategoryOption[] = [
  { label: "All", value: "ALL" },
  { label: "Finance", value: "FINANCE" },
  { label: "Sports", value: "SPORTS" },
  { label: "Business", value: "BUSINESS" },
  { label: "Tech", value: "TECH" },
  { label: "Entertainment", value: "ENTERTAINMENT" },
  { label: "General", value: "GENERAL" }
];

type SortOption = "members" | "recent" | "new";

const SORT_OPTIONS: { label: string; value: SortOption }[] = [
  { label: "Members", value: "members" },
  { label: "Recent", value: "recent" },
  { label: "New", value: "new" }
];

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

// ── Types ─────────────────────────────────────────────────────────────

type MyGroup = ApiGroupSummary & { memberCount?: number; marketCount?: number };

// ── Shared style factory ───────────────────────────────────────────────

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: t.colors.background
  },
  scroll: { flex: 1 },
  content: {
    padding: spacing.lg,
    paddingBottom: 100
  },
  centerState: {
    flex: 1,
    paddingTop: 80,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md
  },

  // Header
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: t.colors.text,
    letterSpacing: -0.5
  },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: t.colors.accent
  },
  createBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: t.colors.surface
  },

  // Section block
  sectionBlock: {
    marginBottom: spacing.xl
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: t.colors.text,
  },
  sectionTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: spacing.md,
  },

  // Category filter
  filterScroll: {
    marginBottom: spacing.md
  },
  filterScrollContent: {
    gap: spacing.sm,
    paddingRight: spacing.md
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surface
  },
  filterChipActive: {
    borderColor: t.colors.accent,
    backgroundColor: t.colors.accent + "15"
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: t.colors.textMuted
  },
  filterChipTextActive: {
    color: t.colors.accent
  },

  // Sort
  sortRow: {
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: spacing.md
  },
  sortBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: t.colors.surfaceMuted
  },
  sortBtnActive: {
    backgroundColor: t.colors.accent
  },
  sortBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: t.colors.textMuted
  },
  sortBtnTextActive: {
    color: t.colors.surface
  },

  // Browse group list
  groupList: {
    gap: spacing.sm
  },

  // Discover card
  discoverCard: {
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    ...t.shadows.card
  },
  discoverThumb: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center"
  },
  discoverThumbLetter: {
    fontSize: 18,
    fontWeight: "800",
    color: "rgba(255,255,255,0.9)"
  },
  discoverInfo: {
    flex: 1,
    gap: 3
  },
  discoverName: {
    fontSize: 15,
    fontWeight: "700",
    color: t.colors.text
  },
  discoverMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    alignItems: "center"
  },
  discoverCategory: {
    fontSize: 11,
    fontWeight: "700"
  },
  discoverMetaText: {
    fontSize: 11,
    color: t.colors.textMuted
  },
  discoverDesc: {
    fontSize: 12,
    color: t.colors.textMuted,
    lineHeight: 16
  },
  joinBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: t.colors.accent
  },
  joinBtnJoined: {
    borderColor: "#15803D",
    backgroundColor: "#DCFCE7"
  },
  joinBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: t.colors.accent
  },
  joinBtnJoinedText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#15803D"
  },
  joinBtnDisabled: {
    opacity: 0.5
  },

  // Load more
  loadMoreBtn: {
    alignItems: "center",
    paddingVertical: spacing.md
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: "600",
    color: t.colors.accent
  },

  // My groups list
  listCard: {
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...t.shadows.card
  },
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: spacing.sm
  },
  groupRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.border
  },
  groupRowLeft: {
    flex: 1,
    gap: 3
  },
  groupName: {
    fontSize: 15,
    fontWeight: "700",
    color: t.colors.text
  },
  groupMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: 2
  },
  groupMetaText: {
    fontSize: 12,
    color: t.colors.textMuted
  },
  groupMetaSep: {
    fontSize: 12,
    color: t.colors.border
  },

  // Join by code
  joinCodeCard: {
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: spacing.md,
    ...t.shadows.card
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: t.colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: spacing.sm
  },
  joinCodeRow: {
    flexDirection: "row",
    gap: spacing.sm
  },
  joinCodeInput: {
    flex: 1,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: t.colors.border,
    backgroundColor: t.colors.background,
    fontSize: 15,
    fontWeight: "700",
    color: t.colors.text,
    letterSpacing: 1
  },
  joinCodeBtn: {
    width: 72,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: t.colors.accent,
    alignItems: "center",
    justifyContent: "center"
  },
  joinCodeBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: t.colors.surface
  },

  // Loader
  loaderBox: {
    alignItems: "center",
    paddingVertical: spacing.xl
  },

  // Error card — directional red, keep hardcoded
  errorCard: {
    backgroundColor: "#FEF2F2",
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: "#FECACA"
  },
  errorText: {
    fontSize: 14,
    color: "#DC2626",
    lineHeight: 20
  },
  retryBtn: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: t.colors.accent
  },
  retryLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: t.colors.surface
  },

  // Empty state card
  emptyCard: {
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
    ...t.shadows.card
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: t.colors.text,
    textAlign: "center",
    marginTop: spacing.xs
  },
  emptySubtitle: {
    fontSize: 14,
    color: t.colors.textMuted,
    textAlign: "center",
    lineHeight: 20
  },

  // Unauthenticated
  signInBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: t.colors.accent
  },
  signInBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: t.colors.surface
  },

  // S56: Pending requests row — status blue, intentionally hardcoded
  pendingRequestsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#DBEAFE",
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md
  },
  pendingRequestsText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: "#1D4ED8"
  },

  // S56: Request-to-join button — status blue, intentionally hardcoded
  joinBtnRTJ: {
    borderColor: "#1D4ED8",
    backgroundColor: "#EFF6FF"
  },
  joinBtnRTJText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1D4ED8"
  },

  // Misc
  btnDisabled: {
    opacity: 0.5
  }
});

// ── Screen ────────────────────────────────────────────────────────────

export default function GroupsScreen() {
  const { session, status: sessionStatus } = useSession();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  // Browse state
  const [browseGroups, setBrowseGroups] = useState<ApiDiscoverGroup[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseLoadingMore, setBrowseLoadingMore] = useState(false);
  const [browseCursor, setBrowseCursor] = useState<string | null>(null);
  const [browseCategory, setBrowseCategory] = useState<AppMarketCategory | "ALL">("ALL");
  const [browseSort, setBrowseSort] = useState<SortOption>("members");
  const [browseError, setBrowseError] = useState<string | null>(null);

  // My groups state
  const [myGroups, setMyGroups] = useState<MyGroup[]>([]);
  const [myGroupsLoading, setMyGroupsLoading] = useState(false);

  // S56: Pending join requests count for the "My pending requests" row
  const [pendingRequestCount, setPendingRequestCount] = useState(0);

  // Join by code state
  const [codeInput, setCodeInput] = useState("");
  const [joiningByCode, setJoiningByCode] = useState(false);

  // General refresh
  const [refreshing, setRefreshing] = useState(false);

  // Track which group ids the user just joined (for optimistic UI)
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());

  // ── Data loaders ───────────────────────────────────────────────────

  const loadBrowse = useCallback(
    async (reset = false) => {
      if (reset) {
        setBrowseLoading(true);
        setBrowseCursor(null);
      }
      setBrowseError(null);
      try {
        const res = await mobileApi.discoverGroups({
          ...(browseCategory !== "ALL" ? { category: browseCategory } : {}),
          sort: browseSort,
          limit: 20
        });
        if (reset) {
          setBrowseGroups(res.groups);
        } else {
          setBrowseGroups((prev) => [...prev, ...res.groups]);
        }
        setBrowseCursor(res.nextCursor);
      } catch (err) {
        setBrowseError(
          err instanceof Error ? err.message : "Failed to load groups."
        );
      } finally {
        setBrowseLoading(false);
        setBrowseLoadingMore(false);
      }
    },
    [browseCategory, browseSort]
  );

  const loadMyGroups = useCallback(async () => {
    if (!session) return;
    setMyGroupsLoading(true);
    try {
      const [groupsRes, requestsRes] = await Promise.all([
        mobileApi.getMyGroups(),
        mobileApi.getMyGroupJoinRequests().catch(() => ({ requests: [] }))
      ]);
      setMyGroups(groupsRes.groups ?? []);
      // Count only PENDING requests for the row badge.
      const pending = requestsRes.requests.filter((r) => r.status === "PENDING").length;
      setPendingRequestCount(pending);
    } catch {
      // Silent — my groups is secondary UI
    } finally {
      setMyGroupsLoading(false);
    }
  }, [session]);

  // Reload browse whenever filter/sort changes
  useEffect(() => {
    void loadBrowse(true);
  }, [loadBrowse]);

  // Reload my groups when tab gains focus
  useFocusEffect(
    useCallback(() => {
      void loadMyGroups();
    }, [loadMyGroups])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([loadBrowse(true), loadMyGroups()]);
    setRefreshing(false);
  }

  async function handleLoadMore() {
    if (!browseCursor || browseLoadingMore) return;
    setBrowseLoadingMore(true);
    try {
      const res = await mobileApi.discoverGroups({
        ...(browseCategory !== "ALL" ? { category: browseCategory } : {}),
        sort: browseSort,
        cursor: browseCursor,
        limit: 20
      });
      setBrowseGroups((prev) => [...prev, ...res.groups]);
      setBrowseCursor(res.nextCursor);
    } catch {
      // Silently fail load-more
    } finally {
      setBrowseLoadingMore(false);
    }
  }

  // ── Join handlers ──────────────────────────────────────────────────

  async function handleJoinOpen(group: ApiDiscoverGroup) {
    if (!session) {
      router.push("/(auth)/sign-in");
      return;
    }
    try {
      await mobileApi.joinOpenGroup(group.id);
      setJoinedIds((prev) => new Set([...prev, group.id]));
      void loadMyGroups();
    } catch (err: unknown) {
      Alert.alert(
        "Could not join",
        err instanceof Error ? err.message : "Something went wrong."
      );
    }
  }

  async function handleJoinByCode() {
    const code = codeInput.trim().toUpperCase();
    if (!code) {
      Alert.alert("Enter a code", "Please enter an invite code.");
      return;
    }
    setJoiningByCode(true);
    try {
      const res = await mobileApi.joinGroup({ inviteCode: code });
      setCodeInput("");
      void loadMyGroups();
      router.push(`/group/${res.group.id}`);
    } catch (err) {
      Alert.alert(
        "Could not join",
        err instanceof Error ? err.message : "Invalid invite code."
      );
    } finally {
      setJoiningByCode(false);
    }
  }

  // ── Auth gate ──────────────────────────────────────────────────────

  if (sessionStatus === "loading") {
    return (
      <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Screen header */}
        <View style={styles.headerRow}>
          <Text style={styles.screenTitle}>Groups</Text>
          <Pressable
            style={styles.createBtn}
            onPress={() => router.push("/(tabs)/create")}
          >
            <Ionicons name="add" size={16} color={colors.surface} />
            <Text style={styles.createBtnText}>New Group</Text>
          </Pressable>
        </View>

        {/* ── Browse Section ──────────────────────────────────────── */}
        <View style={styles.sectionBlock}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>Browse Groups</Text>
            <SectionHelp helpKey="groups-browse" />
          </View>

          {/* Category filter chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterScroll}
            contentContainerStyle={styles.filterScrollContent}
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                style={[
                  styles.filterChip,
                  browseCategory === opt.value && styles.filterChipActive
                ]}
                onPress={() => setBrowseCategory(opt.value)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    browseCategory === opt.value && styles.filterChipTextActive
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Sort selector */}
          <View style={styles.sortRow}>
            {SORT_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                style={[
                  styles.sortBtn,
                  browseSort === opt.value && styles.sortBtnActive
                ]}
                onPress={() => setBrowseSort(opt.value)}
              >
                <Text
                  style={[
                    styles.sortBtnText,
                    browseSort === opt.value && styles.sortBtnTextActive
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Browse list */}
          {browseLoading ? (
            <View style={styles.loaderBox}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : browseError ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{browseError}</Text>
              <Pressable onPress={() => loadBrowse(true)} style={styles.retryBtn}>
                <Text style={styles.retryLabel}>Retry</Text>
              </Pressable>
            </View>
          ) : browseGroups.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="people-circle-outline" size={32} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>
                No groups in{" "}
                {browseCategory === "ALL" ? "any category" : categoryLabel(browseCategory)} yet
              </Text>
              <Text style={styles.emptySubtitle}>
                Create one!
              </Text>
            </View>
          ) : (
            <View style={styles.groupList}>
              {browseGroups.map((group) => (
                <DiscoverGroupCard
                  key={group.id}
                  group={group}
                  isJoined={joinedIds.has(group.id)}
                  isLoggedIn={Boolean(session)}
                  onJoin={() => handleJoinOpen(group)}
                  onNavigate={() => router.push(`/group/${group.id}`)}
                />
              ))}
              {browseCursor ? (
                <Pressable
                  style={styles.loadMoreBtn}
                  onPress={handleLoadMore}
                  disabled={browseLoadingMore}
                >
                  {browseLoadingMore ? (
                    <ActivityIndicator color={colors.accent} size="small" />
                  ) : (
                    <Text style={styles.loadMoreText}>Load more</Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          )}
        </View>

        {/* ── My Groups Section ───────────────────────────────────── */}
        {session ? (
          <View style={styles.sectionBlock}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>My Groups</Text>
              <SectionHelp helpKey="groups-my-groups" />
            </View>

            {/* S56: "My pending requests" entry — only visible when N > 0 */}
            {pendingRequestCount > 0 ? (
              <Pressable
                style={styles.pendingRequestsRow}
                onPress={() => router.push("/my-join-requests")}
              >
                <Ionicons name="time-outline" size={18} color="#1D4ED8" />
                <Text style={styles.pendingRequestsText}>
                  Pending requests ({pendingRequestCount})
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </Pressable>
            ) : null}

            {/* Join by invite code */}
            <JoinByCodeSection
              value={codeInput}
              onChange={setCodeInput}
              onJoin={handleJoinByCode}
              loading={joiningByCode}
            />

            {myGroupsLoading ? (
              <View style={styles.loaderBox}>
                <ActivityIndicator color={colors.accent} size="small" />
              </View>
            ) : myGroups.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="people-circle-outline" size={28} color={colors.textMuted} />
                <Text style={styles.emptyTitle}>Not in any groups yet</Text>
                <Text style={styles.emptySubtitle}>
                  Join an open group above or enter an invite code.
                </Text>
              </View>
            ) : (
              <View style={styles.listCard}>
                {myGroups.map((group, index) => (
                  <Pressable
                    key={group.id}
                    style={[styles.groupRow, index > 0 && styles.groupRowBorder]}
                    onPress={() => router.push(`/group/${group.id}`)}
                  >
                    <View style={styles.groupRowLeft}>
                      <Text style={styles.groupName} numberOfLines={1}>
                        {group.name}
                      </Text>
                      <View style={styles.groupMeta}>
                        {group.category ? (
                          <Text style={[styles.groupMetaText, { color: categoryColor(group.category) }]}>
                            {categoryLabel(group.category)}
                          </Text>
                        ) : null}
                        {group.category ? <Text style={styles.groupMetaSep}>·</Text> : null}
                        <Text style={styles.groupMetaText}>
                          {group.memberCount ?? 0} members
                        </Text>
                        <Text style={styles.groupMetaSep}>·</Text>
                        <Text style={styles.groupMetaText}>
                          {group.marketCount ?? 0} markets
                        </Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={styles.sectionBlock}>
            <UnauthenticatedState onSignIn={() => router.push("/(auth)/sign-in")} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Discover Group Card ───────────────────────────────────────────────

function DiscoverGroupCard({
  group,
  isJoined,
  isLoggedIn,
  onJoin,
  onNavigate
}: {
  group: ApiDiscoverGroup;
  isJoined: boolean;
  isLoggedIn: boolean;
  onJoin: () => void;
  onNavigate: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [joining, setJoining] = useState(false);

  async function handleJoin() {
    setJoining(true);
    try {
      await onJoin();
    } finally {
      setJoining(false);
    }
  }

  return (
    <Pressable style={styles.discoverCard} onPress={onNavigate}>
      {/* Cover thumb */}
      <View
        style={[styles.discoverThumb, { backgroundColor: categoryColor(group.category) }]}
      >
        <Text style={styles.discoverThumbLetter}>
          {group.name.charAt(0).toUpperCase()}
        </Text>
      </View>

      {/* Info */}
      <View style={styles.discoverInfo}>
        <Text style={styles.discoverName} numberOfLines={1}>
          {group.name}
        </Text>
        <View style={styles.discoverMeta}>
          {group.category ? (
            <Text
              style={[
                styles.discoverCategory,
                { color: categoryColor(group.category) }
              ]}
            >
              {categoryLabel(group.category)}
            </Text>
          ) : null}
          <Text style={styles.discoverMetaText}>{group.memberCount} members</Text>
          {group.recentMarketCount > 0 ? (
            <Text style={styles.discoverMetaText}>
              {group.recentMarketCount} active markets
            </Text>
          ) : null}
        </View>
        {group.description ? (
          <Text style={styles.discoverDesc} numberOfLines={1}>
            {group.description}
          </Text>
        ) : null}
      </View>

      {/* Join button */}
      {isJoined ? (
        <View style={[styles.joinBtn, styles.joinBtnJoined]}>
          <Ionicons name="checkmark" size={13} color="#15803D" />
          <Text style={styles.joinBtnJoinedText}>Joined</Text>
        </View>
      ) : group.visibility === "REQUEST_TO_JOIN" ? (
        // S56: REQUEST_TO_JOIN — tapping navigates to group profile where the full
        // state machine (submit/pending/rejected) lives. We don't inline it here to
        // avoid duplicating state management in the discover list.
        <Pressable
          style={[styles.joinBtn, styles.joinBtnRTJ]}
          onPress={(e) => {
            e.stopPropagation?.();
            onNavigate();
          }}
        >
          <Text style={styles.joinBtnRTJText}>Request</Text>
        </Pressable>
      ) : (
        <Pressable
          style={[styles.joinBtn, joining && styles.joinBtnDisabled]}
          onPress={(e) => {
            e.stopPropagation?.();
            void handleJoin();
          }}
          disabled={joining}
        >
          {joining ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <Text style={styles.joinBtnText}>Join</Text>
          )}
        </Pressable>
      )}
    </Pressable>
  );
}

// ── Join by Code ──────────────────────────────────────────────────────

function JoinByCodeSection({
  value,
  onChange,
  onJoin,
  loading
}: {
  value: string;
  onChange: (text: string) => void;
  onJoin: () => void;
  loading: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.joinCodeCard}>
      <Text style={styles.sectionLabel}>Join with invite code</Text>
      <View style={styles.joinCodeRow}>
        <TextInput
          style={styles.joinCodeInput}
          placeholder="e.g. AB12CD34"
          placeholderTextColor={colors.textMuted}
          value={value}
          onChangeText={onChange}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={onJoin}
          editable={!loading}
        />
        <Pressable
          style={[styles.joinCodeBtn, loading && styles.btnDisabled]}
          onPress={onJoin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.surface} size="small" />
          ) : (
            <Text style={styles.joinCodeBtnText}>Join</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ── Unauthenticated State ─────────────────────────────────────────────

function UnauthenticatedState({ onSignIn }: { onSignIn: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.emptyCard}>
      <Ionicons name="people-outline" size={40} color={colors.textMuted} />
      <Text style={styles.emptyTitle}>Sign in to join groups</Text>
      <Text style={styles.emptySubtitle}>
        Groups let you predict with friends and compete on private leaderboards.
      </Text>
      <Pressable style={styles.signInBtn} onPress={onSignIn}>
        <Text style={styles.signInBtnText}>Sign In</Text>
      </Pressable>
    </View>
  );
}
