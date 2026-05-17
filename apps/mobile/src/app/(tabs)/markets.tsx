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

import type { ApiGroupSummary, ApiMarketSummary, ApiPollListItem } from "@predict-future/types";
import { colors, radius, shadows, spacing } from "@predict-future/ui-tokens";

import {
  CategoryFilterBar,
  FILTER_BAR_CATEGORIES,
  type CategoryKey,
} from "@/components/category-filter-bar";
import { MarketSummaryCard } from "@/components/market-summary-card";
import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";

// ── constants ───────────────────────────────────────────────────────

type MarketMode = "public" | "private" | "polls";
type StatusTab = "live" | "ended" | "settled" | "saved";
type MarketSort = "new" | "rank" | "close_at" | "volume";

const STATUS_TABS: { key: StatusTab; label: string }[] = [
  { key: "live", label: "Live" },
  { key: "ended", label: "Cancelled" },
  { key: "settled", label: "Settled" },
  { key: "saved", label: "Saved" },
];

const SORT_OPTIONS: { key: MarketSort; label: string }[] = [
  { key: "new", label: "New" },
  { key: "rank", label: "Trending" },
  { key: "close_at", label: "Closing Soon" },
  { key: "volume", label: "Most Active" },
];

// CATEGORIES is provided by the shared CategoryFilterBar via FILTER_BAR_CATEGORIES.

const LIVE_STATUSES = new Set(["OPEN"]);
const ENDED_STATUSES = new Set(["CLOSED", "CANCELLED", "AWAITING_RESOLUTION"]);
const SETTLED_STATUSES = new Set(["RESOLVED", "RESOLVING"]);

function matchesStatusTab(status: string | undefined, tab: StatusTab) {
  const s = status ?? "OPEN";
  if (tab === "live") return LIVE_STATUSES.has(s);
  if (tab === "ended") return ENDED_STATUSES.has(s);
  return SETTLED_STATUSES.has(s);
}

// ── screen ──────────────────────────────────────────────────────────

