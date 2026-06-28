import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { GradientHeader } from "@/components/gradient-header";

import type { ApiDiscoverGroup, ApiGroupSummary, ApiMarketSummary, ApiPollListItem } from "@predict-future/types";
import { radius, spacing } from "@predict-future/ui-tokens";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

import {
  CategoryFilterBar,
  FILTER_BAR_CATEGORIES,
  type CategoryKey,
} from "@/components/category-filter-bar";
import { CommunitiesList } from "@/components/communities-list";
import { MarketSummaryCard } from "@/components/market-summary-card";
import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";

// ── constants ───────────────────────────────────────────────────────

type MarketMode = "public" | "private" | "polls";
type StatusTab = "all" | "live" | "ended" | "settled" | "saved";
type MarketSort = "new" | "rank" | "close_at" | "volume";

// Merged view-selector chips: each chip sets both statusTab + sort atomically.
type ViewChip = {
  label: string;
  statusTab: StatusTab;
  sort: MarketSort;
};

const VIEW_CHIPS: ViewChip[] = [
  { label: "All",          statusTab: "all",     sort: "new"      },
  { label: "Trending",     statusTab: "live",    sort: "rank"     },
  { label: "New",          statusTab: "live",    sort: "new"      },
  { label: "Closing Soon", statusTab: "live",    sort: "close_at" },
  { label: "Most Active",  statusTab: "live",    sort: "volume"   },
  { label: "Settled",      statusTab: "settled", sort: "new"      },
  { label: "Cancelled",    statusTab: "ended",   sort: "new"      },
  { label: "Saved",        statusTab: "saved",   sort: "new"      },
];

// CATEGORIES is provided by the shared CategoryFilterBar via FILTER_BAR_CATEGORIES.

const LIVE_STATUSES = new Set(["OPEN"]);
const ENDED_STATUSES = new Set(["CLOSED", "CANCELLED", "AWAITING_RESOLUTION"]);
const SETTLED_STATUSES = new Set(["RESOLVED", "RESOLVING"]);

function matchesStatusTab(status: string | undefined, tab: StatusTab) {
  const s = status ?? "OPEN";
  if (tab === "all") return true;
  if (tab === "live") return LIVE_STATUSES.has(s);
  if (tab === "ended") return ENDED_STATUSES.has(s);
  return SETTLED_STATUSES.has(s);
}

// "All" view ordering bucket: live/open markets first (0), then markets still
// pending an outcome (1), with resolved/settled markets last (2). Within a bucket
// we order by marketRankScore, which already blends popularity (participants,
// volume, engagement) with recency — so new + popular markets float to the top.
function allViewStatusGroup(status: string | undefined): number {
  const s = status ?? "OPEN";
  if (LIVE_STATUSES.has(s)) return 0;
  if (SETTLED_STATUSES.has(s)) return 2;
  return 1; // CLOSED / CANCELLED / AWAITING_RESOLUTION
}

// ── screen ──────────────────────────────────────────────────────────

