import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ApiGroupSummary, ApiMarketSummary, AppMarketCategory } from "@predict-future/types";
import { colors, radius, shadows, spacing } from "@predict-future/ui-tokens";

import { MarketSummaryCard } from "@/components/market-summary-card";
import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";
import { env } from "@/lib/env";

// ── constants ───────────────────────────────────────────────────────

type MarketMode = "public" | "private";
type StatusTab = "live" | "ended" | "settled";

const STATUS_TABS: { key: StatusTab; label: string }[] = [
  { key: "live", label: "Live" },
  { key: "ended", label: "Cancelled" },
  { key: "settled", label: "Settled" },
];

const CATEGORIES: { key: AppMarketCategory | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "SPORTS", label: "Sports" },
  { key: "TECH", label: "Tech" },
  { key: "BUSINESS", label: "Business" },
  { key: "ENTERTAINMENT", label: "Entertainment" },
  { key: "WEATHER", label: "Weather" },
  { key: "PRODUCT", label: "Product" },
  { key: "COMPANY", label: "Company" },
  { key: "GENERAL", label: "General" },
];

const LIVE_STATUSES = new Set(["OPEN", "DRAFT"]);
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
  const [mode, setMode] = useState<MarketMode>("public");
  const [statusTab, setStatusTab] = useState<StatusTab>("live");
  const [category, setCategory] = useState<AppMarketCategory | "ALL">("ALL");
  const [selectedGroupId, setSelectedGroupId] = useState<string>("ALL");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Reset category when switching status tabs (categories only shown for "live")
  useEffect(() => {
    setCategory("ALL");
  }, [statusTab]);

  // ── public markets ────────────────────────────────────────────────

  const publicFetcher = useCallback(() => mobileApi.getPublicMarkets({ sort: "new" }), []);
  const publicQuery = useApiQuery<{ markets: ApiMarketSummary[] }>(publicFetcher, [], {
    enabled: mode === "public",
    errorFallback: "Unable to load markets.",
  });

  // ── private: user's groups ────────────────────────────────────────

  const groupsFetcher = useCallback(
    () => mobileApi.getMyGroups({ userId: env.demoUserId }),
    []
  );
  const groupsQuery = useApiQuery<{
    groups: Array<ApiGroupSummary & { memberCount?: number; marketCount?: number }>;
  }>(groupsFetcher, [], {
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
          const detail = await mobileApi.getGroupById(g.id, { userId: env.demoUserId });
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
      ? publicQuery.loading
      : groupMarketsLoading || groupsQuery.loading;
  const error =
    mode === "public"
      ? publicQuery.error
      : groupsQuery.error;
  const queryStatus = mode === "public" ? publicQuery.status : groupsQuery.status;

  // Status counts for badges
  const statusCounts = useMemo(() => {
    const live = allMarkets.filter((m) => matchesStatusTab(m.status, "live")).length;
    const ended = allMarkets.filter((m) => matchesStatusTab(m.status, "ended")).length;
    const settled = allMarkets.filter((m) => matchesStatusTab(m.status, "settled")).length;
    return { live, ended, settled };
  }, [allMarkets]);

  // Filter: status → category
  const filteredMarkets = useMemo(() => {
    let result = allMarkets.filter((m) => matchesStatusTab(m.status, statusTab));
    if (mode === "public" && statusTab === "live" && category !== "ALL") {
      result = result.filter((m) => m.category === category);
    }
    return result;
  }, [allMarkets, statusTab, category]);

  const handleRefresh = useCallback(() => {
    if (mode === "public") {
      publicQuery.refetch();
    } else {
      groupsQuery.refetch();
      fetchAllGroupMarkets();
    }
  }, [mode, publicQuery, groupsQuery, fetchAllGroupMarkets]);

  // ── render ────────────────────────────────────────────────────────

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

      {/* ── Level 1: Public / Private toggle ── */}
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
      </View>

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
                  <Pressable
                    key={group.id}
                    style={[styles.dropdownItem, selectedGroupId === group.id && styles.dropdownItemActive]}
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

      {/* ── Level 2: Status tabs (Live / Ended / Settled) ── */}
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

      {/* ── Market list ── */}
      <FlatList
        data={filteredMarkets}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={handleRefresh} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          mode === "public" && statusTab === "live" ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryRow}
            >
              {CATEGORIES.map((cat) => (
                <Pressable
                  key={cat.key}
                  style={[styles.categoryPill, category === cat.key && styles.categoryPillActive]}
                  onPress={() => setCategory(cat.key)}
                >
                  <Text
                    style={[
                      styles.categoryPillText,
                      category === cat.key && styles.categoryPillTextActive,
                    ]}
                  >
                    {cat.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null
        }
        renderItem={({ item }) => <MarketSummaryCard item={item} />}
        ListEmptyComponent={
          error ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Something went wrong</Text>
              <Text style={styles.emptyText}>{error}</Text>
              <Pressable onPress={handleRefresh} style={styles.retry}>
                <Text style={styles.retryLabel}>Retry</Text>
              </Pressable>
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
                  : statusTab === "live" && category !== "ALL"
                    ? `No live ${category.toLowerCase()} markets right now.`
                    : "Check back later."}
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

// ── styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
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
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#F1F5F9",
  },
  dropdownItemActive: {
    backgroundColor: "#EEF2FF",
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

  // ── Level 3: category pills ───────────────────────────────────────

  categoryRow: {
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  categoryPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: "#F1F5F9",
  },
  categoryPillActive: {
    backgroundColor: colors.accent,
  },
  categoryPillText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  categoryPillTextActive: {
    color: "#fff",
    fontWeight: "700",
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
});