export default function MarketsScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<MarketMode>("public");
  const [statusTab, setStatusTab] = useState<StatusTab>("live");
  const [category, setCategory] = useState<CategoryKey>("ALL");
  const [selectedGroupId, setSelectedGroupId] = useState<string>("ALL");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [pollFilter, setPollFilter] = useState<"all" | "voted" | "not_voted">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<MarketSort>("new");
  const [trendingMarkets, setTrendingMarkets] = useState<ApiMarketSummary[]>([]);
  const [loadingTrending, setLoadingTrending] = useState(false);

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

  // ── trending carousel (top 5 by rank, parallel fetch) ────────────────

  useEffect(() => {
    if (mode !== "public") return;
    setLoadingTrending(true);
    mobileApi
      .getPublicMarkets({ sort: "rank", limit: 5, status: "OPEN" })
      .then((res) => setTrendingMarkets(res.markets.slice(0, 5)))
      .catch(() => setTrendingMarkets([]))
      .finally(() => setLoadingTrending(false));
  }, [mode]);

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

  // Status counts for badges
  const statusCounts = useMemo(() => {
    const live = allMarkets.filter((m) => matchesStatusTab(m.status, "live")).length;
    const ended = allMarkets.filter((m) => matchesStatusTab(m.status, "ended")).length;
    const settled = allMarkets.filter((m) => matchesStatusTab(m.status, "settled")).length;
    const saved = savedMarkets.length;
    return { live, ended, settled, saved };
  }, [allMarkets, savedMarkets]);

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
    if (mode === "public" && statusTab === "live" && category !== "ALL") {
      result = result.filter((m) => (m.category as string) === category);
    }
    // Defensive dedupe: even if upstream returns duplicates, FlatList must see unique keys.
    const seen = new Set<string>();
    return result.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }, [allMarkets, savedMarkets, statusTab, category, mode]);

  const handleRefresh = useCallback(() => {
    if (mode === "public") {
      if (statusTab === "saved") {
        void loadSavedMarkets();
      } else {
        publicQuery.refetch();
      }
    } else if (mode === "polls") {
      pollsQuery.refetch();
    } else {
      groupsQuery.refetch();
      fetchAllGroupMarkets();
    }
  }, [mode, statusTab, publicQuery, pollsQuery, groupsQuery, fetchAllGroupMarkets, loadSavedMarkets]);

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
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Markets</Text>
      </View>

      {/* ── Level 1: Public / Private / Polls toggle ── */}
      <View style={styles.modeRow}>
        <Pressable
          style={[styles.modeBtn, mode === "public" && styles.modeBtnActive]}
          onPress={() => { setMode("public"); setStatusTab("live"); }}
        >
          <Text style={[styles.modeBtnText, mode === "public" && styles.modeBtnTextActive]}>
            Explore
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

      {/* ── Search bar (all modes) ── */}
      <View style={styles.searchRow}>
        <Feather name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search markets..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchLoading && mode === "public" ? (
          <ActivityIndicator size="small" color={colors.textMuted} />
        ) : searchQuery.length > 0 ? (
          <Pressable onPress={() => setSearchQuery("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={16} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {/* ── Sort control row (public/Explore mode, hidden in search mode) ── */}
      {mode === "public" && !isSearchMode ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.sortScroll}
          contentContainerStyle={styles.sortRow}
        >
          {SORT_OPTIONS.map((opt) => (
            <Pressable
              key={opt.key}
              style={[styles.sortChip, sort === opt.key && styles.sortChipActive]}
              onPress={() => setSort(opt.key)}
            >
              <Text
                numberOfLines={1}
                style={[styles.sortChipText, sort === opt.key && styles.sortChipTextActive]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
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

      {/* ── Level 2: Status tabs (Live / Ended / Settled) — hidden in search mode ── */}
      {!isSearchMode ? (
        <View style={styles.statusRow}>
          {STATUS_TABS.map((tab) => {
            const count = statusCounts[tab.key];
            const active = statusTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                style={[styles.statusTab, active && styles.statusTabActive]}
                onPress={() => setStatusTab(tab.key)}
              >
                <Text style={[styles.statusTabText, active && styles.statusTabTextActive]}>
                  {tab.label}
                </Text>
                {count > 0 ? (
                  <View style={[styles.statusBadge, active && styles.statusBadgeActive]}>
                    <Text style={[styles.statusBadgeText, active && styles.statusBadgeTextActive]}>
                      {count}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* ── Sticky category filter bar (public Explore mode, live tab, not searching) ── */}
      {mode === "public" && statusTab === "live" && !isSearchMode ? (
        <CategoryFilterBar
          selected={category}
          onSelect={setCategory}
          categories={FILTER_BAR_CATEGORIES}
          elevated
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
          !isSearchMode && mode === "public" && statusTab === "live" ? (
            <>
              {/* Trending carousel — hero cards (S31-T3) */}
              {(trendingMarkets.length > 0 || loadingTrending) ? (
                <View style={styles.trendingShelf}>
                  <View style={styles.trendingHeader}>
                    <Feather name="trending-up" size={15} color={colors.accent} />
                    <Text style={styles.trendingTitle}>Trending Markets</Text>
                  </View>
                  {loadingTrending ? (
                    <ActivityIndicator color={colors.accent} style={{ marginVertical: 8 }} />
                  ) : (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.trendingScroll}
                    >
                      {trendingMarkets.map((m) => {
                        const yesPool = m.yesPool ?? 0;
                        const noPool = m.noPool ?? 0;
                        const total = yesPool + noPool;
                        const yesPct = total > 0 ? yesPool / total : (m.externalProbability ?? 0.5);
                        return (
                          <Pressable
                            key={m.id}
                            style={({ pressed }) => [styles.heroCard, pressed && { opacity: 0.85 }]}
                            onPress={() => router.push(`/market/${m.id}`)}
                          >
                            <View style={styles.heroCardHeader}>
                              {m.category ? (
                                <View style={styles.trendingCatBadge}>
                                  <Text style={styles.trendingCatText}>{m.category}</Text>
                                </View>
                              ) : null}
                              <Text style={styles.heroCardPlayers}>
                                {m.totalParticipants ?? 0} players
                              </Text>
                            </View>
                            <Text style={styles.heroCardTitle} numberOfLines={2}>{m.title}</Text>
                            {m.marketType === "NUMERIC" ? (
                              <Text style={styles.heroCardProb}>
                                {m.averageNumericValue != null
                                  ? `~${Number(m.averageNumericValue).toFixed(1)}${m.unit ? ` ${m.unit}` : ""}`
                                  : "—"}
                              </Text>
                            ) : (
                              <View style={styles.heroCardProbSection}>
                                <View style={styles.heroCardBar}>
                                  <View style={[styles.heroCardBarYes, { flex: Math.max(0.04, yesPct) }]} />
                                  <View style={[styles.heroCardBarNo, { flex: Math.max(0.04, 1 - yesPct) }]} />
                                </View>
                                <View style={styles.heroCardProbRow}>
                                  <Text style={styles.heroCardYesLabel}>YES {Math.round(yesPct * 100)}%</Text>
                                  <Text style={styles.heroCardNoLabel}>NO {Math.round((1 - yesPct) * 100)}%</Text>
                                </View>
                              </View>
                            )}
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
              ) : null}
            </>
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
          ) : null
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

const pollStyles = StyleSheet.create({
  backBtn: { marginRight: spacing.sm, padding: 4 },
  statsRow: {
    flexDirection: "row",
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  statBox: { flex: 1, alignItems: "center" },
  statDivider: { width: 1, backgroundColor: colors.border },
  statNum: { fontSize: 22, fontWeight: "800", color: colors.text },
  statLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontWeight: "600" },
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
  filterChipActive: { backgroundColor: colors.text },
  filterChipText: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
  filterChipTextActive: { color: "#fff" },
  listContent: { paddingHorizontal: spacing.xl, paddingBottom: 100, gap: spacing.md },
  footerSpinner: { paddingVertical: spacing.xl, alignItems: "center" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  cardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  categoryPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: "#EEF2FF",
  },
  categoryPillText: { fontSize: 10, fontWeight: "700", color: "#4F46E5", letterSpacing: 0.3 },
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
  statusTextClosed: { color: colors.textMuted },
  storyLine: { fontSize: 13, fontWeight: "600", color: colors.text, lineHeight: 19 },
  storySummary: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  readMoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: spacing.xs,
  },
  readMoreText: { fontSize: 12, fontWeight: "700", color: colors.accent },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.xs },
  question: { fontSize: 15, fontWeight: "700", color: colors.text, lineHeight: 22 },
  barTrack: { flexDirection: "row", height: 8, borderRadius: radius.pill, overflow: "hidden", gap: 2 },
  barYes: { backgroundColor: "#059669", borderRadius: radius.pill },
  barNo: { backgroundColor: "#F87171", borderRadius: radius.pill },
  barLabels: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  barLabelYes: { fontSize: 11, fontWeight: "700", color: "#059669" },
  barLabelNo: { fontSize: 11, fontWeight: "700", color: "#F87171" },
  barNo2: { fontSize: 11, color: colors.textMuted },
  noVotes: { fontSize: 12, color: colors.textMuted },
  votedRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: spacing.xs },
  votedText: { fontSize: 12, fontWeight: "600", color: colors.accent },
  shareVoteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing.xs,
    alignSelf: "flex-start",
  },
  shareVoteBtnText: { fontSize: 11, fontWeight: "600", color: colors.accent },
  notVotedText: { fontSize: 12, color: colors.textMuted, marginTop: spacing.xs },
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
    backgroundColor: `${colors.accent}15`,
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
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.background,
  },
  numericUnit: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
  },
  submitGuessBtn: {
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  submitGuessBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },
  numericError: { fontSize: 12, color: "#DC2626", marginTop: 4 },
});

// ── styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.text,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
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
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  modeBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
  },
  modeBtnTextActive: {
    color: colors.text,
    fontWeight: "700",
  },

  // ── Search bar ───────────────────────────────────────────────────

  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
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
    backgroundColor: colors.surface,
  },
  dropdownTriggerText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
    flex: 1,
  },
  dropdownArrow: {
    fontSize: 12,
    color: colors.textMuted,
    marginLeft: spacing.sm,
  },
  dropdownMenu: {
    marginTop: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: colors.surface,
    ...shadows.card,
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
    color: colors.text,
    flex: 1,
  },
  dropdownItemTextActive: {
    fontWeight: "700",
    color: colors.primary,
  },
  dropdownItemCount: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
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
  sortRow: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    alignItems: "center",
  },
  sortChip: {
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#CBD5E1",
  },
  sortChipActive: {
    backgroundColor: "#0F172A",
    borderColor: "#0F172A",
  },
  sortChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0F172A",
  },
  sortChipTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },

  // ── Trending carousel (S31-T3) ────────────────────────────────────

  trendingShelf: {
    marginBottom: spacing.md,
  },
  trendingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: spacing.sm,
  },
  trendingTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.text,
  },
  trendingScroll: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  heroCard: {
    width: 220,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.accent + "33",
    gap: spacing.sm,
  },
  heroCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  trendingCatBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: "#EEF2FF",
  },
  trendingCatText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: "#4F46E5",
    textTransform: "uppercase",
  },
  heroCardPlayers: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: "600",
  },
  heroCardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
    lineHeight: 21,
  },
  heroCardProb: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.accent,
  },
  heroCardProbSection: {
    gap: 4,
  },
  heroCardBar: {
    flexDirection: "row",
    height: 7,
    borderRadius: 4,
    overflow: "hidden",
    gap: 1,
  },
  heroCardBarYes: {
    backgroundColor: "#16A34A",
    borderRadius: 4,
  },
  heroCardBarNo: {
    backgroundColor: "#DC2626",
    borderRadius: 4,
  },
  heroCardProbRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  heroCardYesLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#16A34A",
  },
  heroCardNoLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#DC2626",
  },

  // ── Level 2: status tabs ──────────────────────────────────────────

  statusRow: {
    flexDirection: "row",
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  statusTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: "#F1F5F9",
  },
  statusTabActive: {
    backgroundColor: colors.text,
  },
  statusTabText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
  },
  statusTabTextActive: {
    color: "#fff",
  },
  statusBadge: {
    backgroundColor: "#E2E8F0",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
  },
  statusBadgeActive: {
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
  },
  statusBadgeTextActive: {
    color: "#fff",
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
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },
  emptyText: {
    marginTop: spacing.sm,
    fontSize: 14,
    lineHeight: 22,
    color: colors.textMuted,
  },
  retry: {
    marginTop: spacing.lg,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  retryLabel: {
    color: colors.surface,
    fontWeight: "700",
    fontSize: 14,
  },
  footerSpinner: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
});