export default function MarketsScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [mode, setMode] = useState<MarketMode>("public");
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [category, setCategory] = useState<CategoryKey>("ALL");
  const [selectedGroupId, setSelectedGroupId] = useState<string>("ALL");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [pollFilter, setPollFilter] = useState<"all" | "voted" | "not_voted">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<MarketSort>("new");

  // Reset category filter when switching status tabs (category filter only applies on "live")
  useEffect(() => {
    setCategory("ALL");
  }, [statusTab]);

  // Reset search when switching away from public mode
  useEffect(() => {
    if (mode !== "public") {
      setSearchQuery("");
    }
  }, [mode]);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // ── polls ────────────────────────────────────────────────────────

  const pollsFetcher = useCallback(
    () => mobileApi.getPolls({ status: "all" }),
    []
  );
  const pollsQuery = useApiQuery<{ polls: ApiPollListItem[] }>(pollsFetcher, [mode === "polls"], {
    enabled: mode === "polls",
    errorFallback: "Unable to load polls.",
  });

  const allPolls = pollsQuery.data?.polls ?? [];
  const filteredPolls = useMemo(() => {
    if (pollFilter === "voted") return allPolls.filter((p) => p.userVote !== null);
    if (pollFilter === "not_voted") return allPolls.filter((p) => p.userVote === null && p.status === "OPEN");
    return allPolls;
  }, [allPolls, pollFilter]);

  // ── public markets (cursor pagination, S30-T5) ────────────────────

  const [publicMarkets, setPublicMarkets] = useState<ApiMarketSummary[]>([]);
  const [publicLoading, setPublicLoading] = useState(false);
  const [publicError, setPublicError] = useState<string | null>(null);
  const [publicCursor, setPublicCursor] = useState<string | null>(null);
  const [publicHasMore, setPublicHasMore] = useState(true);
  const [publicStatus, setPublicStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const publicInFlight = useRef(false);

  const loadPublicMarkets = useCallback(async (mode_: "replace" | "append", cursorVal: string | null, sortVal: MarketSort, tab: StatusTab) => {
    if (publicInFlight.current) return;
    publicInFlight.current = true;
    if (mode_ === "replace") {
      setPublicLoading(true);
      setPublicError(null);
      setPublicStatus("loading");
    }
    try {
      // Server-side status filter: live → OPEN, settled → RESOLVED. ended tab covers 3 statuses so we leave it unfiltered.
      const serverStatus = tab === "live" ? "OPEN" : tab === "settled" ? "RESOLVED" : undefined;
      const res = await mobileApi.getPublicMarkets({
        sort: sortVal,
        cursor: cursorVal ?? undefined,
        status: serverStatus,
      });
      const newMarkets = res.markets ?? [];
      setPublicMarkets((prev) => {
        const base = mode_ === "replace" ? [] : prev;
        const seen = new Set(base.map((m) => m.id));
        const merged = [...base];
        for (const m of newMarkets) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            merged.push(m);
          }
        }
        return merged;
      });
      setPublicCursor(res.nextCursor ?? null);
      setPublicHasMore(res.hasMore ?? false);
      setPublicError(null);
      setPublicStatus("success");
    } catch (err) {
      setPublicError(err instanceof Error ? err.message : "Unable to load markets.");
      setPublicStatus("error");
    } finally {
      setPublicLoading(false);
      publicInFlight.current = false;
    }
  }, []);

  // Initial fetch and re-fetch when sort OR status tab changes.
  useEffect(() => {
    if (mode !== "public") return;
    setPublicCursor(null);
    setPublicHasMore(true);
    void loadPublicMarkets("replace", null, sort, statusTab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sort, statusTab]);

  function handlePublicEndReached() {
    if (publicHasMore && !publicInFlight.current && mode === "public") {
      void loadPublicMarkets("append", publicCursor, sort, statusTab);
    }
  }

  function handlePublicRefresh() {
    setPublicCursor(null);
    setPublicHasMore(true);
    void loadPublicMarkets("replace", null, sort, statusTab);
  }

  // Wrap in a publicQuery-compatible shape for the rest of the render logic.
  const publicQuery = {
    data: { markets: publicMarkets },
    loading: publicLoading,
    error: publicError,
    status: publicStatus,
    refetch: handlePublicRefresh,
  };

  // ── discover groups (community spotlight + rail) ──────────────────
  // Single fetch of limit=8: results[0] → spotlight, results[0..7] → rail.
  // Independent from markets list — do NOT bundle into Promise.all.

  const [discoverGroups, setDiscoverGroups] = useState<ApiDiscoverGroup[]>([]);

  const loadDiscoverGroups = useCallback(() => {
    mobileApi
      .discoverGroups({ sort: "members", limit: 8 })
      .then((res) => setDiscoverGroups(res.groups))
      .catch(() => setDiscoverGroups([]));
  }, []);

  useEffect(() => {
    if (mode === "public") {
      loadDiscoverGroups();
    }
  }, [mode, loadDiscoverGroups]);

  // ── saved markets ─────────────────────────────────────────────────

  const [savedMarkets, setSavedMarkets] = useState<ApiMarketSummary[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);

  const loadSavedMarkets = useCallback(async () => {
    setSavedLoading(true);
    setSavedError(null);
    try {
      const res = await mobileApi.getSavedMarkets({ limit: 50 });
      setSavedMarkets(res.markets);
    } catch {
      setSavedError("Unable to load saved markets.");
    } finally {
      setSavedLoading(false);
    }
  }, []);

  // Fetch saved markets when the "saved" tab becomes active
  useEffect(() => {
    if (mode === "public" && statusTab === "saved") {
      void loadSavedMarkets();
    }
  }, [mode, statusTab, loadSavedMarkets]);

  // ── search ────────────────────────────────────────────────────────

  const searchFetcher = useCallback(
    () => mobileApi.getPublicMarkets({ q: debouncedQuery, limit: 20 }),
    [debouncedQuery]
  );
  const searchQuery_result = useApiQuery<{ markets: ApiMarketSummary[] }>(
    searchFetcher,
    [debouncedQuery],
    {
      enabled: debouncedQuery.length > 0,
      errorFallback: "Unable to search markets.",
    }
  );

  const isSearchMode = debouncedQuery.length > 0 || searchQuery.length > 0;
  const searchInFlight = searchQuery !== debouncedQuery;
  const searchLoading = searchInFlight || searchQuery_result.loading;

  // ── private: user's groups ────────────────────────────────────────

  const groupsFetcher = useCallback(
    () => mobileApi.getMyGroups(),
    []
  );
  const groupsQuery = useApiQuery<{
    groups: Array<ApiGroupSummary & { memberCount?: number; marketCount?: number }>;
  }>(groupsFetcher, [mode === "private"], {
    enabled: mode === "private",
    errorFallback: "Unable to load groups.",
  });

  const groups = groupsQuery.data?.groups ?? [];

  // Fetch each group's markets individually and cache them
  const [groupMarketsMap, setGroupMarketsMap] = useState<Record<string, ApiMarketSummary[]>>({});
  const [groupMarketsLoading, setGroupMarketsLoading] = useState(false);

  const fetchAllGroupMarkets = useCallback(async () => {
    if (groups.length === 0) return;
    setGroupMarketsLoading(true);
    const map: Record<string, ApiMarketSummary[]> = {};
    await Promise.all(
      groups.map(async (g) => {
        try {
          const detail = await mobileApi.getGroupById(g.id);
          const group = (detail as { group?: { markets?: ApiMarketSummary[] } }).group;
          map[g.id] = (group?.markets ?? []) as ApiMarketSummary[];
        } catch {
          map[g.id] = [];
        }
      })
    );
    setGroupMarketsMap(map);
    setGroupMarketsLoading(false);
  }, [groups]);

  useEffect(() => {
    if (mode === "private" && groups.length > 0) {
      fetchAllGroupMarkets();
    }
  }, [mode, fetchAllGroupMarkets]);

  const groupMarkets = useMemo(() => {
    if (selectedGroupId === "ALL") {
      // Merge all, dedupe by id
      const seen = new Set<string>();
      const merged: ApiMarketSummary[] = [];
      for (const markets of Object.values(groupMarketsMap)) {
        for (const m of markets) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            merged.push(m);
          }
        }
      }
      return merged;
    }
    return groupMarketsMap[selectedGroupId] ?? [];
  }, [selectedGroupId, groupMarketsMap]);

  // ── derived data ──────────────────────────────────────────────────

  const allMarkets = mode === "public" ? publicQuery.data?.markets ?? [] : groupMarkets;
  const loading =
    mode === "public"
      ? statusTab === "saved"
        ? savedLoading
        : publicQuery.loading
      : groupMarketsLoading || groupsQuery.loading;
  const error =
    mode === "public"
      ? statusTab === "saved"
        ? savedError
        : publicQuery.error
      : groupsQuery.error;
  const queryStatus = mode === "public" ? publicQuery.status : groupsQuery.status;

  // Filter: status → category (client-side; no re-fetch on category change)
  const filteredMarkets = useMemo(() => {
    if (statusTab === "saved") {
      // Saved tab: use savedMarkets directly (already fetched from dedicated endpoint)
      const seen = new Set<string>();
      return savedMarkets.filter((m) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });
    }
    let result = allMarkets.filter((m) => matchesStatusTab(m.status, statusTab));
    if (mode === "public" && (statusTab === "live" || statusTab === "all") && category !== "ALL") {
      result = result.filter((m) => (m.category as string) === category);
    }
    // Defensive dedupe: even if upstream returns duplicates, FlatList must see unique keys.
    const seen = new Set<string>();
    const deduped = result.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
    // "All" view: live/new markets at the top, resolved/settled at the bottom,
    // ranked within each bucket by popularity + recency (marketRankScore).
    if (statusTab === "all") {
      deduped.sort((a, b) => {
        const groupDelta = allViewStatusGroup(a.status) - allViewStatusGroup(b.status);
        if (groupDelta !== 0) return groupDelta;
        return (b.marketRankScore ?? 0) - (a.marketRankScore ?? 0);
      });
    }
    return deduped;
  }, [allMarkets, savedMarkets, statusTab, category, mode]);

  const handleRefresh = useCallback(() => {
    if (mode === "public") {
      if (statusTab === "saved") {
        void loadSavedMarkets();
      } else {
        publicQuery.refetch();
        // Refresh community surfaces independently
        loadDiscoverGroups();
      }
    } else if (mode === "polls") {
      pollsQuery.refetch();
    } else {
      groupsQuery.refetch();
      fetchAllGroupMarkets();
    }
  }, [mode, statusTab, publicQuery, pollsQuery, groupsQuery, fetchAllGroupMarkets, loadSavedMarkets, loadDiscoverGroups]);

  // ── render ────────────────────────────────────────────────────────

  if (mode === "polls") {
    return (
      <PollsScreen
        polls={filteredPolls}
        allPolls={allPolls}
        filter={pollFilter}
        onFilterChange={setPollFilter}
        loading={pollsQuery.loading}
        error={pollsQuery.error}
        onRefresh={pollsQuery.refetch}
        onBack={() => setMode("public")}
      />
    );
  }

  if (loading && allMarkets.length === 0 && queryStatus !== "success") {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <GradientHeader
        title="Explore"
        right={
          <View style={styles.searchRow}>
            <Feather name="search" size={16} color="rgba(255,255,255,0.85)" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search markets..."
              placeholderTextColor="rgba(255,255,255,0.6)"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchLoading && mode === "public" ? (
              <ActivityIndicator size="small" color="rgba(255,255,255,0.85)" />
            ) : searchQuery.length > 0 ? (
              <Pressable onPress={() => setSearchQuery("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="x" size={16} color="rgba(255,255,255,0.85)" />
              </Pressable>
            ) : null}
          </View>
        }
      />

      {/* ── Level 1: Public / Private / Polls toggle ── */}
      <View style={styles.modeRow}>
        <Pressable
          style={[styles.modeBtn, mode === "public" && styles.modeBtnActive]}
          onPress={() => { setMode("public"); setStatusTab("live"); }}
        >
          <Text style={[styles.modeBtnText, mode === "public" && styles.modeBtnTextActive]}>
            Markets
          </Text>
        </Pressable>
        <Pressable
          style={[styles.modeBtn, mode === "private" && styles.modeBtnActive]}
          onPress={() => { setMode("private"); setStatusTab("live"); }}
        >
          <Text style={[styles.modeBtnText, mode === "private" && styles.modeBtnTextActive]}>
            My Groups
          </Text>
        </Pressable>
        <Pressable
          style={[styles.modeBtn, (mode as MarketMode) === "polls" && styles.modeBtnActive]}
          onPress={() => setMode("polls")}
        >
          <Text style={[styles.modeBtnText, (mode as MarketMode) === "polls" && styles.modeBtnTextActive]}>
            Polls
          </Text>
        </Pressable>
      </View>

      {/* ── Merged view-selector chip row (public mode, hidden in search mode) ── */}
      {mode === "public" && !isSearchMode ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.sortScroll}
          contentContainerStyle={styles.sortRow}
        >
          {VIEW_CHIPS.map((chip) => {
            const isLiveView = chip.statusTab === "live";
            const active = isLiveView
              ? statusTab === "live" && sort === chip.sort
              : statusTab === chip.statusTab;
            return (
              <Pressable
                key={chip.label}
                style={[styles.sortChip, active && styles.sortChipActive]}
                onPress={() => { setStatusTab(chip.statusTab); setSort(chip.sort); }}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.sortChipText, active && styles.sortChipTextActive]}
                >
                  {chip.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {/* ── Group dropdown (private only) ── */}
      {mode === "private" ? (
        groups.length > 0 ? (
          <View style={styles.dropdownWrapper}>
            <Pressable
              style={styles.dropdownTrigger}
              onPress={() => setDropdownOpen((prev) => !prev)}
            >
              <Text style={styles.dropdownTriggerText} numberOfLines={1}>
                {selectedGroupId === "ALL"
                  ? "All Groups"
                  : groups.find((g) => g.id === selectedGroupId)?.name ?? "All Groups"}
              </Text>
              <Text style={styles.dropdownArrow}>{dropdownOpen ? "▲" : "▼"}</Text>
            </Pressable>
            {dropdownOpen ? (
              <View style={styles.dropdownMenu}>
                <Pressable
                  style={[styles.dropdownItem, selectedGroupId === "ALL" && styles.dropdownItemActive]}
                  onPress={() => { setSelectedGroupId("ALL"); setDropdownOpen(false); }}
                >
                  <Text style={[styles.dropdownItemText, selectedGroupId === "ALL" && styles.dropdownItemTextActive]}>
                    All Groups
                  </Text>
                </Pressable>
                {groups.map((group) => (
                  <View
                    key={group.id}
                    style={[styles.dropdownItem, selectedGroupId === group.id && styles.dropdownItemActive]}
                  >
                    <Pressable
                      style={styles.dropdownItemMain}
                      onPress={() => { setSelectedGroupId(group.id); setDropdownOpen(false); }}
                    >
                      <Text
                        style={[styles.dropdownItemText, selectedGroupId === group.id && styles.dropdownItemTextActive]}
                        numberOfLines={1}
                      >
                        {group.name}
                      </Text>
                      {group.marketCount != null ? (
                        <Text style={styles.dropdownItemCount}>{group.marketCount}</Text>
                      ) : null}
                    </Pressable>
                    <Pressable
                      style={styles.dropdownItemViewBtn}
                      onPress={() => { setDropdownOpen(false); router.push(`/group/${group.id}`); }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Feather name="chevron-right" size={16} color={colors.textMuted} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : groupsQuery.status === "success" ? (
          <View style={styles.noGroupsBanner}>
            <Text style={styles.noGroupsText}>
              No groups yet — create or join one from the Create tab.
            </Text>
          </View>
        ) : null
      ) : null}

      {/* ── Category filter bar (public Explore mode, All/Live tabs, not searching) ──
          Rendered non-elevated so it shares the screen background with the
          view-selector row above — the two pill rows read as one filter system. */}
      {mode === "public" && (statusTab === "all" || statusTab === "live") && !isSearchMode ? (
        <CategoryFilterBar
          selected={category}
          onSelect={setCategory}
          categories={FILTER_BAR_CATEGORIES}
        />
      ) : null}

      {/* ── Market list ── */}
      <FlatList
        data={isSearchMode ? (searchQuery_result.data?.markets ?? []) : filteredMarkets}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={handleRefresh} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          /* S55-T7: spotlight + rail live in My Groups sub-tab (Discover communities
              section). Explore stays pure markets; communities still surface
              contextually via the Hosted-by chip on every group-linked market card. */
          !isSearchMode && mode === "private" && discoverGroups.length > 0 ? (
            <View style={styles.discoverSection}>
              <Text style={styles.discoverSectionHeader}>Discover communities</Text>
              <CommunitiesList groups={discoverGroups} limit={5} />
            </View>
          ) : null
        }
        onEndReachedThreshold={0.3}
        onEndReached={() => {
          if (mode === "public" && !isSearchMode) {
            handlePublicEndReached();
          }
        }}
        ListFooterComponent={
          mode === "public" && !isSearchMode && publicHasMore && publicLoading ? (
            <View style={styles.footerSpinner}>
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : (
            // S55-T7: subtle bottom-of-feed CTA into community discovery
            // (the My Groups sub-tab also surfaces spotlight + rail there).
            !isSearchMode && mode === "public" && statusTab === "live" ? (
              <Pressable
                style={({ pressed }) => [
                  styles.discoverCommunitiesCta,
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => { setMode("private"); setStatusTab("live"); }}
                accessibilityRole="button"
                accessibilityLabel="Browse communities to join"
              >
                <Feather name="users" size={14} color={colors.accent} />
                <Text style={styles.discoverCommunitiesCtaText}>
                  Find a community to join
                </Text>
                <Feather name="arrow-right" size={14} color={colors.accent} />
              </Pressable>
            ) : null
          )
        }
        renderItem={({ item }) => <MarketSummaryCard item={item} />}
        ListEmptyComponent={
          isSearchMode ? (
            searchLoading ? null : (
              <View style={[styles.emptyCard, { alignItems: "center" }]}>
                <Text style={styles.emptyTitle}>
                  {`No markets found for "${debouncedQuery}"`}
                </Text>
                <Pressable onPress={() => setSearchQuery("")} style={[styles.retry, { marginTop: 12 }]}>
                  <Text style={styles.retryLabel}>Clear search</Text>
                </Pressable>
              </View>
            )
          ) : error ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Something went wrong</Text>
              <Text style={styles.emptyText}>{error}</Text>
              <Pressable onPress={handleRefresh} style={styles.retry}>
                <Text style={styles.retryLabel}>Retry</Text>
              </Pressable>
            </View>
          ) : category !== "ALL" ? (
            // Category-filtered empty state with Show All CTA
            <View style={[styles.emptyCard, { alignItems: "center" }]}>
              <Text style={styles.emptyTitle}>
                {`No markets in ${FILTER_BAR_CATEGORIES.find((c) => c.key === category)?.label ?? category}`}
              </Text>
              <Text style={styles.emptyText}>
                No live markets in this category right now.
              </Text>
              <Pressable
                onPress={() => setCategory("ALL")}
                style={[styles.retry, { marginTop: 12 }]}
                accessibilityRole="button"
                accessibilityLabel="Show all categories"
              >
                <Text style={styles.retryLabel}>Show All</Text>
              </Pressable>
            </View>
          ) : statusTab === "saved" ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No saved markets</Text>
              <Text style={styles.emptyText}>
                Tap the bookmark icon on any market to save it for later.
              </Text>
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                {mode === "private" && !selectedGroupId
                  ? "Pick a group"
                  : statusTab === "live"
                    ? "No live markets"
                    : statusTab === "ended"
                      ? "No cancelled markets"
                      : "No settled markets"}
              </Text>
              <Text style={styles.emptyText}>
                {mode === "private" && !selectedGroupId
                  ? "Select a group above to browse its markets."
                  : "Check back later."}
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

// ── Polls Screen ────────────────────────────────────────────────────

const POLL_FILTERS: { key: "all" | "voted" | "not_voted"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "voted", label: "Voted" },
  { key: "not_voted", label: "Not Voted" },
];

function PollsScreen({
  polls,
  allPolls,
  filter,
  onFilterChange,
  loading,
  error,
  onRefresh,
  onBack,
}: {
  polls: ApiPollListItem[];
  allPolls: ApiPollListItem[];
  filter: "all" | "voted" | "not_voted";
  onFilterChange: (f: "all" | "voted" | "not_voted") => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const pollStyles = useThemedStyles(makePollStyles);
  const votedCount = allPolls.filter((p) => p.userVote !== null).length;
  const openCount = allPolls.filter((p) => p.status === "OPEN").length;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={pollStyles.backBtn}>
          <Feather name="chevron-left" size={20} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Polls</Text>
      </View>

      {/* Stats row */}
      <View style={pollStyles.statsRow}>
        <View style={pollStyles.statBox}>
          <Text style={pollStyles.statNum}>{allPolls.length}</Text>
          <Text style={pollStyles.statLabel}>Total</Text>
        </View>
        <View style={pollStyles.statDivider} />
        <View style={pollStyles.statBox}>
          <Text style={pollStyles.statNum}>{openCount}</Text>
          <Text style={pollStyles.statLabel}>Live</Text>
        </View>
        <View style={pollStyles.statDivider} />
        <View style={pollStyles.statBox}>
          <Text style={[pollStyles.statNum, { color: colors.accent }]}>{votedCount}</Text>
          <Text style={pollStyles.statLabel}>Voted</Text>
        </View>
      </View>

      {/* Filter chips */}
      <View style={pollStyles.filterRow}>
        {POLL_FILTERS.map((f) => (
          <Pressable
            key={f.key}
            style={[pollStyles.filterChip, filter === f.key && pollStyles.filterChipActive]}
            onPress={() => onFilterChange(f.key)}
          >
            <Text style={[pollStyles.filterChipText, filter === f.key && pollStyles.filterChipTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={polls}
        keyExtractor={(p) => p.id}
        contentContainerStyle={pollStyles.listContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={colors.accent} />}
        ListEmptyComponent={
          loading ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : error ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Something went wrong</Text>
              <Text style={styles.emptyText}>{error}</Text>
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No polls here</Text>
              <Text style={styles.emptyText}>
                {filter === "voted"
                  ? "You haven't voted in any polls yet. Check the Feed!"
                  : filter === "not_voted"
                    ? "You've voted in all open polls. Nice!"
                    : "Polls are generated from news stories. Check back soon."}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => <PollCard poll={item} onVoted={onRefresh} />}
      />
    </View>
  );
}

function buildNumericPlaceholder(poll: ApiPollListItem): string {
  const unit = poll.unit ? ` ${poll.unit}` : "";
  // Prefer actual average from existing votes
  if (poll.averageNumericValue != null) {
    const rounded = Math.round(poll.averageNumericValue * 10) / 10;
    return `e.g. ~${rounded}${unit}`;
  }
  // Fall back to midpoint of suggested range
  if (poll.minValue != null && poll.maxValue != null) {
    const mid = Math.round((poll.minValue + poll.maxValue) / 2);
    return `e.g. ~${mid}${unit}`;
  }
  // Just hint the unit if we have it
  if (poll.unit) {
    return `Your guess in ${poll.unit}`;
  }
  return "Your guess…";
}

function PollCard({ poll, onVoted }: { poll: ApiPollListItem; onVoted?: () => void }) {
  const { colors } = useTheme();
  const pollStyles = useThemedStyles(makePollStyles);
  const [expanded, setExpanded] = useState(false);
  const isNumeric = poll.marketType === "NUMERIC";

  // Binary vote state
  const [localVote, setLocalVote] = useState<string | null>(poll.userVote?.side ?? null);
  const [localYes, setLocalYes] = useState(poll.yesCount);
  const [localNo, setLocalNo] = useState(poll.noCount);
  const [voting, setVoting] = useState(false);

  // Numeric vote state
  const [numericGuess, setNumericGuess] = useState("");
  const [localNumericVote, setLocalNumericVote] = useState<number | null>(
    poll.userVote?.numericValue ?? null
  );
  const [numericVoting, setNumericVoting] = useState(false);
  const [numericError, setNumericError] = useState<string | null>(null);

  const total = localYes + localNo;
  const yesPct = total > 0 ? localYes / total : 0.5;
  const noPct = 1 - yesPct;
  const isOpen = poll.status === "OPEN";
  const voted = isNumeric ? localNumericVote !== null : localVote !== null;

  const handleBinaryVote = async (side: "YES" | "NO") => {
    if (voting || voted) return;
    setVoting(true);
    setLocalVote(side);
    if (side === "YES") setLocalYes((n) => n + 1);
    else setLocalNo((n) => n + 1);
    try {
      await mobileApi.castVote(poll.id, { side });
      onVoted?.();
    } catch {
      setLocalVote(null);
      setLocalYes(poll.yesCount);
      setLocalNo(poll.noCount);
    } finally {
      setVoting(false);
    }
  };

  const handleNumericVote = async () => {
    const val = parseFloat(numericGuess);
    if (!numericGuess || isNaN(val)) {
      setNumericError("Enter a valid number.");
      return;
    }
    setNumericVoting(true);
    setNumericError(null);
    try {
      await mobileApi.castVote(poll.id, { numericValue: val });
      setLocalNumericVote(val);
      onVoted?.();
    } catch {
      setNumericError("Failed to submit. Try again.");
    } finally {
      setNumericVoting(false);
    }
  };

  const hasStory = Boolean(poll.storySummary || poll.storyHeadline);

  return (
    <View style={pollStyles.card}>
      {/* Top row: category + status */}
      <View style={pollStyles.cardTopRow}>
        <View style={pollStyles.categoryPill}>
          <Text style={pollStyles.categoryPillText}>{poll.category}</Text>
        </View>
        <View style={[pollStyles.statusPill, isOpen ? pollStyles.statusPillOpen : pollStyles.statusPillClosed]}>
          {isOpen && <View style={pollStyles.liveDot} />}
          <Text style={[pollStyles.statusText, isOpen ? pollStyles.statusTextOpen : pollStyles.statusTextClosed]}>
            {isOpen ? "LIVE" : "CLOSED"}
          </Text>
        </View>
      </View>

      {/* Story headline */}
      {poll.storyHeadline ? (
        <Text style={pollStyles.storyLine} numberOfLines={expanded ? undefined : 1}>
          {poll.storyHeadline}
        </Text>
      ) : null}

      {/* Expanded story content */}
      {expanded && poll.storySummary ? (
        <Text style={pollStyles.storySummary}>{poll.storySummary}</Text>
      ) : null}

      {/* Read more / collapse toggle */}
      {hasStory ? (
        <Pressable style={pollStyles.readMoreRow} onPress={() => setExpanded((v) => !v)}>
          <Text style={pollStyles.readMoreText}>{expanded ? "Show less" : "Read more"}</Text>
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={13} color={colors.accent} />
        </Pressable>
      ) : null}

      {/* Divider */}
      <View style={pollStyles.divider} />

      {/* Poll question */}
      <Text style={pollStyles.question}>{poll.title}</Text>

      {/* Vote bar (binary only) */}
      {!isNumeric ? (
        total > 0 ? (
          <>
            <View style={pollStyles.barTrack}>
              <View style={[pollStyles.barYes, { flex: Math.max(0.04, yesPct) }]} />
              <View style={[pollStyles.barNo, { flex: Math.max(0.04, noPct) }]} />
            </View>
            <View style={pollStyles.barLabels}>
              <Text style={pollStyles.barLabelYes}>YES {Math.round(yesPct * 100)}%</Text>
              <Text style={pollStyles.barNo2}>{total.toLocaleString()} votes</Text>
              <Text style={pollStyles.barLabelNo}>NO {Math.round(noPct * 100)}%</Text>
            </View>
          </>
        ) : (
          <Text style={pollStyles.noVotes}>No votes yet — be the first!</Text>
        )
      ) : poll.totalVotes > 0 ? (
        <Text style={pollStyles.noVotes}>{poll.totalVotes.toLocaleString()} {poll.totalVotes === 1 ? "guess" : "guesses"} so far</Text>
      ) : (
        <Text style={pollStyles.noVotes}>No guesses yet — be the first!</Text>
      )}

      {/* Footer */}
      {voted ? (
        <View>
          <View style={pollStyles.votedRow}>
            <Feather name="check-circle" size={13} color={colors.accent} />
            <Text style={pollStyles.votedText}>
              {isNumeric
                ? `Your guess: ${localNumericVote}${poll.unit ? ` ${poll.unit}` : ""}`
                : `You voted ${localVote}${
                    localVote === (yesPct >= 0.5 ? "YES" : "NO")
                      ? " · With the crowd"
                      : " · Contrarian"
                  }`}
            </Text>
          </View>
          {/* Share your vote */}
          {!isNumeric && localVote != null ? (
            <Pressable
              style={pollStyles.shareVoteBtn}
              onPress={() =>
                void Share.share({
                  message: `I voted ${localVote} on "${poll.title}" — what do you think? https://predictfuture.app/polls/${poll.id}`,
                  url: `https://predictfuture.app/polls/${poll.id}`,
                })
              }
            >
              <Feather name="share-2" size={12} color={colors.accent} />
              <Text style={pollStyles.shareVoteBtnText}>Share your vote</Text>
            </Pressable>
          ) : null}
        </View>
      ) : isOpen && !isNumeric ? (
        <View style={pollStyles.voteButtons}>
          <Pressable
            style={[pollStyles.voteBtn, pollStyles.voteBtnYes, voting && { opacity: 0.5 }]}
            onPress={() => handleBinaryVote("YES")}
            disabled={voting}
          >
            <Text style={pollStyles.voteBtnText}>YES</Text>
          </Pressable>
          <Pressable
            style={[pollStyles.voteBtn, pollStyles.voteBtnNo, voting && { opacity: 0.5 }]}
            onPress={() => handleBinaryVote("NO")}
            disabled={voting}
          >
            <Text style={pollStyles.voteBtnText}>NO</Text>
          </Pressable>
        </View>
      ) : isOpen && isNumeric ? (
        <View>
          <View style={pollStyles.numericInputRow}>
            <TextInput
              style={pollStyles.numericInput}
              placeholder={buildNumericPlaceholder(poll)}
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              returnKeyType="done"
              value={numericGuess}
              onChangeText={(t) => { setNumericGuess(t); setNumericError(null); }}
              editable={!numericVoting}
              onSubmitEditing={handleNumericVote}
            />
            {poll.unit ? (
              <Text style={pollStyles.numericUnit}>{poll.unit}</Text>
            ) : null}
            <Pressable
              style={[pollStyles.submitGuessBtn, numericVoting && { opacity: 0.5 }]}
              onPress={handleNumericVote}
              disabled={numericVoting}
            >
              {numericVoting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={pollStyles.submitGuessBtnText}>Submit</Text>
              )}
            </Pressable>
          </View>
          {numericError ? <Text style={pollStyles.numericError}>{numericError}</Text> : null}
        </View>
      ) : (
        <Text style={pollStyles.notVotedText}>Poll closed</Text>
      )}
    </View>
  );
}

const makePollStyles = (t: ThemeContextValue) => StyleSheet.create({
  backBtn: { marginRight: spacing.sm, padding: 4 },
  statsRow: {
    flexDirection: "row",
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    backgroundColor: t.colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  statBox: { flex: 1, alignItems: "center" },
  statDivider: { width: 1, backgroundColor: t.colors.border },
  statNum: { fontSize: 22, fontWeight: "800", color: t.colors.text },
  statLabel: { fontSize: 11, color: t.colors.textMuted, marginTop: 2, fontWeight: "600" },
  filterRow: {
    flexDirection: "row",
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: "#F1F5F9",
  },
  filterChipActive: { backgroundColor: t.colors.text },
  filterChipText: { fontSize: 13, fontWeight: "600", color: t.colors.textMuted },
  filterChipTextActive: { color: "#fff" },
  listContent: { paddingHorizontal: spacing.xl, paddingBottom: 100, gap: spacing.md },
  footerSpinner: { paddingVertical: spacing.xl, alignItems: "center" },
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: t.colors.border,
    gap: spacing.sm,
  },
  cardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  categoryPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: "#EEF2FF",
  },
  categoryPillText: { fontSize: 10, fontWeight: "700", color: t.colors.accent, letterSpacing: 0.3 },
  statusPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.pill,
  },
  statusPillOpen: { backgroundColor: "rgba(239,68,68,0.08)" },
  statusPillClosed: { backgroundColor: "#F1F5F9" },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#ef4444" },
  statusText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  statusTextOpen: { color: "#ef4444" },
  statusTextClosed: { color: t.colors.textMuted },
  storyLine: { fontSize: 13, fontWeight: "600", color: t.colors.text, lineHeight: 19 },
  storySummary: {
    fontSize: 13,
    color: t.colors.textMuted,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  readMoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: spacing.xs,
  },
  readMoreText: { fontSize: 12, fontWeight: "700", color: t.colors.accent },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: t.colors.border, marginVertical: spacing.xs },
  question: { fontSize: 15, fontWeight: "700", color: t.colors.text, lineHeight: 22 },
  barTrack: { flexDirection: "row", height: 8, borderRadius: radius.pill, overflow: "hidden", gap: 2 },
  barYes: { backgroundColor: "#059669", borderRadius: radius.pill },
  barNo: { backgroundColor: "#F87171", borderRadius: radius.pill },
  barLabels: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  barLabelYes: { fontSize: 11, fontWeight: "700", color: "#059669" },
  barLabelNo: { fontSize: 11, fontWeight: "700", color: "#F87171" },
  barNo2: { fontSize: 11, color: t.colors.textMuted },
  noVotes: { fontSize: 12, color: t.colors.textMuted },
  votedRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: spacing.xs },
  votedText: { fontSize: 12, fontWeight: "600", color: t.colors.accent },
  shareVoteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing.xs,
    alignSelf: "flex-start",
  },
  shareVoteBtnText: { fontSize: 11, fontWeight: "600", color: t.colors.accent },
  notVotedText: { fontSize: 12, color: t.colors.textMuted, marginTop: spacing.xs },
  voteButtons: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  voteBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    alignItems: "center",
    backgroundColor: `${t.colors.accent}15`,
  },
  voteBtnYes: { backgroundColor: "#059669" },
  voteBtnNo: { backgroundColor: "#E5392B" },
  voteBtnText: { fontSize: 14, fontWeight: "800", color: "#fff", letterSpacing: 0.5 },
  numericInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  numericInput: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: t.colors.text,
    backgroundColor: t.colors.background,
  },
  numericUnit: {
    fontSize: 13,
    fontWeight: "700",
    color: t.colors.textMuted,
  },
  submitGuessBtn: {
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: t.colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  submitGuessBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },
  numericError: { fontSize: 12, color: "#DC2626", marginTop: 4 },
});

// ── styles ──────────────────────────────────────────────────────────

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: t.colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xs,
  },
  // Used by the Polls sub-screen header title
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: t.colors.text,
    letterSpacing: -0.5,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.colors.background,
  },

  // ── Level 1: mode toggle ─────────────────────────────────────────

  modeRow: {
    flexDirection: "row",
    marginHorizontal: spacing.xl,
    marginTop: spacing.sm,
    backgroundColor: "#F1F5F9",
    borderRadius: radius.md,
    padding: 3,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.sm,
    alignItems: "center",
  },
  modeBtnActive: {
    backgroundColor: t.colors.surface,
    ...t.shadows.card,
  },
  modeBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: t.colors.textMuted,
  },
  modeBtnTextActive: {
    color: t.colors.text,
    fontWeight: "700",
  },

  // ── Search bar (white-on-gradient pill, lives inside GradientHeader right slot) ──

  searchRow: {
    flex: 1,
    maxWidth: 220,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    gap: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: "#FFFFFF",
    paddingVertical: 0,
  },

  // ── Group dropdown ─────────────────────────────────────────────────

  dropdownWrapper: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    zIndex: 10,
  },
  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: t.colors.surface,
  },
  dropdownTriggerText: {
    fontSize: 15,
    fontWeight: "600",
    color: t.colors.text,
    flex: 1,
  },
  dropdownArrow: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginLeft: spacing.sm,
  },
  dropdownMenu: {
    marginTop: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: t.colors.surface,
    ...t.shadows.card,
    overflow: "hidden",
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#F1F5F9",
  },
  dropdownItemActive: {
    backgroundColor: "#EEF2FF",
  },
  dropdownItemMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
  },
  dropdownItemViewBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  dropdownItemText: {
    fontSize: 14,
    fontWeight: "500",
    color: t.colors.text,
    flex: 1,
  },
  dropdownItemTextActive: {
    fontWeight: "700",
    color: t.colors.primary,
  },
  dropdownItemCount: {
    fontSize: 12,
    fontWeight: "700",
    color: t.colors.textMuted,
    marginLeft: spacing.sm,
  },
  noGroupsBanner: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: "#FEF9C3",
  },
  noGroupsText: {
    fontSize: 14,
    color: "#854D0E",
    lineHeight: 20,
  },

  // ── Sort control row ───────────────────────────────────────────────

  sortScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  // View-selector pills — kept visually identical to CategoryFilterBar's pills
  // (category-filter-bar.tsx) so the two stacked filter rows read as one system.
  sortRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
    gap: 8,
    alignItems: "center",
  },
  sortChip: {
    flexShrink: 0,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  sortChipActive: {
    backgroundColor: t.colors.accent,
    borderColor: t.colors.accent,
    shadowColor: t.colors.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  sortChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: t.colors.textMuted,
  },
  sortChipTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },

  // ── Community surfaces (S55-T7: live in My Groups sub-tab) ──────

  spotlightWrapper: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },

  discoverSection: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },

  discoverSectionHeader: {
    fontSize: 13,
    fontWeight: "700",
    color: t.colors.textMuted,
    textTransform: "uppercase" as const,
    letterSpacing: 0.6,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },

  // ── Bottom-of-feed CTA into community discovery (S55-T7) ────────

  discoverCommunitiesCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },

  discoverCommunitiesCtaText: {
    fontSize: 13,
    fontWeight: "600",
    color: t.colors.accent,
  },

  // ── List ──────────────────────────────────────────────────────────

  listContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing["2xl"],
    gap: spacing.lg,
    flexGrow: 1,
  },
  emptyCard: {
    marginTop: spacing.lg,
    padding: spacing.xl,
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: t.colors.text,
  },
  emptyText: {
    marginTop: spacing.sm,
    fontSize: 14,
    lineHeight: 22,
    color: t.colors.textMuted,
  },
  retry: {
    marginTop: spacing.lg,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: t.colors.accent,
  },
  retryLabel: {
    color: t.colors.surface,
    fontWeight: "700",
    fontSize: 14,
  },
  footerSpinner: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
});
