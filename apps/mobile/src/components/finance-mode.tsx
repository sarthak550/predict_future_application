import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type {
  ApiCrowdVsExperts,
  ApiFinanceExpertSentiment,
  ApiFinanceMarketsResponse,
  ApiMarketSummary,
  ApiNewsFeedItem,
  ApiVerifiedCall,
} from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { ExpertOpinionCard } from "@/components/expert-opinion-card";
import { mobileApi } from "@/lib/api";
import { getExpertInitials, getExpertInitialsColor } from "@/utils/expertAvatar";

const FOLLOWED_ANALYSTS_KEY = "finance:followedAnalysts";

type DirectionFilter = "BULLISH" | "BEARISH" | "NEUTRAL" | "VERIFIED" | null;

function formatDateRange(startsAt: string, endsAt: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return `${fmt(startsAt)} – ${fmt(endsAt)}`;
}

function formatSentimentDelta(current: number, previous: number | null): string | null {
  if (previous === null) return null;
  const delta = current - previous;
  if (delta === 0) return "— same as yesterday";
  const sign = delta > 0 ? "▲" : "▼";
  return `${sign} ${Math.abs(delta)}pts vs yesterday`;
}

function SentimentCard({
  data,
  onPress,
}: {
  data: NonNullable<ApiFinanceMarketsResponse["sentimentToday"]>;
  onPress?: () => void;
}) {
  const router = useRouter();
  const leanColor =
    data.leanLabel === "Bullish" ? "#16a34a" : data.leanLabel === "Bearish" ? "#dc2626" : "#6b7280";

  const deltaLabel = formatSentimentDelta(data.yesPercent, data.previousDayScore);
  const isNew = data.previousDayScore === null;
  const deltaPositive = deltaLabel?.startsWith("▲");
  const deltaColor = deltaPositive ? "#16a34a" : deltaLabel?.startsWith("▼") ? "#dc2626" : "#6b7280";

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else {
      router.push(`/market/${data.marketId}` as Parameters<typeof router.push>[0]);
    }
  };

  return (
    <Pressable style={financeStyles.sentimentCard} onPress={handlePress}>
      <Text style={financeStyles.sentimentTitle}>Today&apos;s Sentiment</Text>
      <Text style={financeStyles.sentimentMarketTitle} numberOfLines={2}>
        {data.marketTitle}
      </Text>
      <View style={financeStyles.sentimentGaugeRow}>
        <View style={financeStyles.gaugeTrack}>
          <View
            style={[
              financeStyles.gaugeFill,
              { width: `${data.yesPercent}%`, backgroundColor: leanColor },
            ]}
          />
        </View>
        <Text style={[financeStyles.gaugeLabel, { color: leanColor }]}>
          {data.yesPercent}%
        </Text>
      </View>
      <View style={financeStyles.sentimentFooterRow}>
        <View style={[financeStyles.leanChip, { backgroundColor: leanColor + "20", borderColor: leanColor + "60" }]}>
          <Text style={[financeStyles.leanChipText, { color: leanColor }]}>
            {data.leanLabel} · {data.totalVotes.toLocaleString()} votes
          </Text>
        </View>
        {isNew ? (
          <View style={financeStyles.newBadge}>
            <Text style={financeStyles.newBadgeText}>new</Text>
          </View>
        ) : deltaLabel ? (
          <Text style={[financeStyles.deltaText, { color: deltaColor }]}>{deltaLabel}</Text>
        ) : null}
      </View>
      <Text style={financeStyles.sentimentSeeOpinions}>See opinions →</Text>
    </Pressable>
  );
}

function AnalystSentimentCard({
  sentiment,
  onPress,
}: {
  sentiment: ApiFinanceExpertSentiment;
  onPress?: () => void;
}) {
  if (sentiment.totalCount === 0) {
    return (
      <View style={financeStyles.analystSentimentCard}>
        <Text style={financeStyles.analystSentimentTitle}>Today's Analyst Sentiment</Text>
        <Text style={financeStyles.analystSentimentEmpty}>No analyst opinions in the past 7 days</Text>
      </View>
    );
  }

  const dominantColor =
    sentiment.dominantLean === "BULLISH"
      ? "#06D6A0"
      : sentiment.dominantLean === "BEARISH"
        ? "#E84855"
        : sentiment.dominantLean === "MIXED"
          ? "#F59E0B"
          : "#6B7280";

  return (
    <Pressable style={financeStyles.analystSentimentCard} onPress={onPress}>
      <Text style={financeStyles.analystSentimentTitle}>Today's Analyst Sentiment</Text>

      {/* Count chips row */}
      <View style={financeStyles.analystCountRow}>
        <View style={financeStyles.analystCountChip}>
          <Text style={financeStyles.analystCountNum}>{sentiment.bullishCount}</Text>
          <Text style={[financeStyles.analystCountLabel, { color: "#06D6A0" }]}>Bullish</Text>
        </View>
        <View style={financeStyles.analystCountDivider} />
        <View style={financeStyles.analystCountChip}>
          <Text style={financeStyles.analystCountNum}>{sentiment.bearishCount}</Text>
          <Text style={[financeStyles.analystCountLabel, { color: "#E84855" }]}>Bearish</Text>
        </View>
        <View style={financeStyles.analystCountDivider} />
        <View style={financeStyles.analystCountChip}>
          <Text style={financeStyles.analystCountNum}>{sentiment.neutralCount}</Text>
          <Text style={[financeStyles.analystCountLabel, { color: "#6B7280" }]}>Neutral</Text>
        </View>
      </View>

      {/* Gauge bar */}
      <View style={financeStyles.analystGaugeTrack}>
        {sentiment.bullishPercent > 0 && (
          <View
            style={[
              financeStyles.analystGaugeSegment,
              { flex: sentiment.bullishPercent, backgroundColor: "#06D6A0" },
            ]}
          />
        )}
        {sentiment.bearishPercent > 0 && (
          <View
            style={[
              financeStyles.analystGaugeSegment,
              { flex: sentiment.bearishPercent, backgroundColor: "#E84855" },
            ]}
          />
        )}
        {sentiment.neutralPercent > 0 && (
          <View
            style={[
              financeStyles.analystGaugeSegment,
              { flex: sentiment.neutralPercent, backgroundColor: "#D1D5DB" },
            ]}
          />
        )}
      </View>

      {/* Dominant lean chip */}
      <View style={financeStyles.analystFooterRow}>
        <View
          style={[
            financeStyles.analystLeanChip,
            { backgroundColor: dominantColor + "20", borderColor: dominantColor + "60" },
          ]}
        >
          <Text style={[financeStyles.analystLeanChipText, { color: dominantColor }]}>
            {sentiment.dominantLean}
          </Text>
        </View>
        <Text style={financeStyles.analystSubtext}>
          Based on {sentiment.totalCount} expert {sentiment.totalCount === 1 ? "opinion" : "opinions"} in the last 7 days
        </Text>
      </View>

      <Text style={financeStyles.analystSeeOpinions}>See opinions →</Text>
    </Pressable>
  );
}

function MarketChip({ market }: { market: ApiMarketSummary }) {
  const router = useRouter();
  const isOpen = market.status === "OPEN";
  const closeStr = market.closeAt
    ? `Closes ${new Date(market.closeAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
    : null;
  return (
    <Pressable
      style={[financeStyles.marketChip, !isOpen && financeStyles.marketChipClosed]}
      onPress={() => router.push(`/market/${market.id}` as Parameters<typeof router.push>[0])}
    >
      <Text style={financeStyles.marketChipTitle} numberOfLines={2}>
        {market.title.length > 50 ? market.title.slice(0, 47) + "..." : market.title}
      </Text>
      <View style={financeStyles.marketChipMeta}>
        <View
          style={[
            financeStyles.statusBadge,
            { backgroundColor: isOpen ? "#dcfce7" : "#f3f4f6" },
          ]}
        >
          <Text style={[financeStyles.statusBadgeText, { color: isOpen ? "#16a34a" : "#6b7280" }]}>
            {isOpen ? "Open" : "Closed"}
          </Text>
        </View>
        {closeStr && <Text style={financeStyles.closeStr}>{closeStr}</Text>}
      </View>
    </Pressable>
  );
}

/** My Analysts avatar-chip row — shown when user follows 1+ analysts */
function MyAnalystsRow({
  followedIds,
  expertNames,
  selectedAnalystFilter,
  onSelectAnalyst,
  onClearFilter,
}: {
  followedIds: string[];
  expertNames: Record<string, { name: string; org: string }>;
  selectedAnalystFilter: string | null;
  onSelectAnalyst: (id: string) => void;
  onClearFilter: () => void;
}) {
  if (followedIds.length === 0) return null;

  return (
    <View style={financeStyles.myAnalystsSection}>
      <Text style={financeStyles.myAnalystsLabel}>My Analysts</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={financeStyles.myAnalystsScroll}
      >
        {/* All chip */}
        <Pressable
          style={[
            financeStyles.analystChip,
            selectedAnalystFilter === null && financeStyles.analystChipActive,
          ]}
          onPress={onClearFilter}
        >
          <Text
            style={[
              financeStyles.analystChipText,
              selectedAnalystFilter === null && financeStyles.analystChipTextActive,
            ]}
          >
            All
          </Text>
        </Pressable>

        {followedIds.map((id) => {
          const info = expertNames[id];
          const displayName = info
            ? (info.name || info.org).slice(0, 8)
            : id.slice(0, 8);
          const initials = info
            ? getExpertInitials(info.name, info.org)
            : "?";
          const initialsColor = info
            ? getExpertInitialsColor(info.name || info.org)
            : "#6b7280";
          const isSelected = selectedAnalystFilter === id;

          return (
            <Pressable
              key={id}
              style={[financeStyles.analystChip, isSelected && financeStyles.analystChipActive]}
              onPress={() => onSelectAnalyst(id)}
            >
              <View style={[financeStyles.analystChipAvatar, { backgroundColor: initialsColor }]}>
                <Text style={financeStyles.analystChipAvatarText}>{initials}</Text>
              </View>
              <Text
                style={[
                  financeStyles.analystChipText,
                  isSelected && financeStyles.analystChipTextActive,
                ]}
                numberOfLines={1}
              >
                {displayName}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Crowd vs. Experts comparison card */
function CrowdVsExpertsCard({ data }: { data: ApiCrowdVsExperts }) {
  if (data.resolvedCount < 10) return null;

  const crowdWinRate = data.crowdWinRate ?? 0;
  const expertWinRate = data.expertWinRate ?? 0;
  const crowdWins = crowdWinRate >= expertWinRate;
  const winnerText = crowdWins
    ? "Crowd is beating analysts on Indian markets"
    : "Analysts are leading the crowd this month";

  const crowdFlex = Math.max(1, crowdWinRate);
  const expertFlex = Math.max(1, expertWinRate);

  return (
    <View style={financeStyles.crowdVsExpertsCard}>
      <Text style={financeStyles.crowdVsExpertsHeader}>CROWD VS. EXPERTS</Text>

      <View style={financeStyles.crowdVsExpertsStatsRow}>
        <View style={financeStyles.crowdVsExpertsStat}>
          <Text style={[financeStyles.crowdVsExpertsWinRate, { color: "#4338CA" }]}>
            {crowdWinRate}%
          </Text>
          <Text style={financeStyles.crowdVsExpertsStatLabel}>Crowd</Text>
        </View>

        <View style={financeStyles.crowdVsExpertsDivider} />

        <View style={financeStyles.crowdVsExpertsStat}>
          <Text style={[financeStyles.crowdVsExpertsWinRate, { color: "#0891b2" }]}>
            {expertWinRate}%
          </Text>
          <Text style={financeStyles.crowdVsExpertsStatLabel}>Experts</Text>
        </View>
      </View>

      {/* Segmented bar */}
      <View style={financeStyles.crowdVsExpertsBarTrack}>
        <View style={[financeStyles.crowdVsExpertsBarSegment, { flex: crowdFlex, backgroundColor: "#4338CA" }]} />
        <View style={[financeStyles.crowdVsExpertsBarSegment, { flex: expertFlex, backgroundColor: "#0891b2" }]} />
      </View>

      <Text style={financeStyles.crowdVsExpertsWinner}>{winnerText}</Text>

      <View style={financeStyles.crowdVsExpertsFooter}>
        <Text style={financeStyles.crowdVsExpertsFooterText}>
          Based on {data.resolvedCount} resolved calls
        </Text>
        {data.provisional && (
          <View style={financeStyles.provisionalBadge}>
            <Text style={financeStyles.provisionalBadgeText}>provisional</Text>
          </View>
        )}
      </View>
    </View>
  );
}

export function FinanceMode({ onNavigateToFeed }: { onNavigateToFeed?: () => void }) {
  const [data, setData] = useState<ApiFinanceMarketsResponse | null>(null);
  const [analystSentiment, setAnalystSentiment] = useState<ApiFinanceExpertSentiment | null>(null);
  const [crowdVsExperts, setCrowdVsExperts] = useState<ApiCrowdVsExperts | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Expert leaderboard count for conditional "Top Experts" link
  const [leaderboardCount, setLeaderboardCount] = useState(0);

  // Latest finance news with attached expert opinions and dual polls
  const [financeNews, setFinanceNews] = useState<ApiNewsFeedItem[]>([]);

  // S28-T2: Pagination state
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // ScrollView ref and expert section Y offset for scroll-to navigation (S18-T2 / T4)
  const scrollViewRef = useRef<ScrollView>(null);
  const expertSectionY = useRef<number>(0);

  // Cluster filter state: when set, only opinions with matching eventClusterId are shown (S18-T4)
  const [selectedClusterFilter, setSelectedClusterFilter] = useState<string | null>(null);

  // Toggle between named-analyst expert opinions and trusted-source market analysis
  const [opinionTab, setOpinionTab] = useState<"expert" | "analysis">("expert");

  // S28-T3: Direction filter state
  const [selectedDirectionFilter, setSelectedDirectionFilter] = useState<DirectionFilter>(null);

  // S28-T1: Follow system state
  const [followedExpertIds, setFollowedExpertIds] = useState<string[]>([]);
  const [expertNamesMap, setExpertNamesMap] = useState<Record<string, { name: string; org: string }>>({});
  const [selectedAnalystFilter, setSelectedAnalystFilter] = useState<string | null>(null);

  // Verified calls — fetched independently so they're always visible
  const [verifiedCalls, setVerifiedCalls] = useState<ApiVerifiedCall[]>([]);

  const router = useRouter();

  const load = async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError(null);
    try {
      const [marketsResult, newsResult, sentimentResult, crowdResult, verifiedResult] = await Promise.all([
        mobileApi.getFinanceMarkets(),
        mobileApi.getNews({ category: "FINANCE", limit: 10, requireExpertOpinions: true }),
        mobileApi.getFinanceExpertSentiment().catch(() => null),
        mobileApi.getCrowdVsExperts().catch(() => null),
        mobileApi.getVerifiedCalls().catch(() => []),
      ]);
      setData(marketsResult);
      setFinanceNews(newsResult.items ?? []);
      setNextCursor(newsResult.nextCursor ?? null);
      setHasMore(newsResult.hasMore ?? false);
      setAnalystSentiment(sentimentResult);
      setCrowdVsExperts(crowdResult);
      setVerifiedCalls(verifiedResult ?? []);

      // Reset filters on refresh
      if (isRefresh) {
        setSelectedClusterFilter(null);
        setSelectedDirectionFilter(null);
      }
    } catch {
      setError("Couldn't load finance content. Check your connection and tap Retry.");
    } finally {
      setLoading(false);
      if (isRefresh) setRefreshing(false);
    }
  };

  // S28-T2: Load more items (append to list)
  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || nextCursor === null) return;
    setLoadingMore(true);
    try {
      const result = await mobileApi.getNews({
        category: "FINANCE",
        limit: 10,
        requireExpertOpinions: true,
        cursor: nextCursor,
      });
      setFinanceNews((prev) => [...prev, ...(result.items ?? [])]);
      setNextCursor(result.nextCursor ?? null);
      setHasMore(result.hasMore ?? false);
    } catch {
      // Silently fail — user can scroll again to retry
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, nextCursor]);

  // S28-T2: Scroll handler — trigger loadMore when within 200px of bottom
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
      if (distanceFromBottom < 200) {
        void loadMore();
      }
    },
    [loadMore]
  );

  // Check leaderboard for conditional link
  const checkLeaderboard = async () => {
    try {
      const lb = await mobileApi.getExpertLeaderboard();
      setLeaderboardCount(Array.isArray(lb) ? lb.length : 0);
    } catch {
      setLeaderboardCount(0);
    }
  };

  // S28-T1: Load followed expert IDs (from cache first, then API)
  const loadFollowedExperts = useCallback(async () => {
    // Instant render from AsyncStorage cache
    try {
      const cached = await AsyncStorage.getItem(FOLLOWED_ANALYSTS_KEY);
      if (cached) {
        const ids: string[] = JSON.parse(cached) as string[];
        setFollowedExpertIds(ids);
      }
    } catch {
      // ignore cache errors
    }

    // Then fetch from API
    try {
      const ids = await mobileApi.getFollowedExperts();
      setFollowedExpertIds(ids);
      await AsyncStorage.setItem(FOLLOWED_ANALYSTS_KEY, JSON.stringify(ids));
    } catch {
      // silently fail — cache is good enough
    }
  }, []);

  useEffect(() => {
    void load();
    void checkLeaderboard();
    void loadFollowedExperts();
  }, []);

  // S28-T1: Build expert name map from loaded financeNews
  useEffect(() => {
    const map: Record<string, { name: string; org: string }> = {};
    for (const item of financeNews) {
      for (const op of (item.expertOpinions ?? [])) {
        if (!map[op.expertId]) {
          map[op.expertId] = { name: op.expertName, org: op.expertOrganization };
        }
      }
    }
    setExpertNamesMap((prev) => ({ ...prev, ...map }));
  }, [financeNews]);

  // S28-T1: Handle follow/unfollow from ExpertOpinionRow — update local state + cache
  const handleFollowToggle = useCallback(async (expertId: string, currentlyFollowing: boolean) => {
    try {
      if (currentlyFollowing) {
        await mobileApi.unfollowExpert(expertId);
        setFollowedExpertIds((prev) => {
          const next = prev.filter((id) => id !== expertId);
          void AsyncStorage.setItem(FOLLOWED_ANALYSTS_KEY, JSON.stringify(next));
          return next;
        });
      } else {
        await mobileApi.followExpert(expertId);
        setFollowedExpertIds((prev) => {
          const next = [...prev, expertId];
          void AsyncStorage.setItem(FOLLOWED_ANALYSTS_KEY, JSON.stringify(next));
          return next;
        });
      }
    } catch {
      // Optimistic update already happened in ExpertOpinionRow — re-sync on next load
    }
  }, []);

  // S28-T3: Handler for sentiment card tap — pre-filter to dominant direction
  const handleSentimentCardPress = useCallback(() => {
    if (!analystSentiment || analystSentiment.totalCount === 0) return;

    const dominant = analystSentiment.dominantLean;
    if (dominant === "BULLISH" || dominant === "BEARISH" || dominant === "NEUTRAL") {
      setSelectedDirectionFilter(dominant);
    } else {
      setSelectedDirectionFilter(null);
    }
    scrollViewRef.current?.scrollTo({ y: expertSectionY.current, animated: true });
  }, [analystSentiment]);

  if (loading) {
    return (
      <View style={financeStyles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={financeStyles.center}>
        <Text style={financeStyles.errorText}>{error}</Text>
        <Pressable
          style={({ pressed }) => [financeStyles.retryBtn, pressed && { opacity: 0.7 }]}
          onPress={() => void load()}
        >
          <Text style={financeStyles.retryBtnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollViewRef}
      style={financeStyles.scroll}
      contentContainerStyle={financeStyles.scrollContent}
      onScroll={handleScroll}
      scrollEventThrottle={200}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load(true);
          }}
          tintColor={colors.accent}
        />
      }
    >
      {/* Read Finance News link */}
      <Pressable
        style={financeStyles.crossTabLink}
        onPress={onNavigateToFeed}
      >
        <Text style={financeStyles.crossTabLinkText}>Read Finance News →</Text>
      </Pressable>

      {/* Section 1: Analyst Sentiment (opinion-sourced) */}
      {analystSentiment !== null ? (
        <AnalystSentimentCard
          sentiment={analystSentiment}
          onPress={handleSentimentCardPress}
        />
      ) : (
        <View style={financeStyles.emptyState}>
          <Text style={financeStyles.emptyText}>Loading analyst sentiment...</Text>
        </View>
      )}

      {/* Section 1b: Crowd vs Experts card (only when >= 10 resolved calls) */}
      {crowdVsExperts && crowdVsExperts.resolvedCount >= 10 && (
        <CrowdVsExpertsCard data={crowdVsExperts} />
      )}

      {/* Section 2: Event Cluster data panels */}
      {data && data.eventClusters.length > 0 ? (
        data.eventClusters.map((cluster) => (
          <View key={cluster.id} style={financeStyles.clusterSection}>
            {/* Cluster header */}
            <View style={financeStyles.clusterHeader}>
              {cluster.bannerEmoji ? (
                <Text style={financeStyles.clusterEmoji}>{cluster.bannerEmoji}</Text>
              ) : null}
              <View style={financeStyles.clusterHeaderText}>
                <Text style={financeStyles.clusterName}>{cluster.name}</Text>
                <Text style={financeStyles.clusterDateRange}>
                  {formatDateRange(cluster.startsAt, cluster.endsAt)}
                </Text>
              </View>
            </View>

            {/* Data panel rows */}
            {cluster.dataPoints && cluster.dataPoints.length > 0 ? (
              <View style={financeStyles.dataPanel}>
                {cluster.dataPoints.map((dp, i) => (
                  <View
                    key={i}
                    style={[
                      financeStyles.dataPanelRow,
                      i < cluster.dataPoints.length - 1 && financeStyles.dataPanelRowBorder,
                    ]}
                  >
                    <Text style={financeStyles.dataPanelLabel}>{dp.label}</Text>
                    <View style={financeStyles.dataPanelValueCol}>
                      <Text style={financeStyles.dataPanelValue}>{dp.value}</Text>
                      {dp.date ? (
                        <Text style={financeStyles.dataPanelDate}>{dp.date}</Text>
                      ) : null}
                      {dp.subtext ? (
                        <Text style={financeStyles.dataPanelSubtext}>{dp.subtext}</Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Expert takes footer link */}
            <View style={financeStyles.clusterFooter}>
              {cluster.expertTakeCount > 0 ? (
                <Pressable
                  onPress={() => {
                    setSelectedClusterFilter(cluster.id);
                    scrollViewRef.current?.scrollTo({ y: expertSectionY.current, animated: true });
                  }}
                >
                  <Text style={financeStyles.expertTakesLink}>
                    {`→ ${cluster.expertTakeCount} expert ${cluster.expertTakeCount === 1 ? "take" : "takes"} on this event`}
                  </Text>
                </Pressable>
              ) : (
                <Text style={financeStyles.expertTakesMuted}>0 expert takes yet</Text>
              )}
            </View>
          </View>
        ))
      ) : (
        <View style={financeStyles.emptyState}>
          <Text style={financeStyles.emptyText}>
            No events this week. Markets will appear here when events are scheduled.
          </Text>
        </View>
      )}

      {/* Top Experts link — only shown when 3+ experts have resolved calls */}
      {leaderboardCount >= 3 && (
        <Pressable
          style={financeStyles.crossTabLink}
          onPress={() => router.push("/expert-leaderboard" as Parameters<typeof router.push>[0])}
        >
          <Text style={financeStyles.crossTabLinkText}>Top Experts →</Text>
        </Pressable>
      )}

      {/* Section 3: Expert Opinions + Market Analysis */}
      <View
        style={financeStyles.unclusteredSection}
        onLayout={(e) => { expertSectionY.current = e.nativeEvent.layout.y; }}
      >
        {/* S28-T1: My Analysts avatar-chip row */}
        <MyAnalystsRow
          followedIds={followedExpertIds}
          expertNames={expertNamesMap}
          selectedAnalystFilter={selectedAnalystFilter}
          onSelectAnalyst={(id) => setSelectedAnalystFilter(id)}
          onClearFilter={() => setSelectedAnalystFilter(null)}
        />

        {/* Active cluster filter banner */}
        {selectedClusterFilter !== null ? (() => {
          const activeCluster = data?.eventClusters.find((c) => c.id === selectedClusterFilter);
          return (
            <View style={financeStyles.filterBanner}>
              <Text style={financeStyles.filterBannerText} numberOfLines={1}>
                {`Showing: ${activeCluster?.name ?? "Cluster"} opinions`}
              </Text>
              <Pressable onPress={() => setSelectedClusterFilter(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={financeStyles.filterClearBtn}>Clear filter ×</Text>
              </Pressable>
            </View>
          );
        })() : null}

        {(() => {
          // Group opinions by (storyId, expertId) so same analyst's takes on one article share a card
          interface GroupedCard {
            key: string;
            storyId: string;
            storyHeadline: string;
            articlePublishedAt: string;
            opinions: NonNullable<ApiNewsFeedItem["expertOpinions"]>;
          }
          const grouped: GroupedCard[] = [];
          const seen = new Map<string, number>();
          for (const item of financeNews) {
            for (const op of (item.expertOpinions ?? [])) {
              const key = `${item.id}::${op.expertId}`;
              const idx = seen.get(key);
              if (idx !== undefined) {
                grouped[idx].opinions.push(op);
              } else {
                seen.set(key, grouped.length);
                grouped.push({ key, storyId: item.id, storyHeadline: item.headline, articlePublishedAt: item.publishedAt, opinions: [op] });
              }
            }
          }

          // Apply cluster filter: show group if any opinion matches the selected cluster
          let filteredGroups = selectedClusterFilter
            ? grouped.filter((g) => g.opinions.some((op) => op.eventClusterId === selectedClusterFilter))
            : grouped;

          // S28-T1: Apply analyst filter
          if (selectedAnalystFilter !== null) {
            filteredGroups = filteredGroups.filter((g) =>
              g.opinions.some((op) => op.expertId === selectedAnalystFilter)
            );
          }

          // S28-T3: Apply direction/verified filter at the individual opinion level
          // VERIFIED uses the dedicated verifiedCalls fetch — handled below at render time
          if (selectedDirectionFilter !== null && selectedDirectionFilter !== "VERIFIED") {
            filteredGroups = filteredGroups
              .map((g) => ({
                ...g,
                opinions: g.opinions.filter((op) => op.direction === selectedDirectionFilter),
              }))
              .filter((g) => g.opinions.length > 0);
          }

          // Split into named-analyst opinions vs trusted-source market analysis.
          // Route to Market Analysis if: isSourceAttribution=true OR no individual expertName
          // (catches Goldman Sachs/JPMorgan institutional notes where AI omits a personal name).
          const isAnalysis = (g: GroupedCard) =>
            g.opinions[0].isSourceAttribution || !g.opinions[0].expertName?.trim();
          const expertGroups = filteredGroups.filter((g) => !isAnalysis(g));
          const analysisGroups = filteredGroups.filter((g) => isAnalysis(g));

          if (grouped.length === 0) {
            return (
              <View style={financeStyles.expertEmptyCard}>
                <Text style={financeStyles.expertEmptyIcon}>📊</Text>
                <Text style={financeStyles.expertEmptyTitle}>No expert takes yet</Text>
                <Text style={financeStyles.expertEmptySubtitle}>
                  Trusted analyst opinions are extracted daily from leading finance sources. Check back soon.
                </Text>
                <Pressable
                  onPress={() => router.push("/(tabs)/markets" as Parameters<typeof router.push>[0])}
                  style={financeStyles.expertEmptyLink}
                >
                  <Text style={financeStyles.expertEmptyLinkText}>View all finance markets ↓</Text>
                </Pressable>
              </View>
            );
          }

          const allGroups = selectedClusterFilter
            ? grouped.filter((g) => g.opinions.some((op) => op.eventClusterId === selectedClusterFilter))
            : grouped;

          if (allGroups.length === 0 && selectedClusterFilter !== null) {
            return (
              <View style={financeStyles.expertEmptyCard}>
                <Text style={financeStyles.expertEmptyTitle}>No opinions tagged to this cluster yet</Text>
                <Pressable onPress={() => setSelectedClusterFilter(null)} style={financeStyles.expertEmptyLink}>
                  <Text style={financeStyles.expertEmptyLinkText}>Show all opinions</Text>
                </Pressable>
              </View>
            );
          }

          const activeGroups = opinionTab === "expert" ? expertGroups : analysisGroups;

          // S28-T3: Count unfiltered groups for toggle badge
          const allExpertGroups = (selectedClusterFilter
            ? grouped.filter((g) => g.opinions.some((op) => op.eventClusterId === selectedClusterFilter))
            : grouped
          ).filter((g) => !isAnalysis(g));
          const allAnalysisGroups = (selectedClusterFilter
            ? grouped.filter((g) => g.opinions.some((op) => op.eventClusterId === selectedClusterFilter))
            : grouped
          ).filter((g) => isAnalysis(g));

          return (
            <>
              {/* S28-T3: Direction filter chips */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={financeStyles.directionChipsScroll}
              >
                {(
                  [
                    { label: "All", value: null, activeColor: colors.accent },
                    { label: "Bullish", value: "BULLISH", activeColor: "#16a34a" },
                    { label: "Bearish", value: "BEARISH", activeColor: "#dc2626" },
                    { label: "Neutral", value: "NEUTRAL", activeColor: "#6b7280" },
                    { label: "Verified ✓", value: "VERIFIED", activeColor: "#2563eb" },
                  ] as const
                ).map(({ label, value, activeColor }) => {
                  const isActive = selectedDirectionFilter === value;
                  return (
                    <Pressable
                      key={label}
                      style={[
                        financeStyles.directionChip,
                        isActive && { backgroundColor: activeColor, borderColor: activeColor },
                      ]}
                      onPress={() => setSelectedDirectionFilter(value)}
                    >
                      <Text
                        style={[
                          financeStyles.directionChipText,
                          isActive && financeStyles.directionChipTextActive,
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {/* S28-T3: Direction filter active banner */}
              {selectedDirectionFilter !== null && (
                <View style={financeStyles.filterBanner}>
                  <Text style={financeStyles.filterBannerText} numberOfLines={1}>
                    {selectedDirectionFilter === "VERIFIED"
                      ? "Showing: Verified calls (resolved HIT or MISS)"
                      : `Showing: ${selectedDirectionFilter!.charAt(0) + selectedDirectionFilter!.slice(1).toLowerCase()} opinions`}
                  </Text>
                  <Pressable
                    onPress={() => setSelectedDirectionFilter(null)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={financeStyles.filterClearBtn}>Clear filter ×</Text>
                  </Pressable>
                </View>
              )}

              {/* Toggle pill — always visible */}
              <View style={financeStyles.opinionToggle}>
                <Pressable
                  style={[financeStyles.toggleBtn, opinionTab === "expert" && financeStyles.toggleBtnActive]}
                  onPress={() => setOpinionTab("expert")}
                >
                  <Text style={[financeStyles.toggleBtnText, opinionTab === "expert" && financeStyles.toggleBtnTextActive]}>
                    Expert Opinions</Text>
                </Pressable>
                <Pressable
                  style={[financeStyles.toggleBtn, opinionTab === "analysis" && financeStyles.toggleBtnActive]}
                  onPress={() => setOpinionTab("analysis")}
                >
                  <Text style={[financeStyles.toggleBtnText, opinionTab === "analysis" && financeStyles.toggleBtnTextActive]}>
                    Market Analysis
                  </Text>
                </Pressable>
              </View>

              {/* Subheader for analysis tab */}
              {opinionTab === "analysis" && selectedDirectionFilter !== "VERIFIED" && (
                <Text style={financeStyles.sectionSubheader}>From trusted India-finance publications</Text>
              )}

              {/* Cards */}
              {selectedDirectionFilter === "VERIFIED" && opinionTab === "expert" ? (
                verifiedCalls.length === 0 ? (
                  <View style={financeStyles.expertEmptyCard}>
                    <Text style={financeStyles.expertEmptyTitle}>No verified calls yet</Text>
                    <Text style={financeStyles.expertEmptySubtitle}>
                      Calls are verified once their resolution window elapses. Check back soon.
                    </Text>
                  </View>
                ) : (
                  verifiedCalls.map((call) => {
                    const isHit = call.resolutionStatus === "RESOLVED_HIT";
                    const color = isHit ? "#16a34a" : "#dc2626";
                    const dirLabel = call.direction === "BULLISH" ? "↑ Bullish" : call.direction === "BEARISH" ? "↓ Bearish" : "→ Neutral";
                    const fmt = (iso: string | null) =>
                      iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null;
                    const articleDate = fmt(call.publishedAt);
                    const resolvedDate = fmt(call.resolvedAt);
                    return (
                      <Pressable
                        key={call.id}
                        style={financeStyles.verifiedCard}
                        onPress={() => router.push(`/expert/${call.expertId}` as Parameters<typeof router.push>[0])}
                      >
                        <View style={[financeStyles.verifiedBadge, { backgroundColor: color }]}>
                          <Text style={financeStyles.verifiedBadgeText}>{isHit ? "HIT ✓" : "MISS ✗"}</Text>
                        </View>
                        <View style={financeStyles.verifiedCardBody}>
                          <Text style={financeStyles.verifiedExpert} numberOfLines={1}>
                            {call.expertName} · {call.expertOrganization}
                          </Text>
                          {call.instrument ? (
                            <Text style={[financeStyles.verifiedInstrument, { color }]}>{dirLabel} on {call.instrument}</Text>
                          ) : null}
                          <Text style={financeStyles.verifiedQuote} numberOfLines={2}>{call.quote}</Text>
                          {call.resolutionNote ? (
                            <Text style={[financeStyles.verifiedNote, { color }]} numberOfLines={1}>{call.resolutionNote}</Text>
                          ) : null}
                          <Text style={financeStyles.verifiedDates}>
                            {articleDate ? `Called ${articleDate}` : ""}
                            {articleDate && resolvedDate ? "  ·  " : ""}
                            {resolvedDate ? `Resolved ${resolvedDate}` : ""}
                          </Text>
                          {call.storyHeadline ? (
                            <Text style={financeStyles.verifiedStory} numberOfLines={1}>{call.storyHeadline}</Text>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })
                )
              ) : (
                activeGroups.length === 0 ? (
                  <View style={financeStyles.expertEmptyCard}>
                    <Text style={financeStyles.expertEmptyTitle}>
                      {opinionTab === "expert" ? "No expert opinions yet" : "No market analysis yet"}
                    </Text>
                  </View>
                ) : (
                  activeGroups.map(({ key, storyId, storyHeadline, articlePublishedAt, opinions }) => (
                    <ExpertOpinionCard
                      key={key}
                      opinions={opinions}
                      storyHeadline={storyHeadline}
                      storyId={storyId}
                      articlePublishedAt={articlePublishedAt}
                      followedExpertIds={followedExpertIds}
                      onFollowToggle={handleFollowToggle}
                    />
                  ))
                )
              )}
            </>
          );
        })()}

        {/* S28-T2: Loading more footer */}
        {loadingMore && (
          <View style={financeStyles.loadMoreFooter}>
            <ActivityIndicator size="small" color={colors.accent} />
          </View>
        )}

        {/* S28-T2: End of list footer */}
        {!hasMore && financeNews.length > 0 && !loadingMore && (
          <View style={financeStyles.noMoreFooter}>
            <Text style={financeStyles.noMoreText}>No more opinions</Text>
          </View>
        )}
      </View>

    </ScrollView>
  );
}

const financeStyles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorText: { color: "#dc2626", textAlign: "center", padding: spacing.lg },
  retryBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  retryBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  verifiedCard: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  verifiedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    alignSelf: "flex-start",
    minWidth: 52,
    alignItems: "center",
  },
  verifiedBadgeText: { fontSize: 10, fontWeight: "800", color: "#fff" },
  verifiedCardBody: { flex: 1, gap: 2 },
  verifiedExpert: { fontSize: 12, fontWeight: "700", color: colors.text },
  verifiedInstrument: { fontSize: 11, fontWeight: "600" },
  verifiedQuote: { fontSize: 12, color: colors.textMuted, lineHeight: 16 },
  verifiedNote: { fontSize: 11, fontWeight: "600", fontStyle: "italic" as const },
  verifiedDates: { fontSize: 10, color: colors.textMuted, marginTop: 3 },
  verifiedStory: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  expertLinksRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingVertical: 6,
  },
  crossTabLink: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingVertical: 6,
    alignSelf: "flex-end",
  },
  crossTabLinkText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.accent,
  },
  sentimentCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#C7D2FE",
  },
  sentimentTitle: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: "#4338CA",
    marginBottom: 4,
  },
  sentimentMarketTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1e1b4b",
    marginBottom: spacing.sm,
  },
  sentimentGaugeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  gaugeTrack: {
    flex: 1,
    height: 10,
    backgroundColor: "#E5E7EB",
    borderRadius: 5,
    overflow: "hidden",
  },
  gaugeFill: { height: 10, borderRadius: 5 },
  gaugeLabel: { fontSize: 18, fontWeight: "800", width: 45, textAlign: "right" },
  sentimentFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  sentimentSeeOpinions: {
    fontSize: 11,
    fontWeight: "700",
    color: "#4338CA",
    textAlign: "right",
    marginTop: spacing.sm,
  },
  leanChip: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  leanChipText: { fontSize: 11, fontWeight: "700" },
  newBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: "#DBEAFE",
    borderWidth: 1,
    borderColor: "#93C5FD",
  },
  newBadgeText: { fontSize: 10, fontWeight: "700", color: "#1D4ED8" },
  deltaText: { fontSize: 11, fontWeight: "600" },
  analystSentimentCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#BBF7D0",
  },
  analystSentimentTitle: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: "#166534",
    marginBottom: spacing.sm,
  },
  analystSentimentEmpty: {
    fontSize: 13,
    color: "#6b7280",
    fontStyle: "italic",
  },
  analystSeeOpinions: {
    fontSize: 11,
    fontWeight: "700",
    color: "#166534",
    textAlign: "right",
    marginTop: spacing.sm,
  },
  analystCountRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  analystCountChip: {
    flex: 1,
    alignItems: "center",
  },
  analystCountDivider: {
    width: 1,
    height: 28,
    backgroundColor: "#D1FAE5",
  },
  analystCountNum: {
    fontSize: 20,
    fontWeight: "800",
    color: "#111827",
  },
  analystCountLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
    marginTop: 1,
  },
  analystGaugeTrack: {
    flexDirection: "row",
    height: 10,
    borderRadius: 5,
    overflow: "hidden",
    marginBottom: spacing.sm,
    gap: 2,
  },
  analystGaugeSegment: {
    borderRadius: 5,
  },
  analystFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  analystLeanChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  analystLeanChipText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  analystSubtext: {
    fontSize: 11,
    color: "#6b7280",
    flex: 1,
    flexWrap: "wrap",
  },
  // Crowd vs Experts card
  crowdVsExpertsCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: "#F5F3FF",
    borderWidth: 1,
    borderColor: "#DDD6FE",
  },
  crowdVsExpertsHeader: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: "#4338CA",
    marginBottom: spacing.sm,
  },
  crowdVsExpertsStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  crowdVsExpertsStat: {
    flex: 1,
    alignItems: "center",
  },
  crowdVsExpertsWinRate: {
    fontSize: 28,
    fontWeight: "800",
  },
  crowdVsExpertsStatLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6b7280",
    marginTop: 2,
  },
  crowdVsExpertsDivider: {
    width: 1,
    height: 40,
    backgroundColor: "#DDD6FE",
  },
  crowdVsExpertsBarTrack: {
    flexDirection: "row",
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: spacing.sm,
    gap: 2,
  },
  crowdVsExpertsBarSegment: {
    borderRadius: 4,
  },
  crowdVsExpertsWinner: {
    fontSize: 12,
    fontWeight: "600",
    color: "#374151",
    marginBottom: spacing.xs ?? 4,
  },
  crowdVsExpertsFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  crowdVsExpertsFooterText: {
    fontSize: 11,
    color: "#6b7280",
  },
  provisionalBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  provisionalBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#92400E",
  },
  // My Analysts row
  myAnalystsSection: {
    marginBottom: spacing.md,
  },
  myAnalystsLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted ?? "#6b7280",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs ?? 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  myAnalystsScroll: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  analystChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    gap: 6,
  },
  analystChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  analystChipAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  analystChipAvatarText: {
    fontSize: 8,
    fontWeight: "800",
    color: "#fff",
  },
  analystChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#374151",
  },
  analystChipTextActive: {
    color: "#fff",
  },
  // Direction filter chips
  directionChipsScroll: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  directionChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  directionChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  directionChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6b7280",
  },
  directionChipTextActive: {
    color: "#fff",
    fontWeight: "700",
  },
  // Pagination footers
  loadMoreFooter: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  noMoreFooter: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  noMoreText: {
    fontSize: 12,
    color: colors.textMuted ?? "#6b7280",
    fontStyle: "italic",
  },
  emptyState: {
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  emptyText: { fontSize: 13, color: colors.textMuted ?? "#6b7280", fontStyle: "italic" },
  expertEmptyCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    alignItems: "center",
  },
  expertEmptyIcon: { fontSize: 36, marginBottom: spacing.sm },
  expertEmptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text ?? "#111827",
    marginBottom: 6,
  },
  expertEmptySubtitle: {
    fontSize: 13,
    color: colors.textMuted ?? "#6b7280",
    textAlign: "center",
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  expertEmptyLink: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#C7D2FE",
  },
  expertEmptyLinkText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#4338CA",
  },
  clusterSection: {
    marginBottom: spacing.lg,
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  clusterHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: "#F9FAFB",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  clusterEmoji: { fontSize: 20 },
  clusterHeaderText: { flex: 1 },
  clusterName: { fontSize: 14, fontWeight: "800", color: colors.text ?? "#111827" },
  clusterDateRange: { fontSize: 11, color: colors.textMuted ?? "#6b7280", marginTop: 1 },
  clusterScroll: { paddingLeft: spacing.lg },
  dataPanel: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs ?? 4,
  },
  dataPanelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: spacing.sm,
  },
  dataPanelRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E7EB",
  },
  dataPanelLabel: {
    fontSize: 12,
    color: colors.textMuted ?? "#6b7280",
    flex: 1,
    marginRight: spacing.sm,
  },
  dataPanelValueCol: {
    alignItems: "flex-end",
    flex: 1.2,
  },
  dataPanelValue: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.text ?? "#111827",
    textAlign: "right",
  },
  dataPanelDate: {
    fontSize: 10,
    color: colors.textMuted ?? "#6b7280",
    marginTop: 2,
  },
  dataPanelSubtext: {
    fontSize: 10,
    color: colors.textMuted ?? "#6b7280",
    fontStyle: "italic",
    marginTop: 2,
  },
  clusterFooter: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E5E7EB",
    marginTop: spacing.xs ?? 4,
  },
  expertTakesLink: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.accent,
  },
  expertTakesMuted: {
    fontSize: 12,
    color: colors.textMuted ?? "#6b7280",
  },
  marketChip: {
    width: 180,
    padding: spacing.md,
    marginRight: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#fff",
  },
  marketChipClosed: {
    opacity: 0.6,
  },
  marketChipTitle: { fontSize: 13, fontWeight: "600", color: colors.text ?? "#111827", marginBottom: 6 },
  marketChipMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  statusBadgeText: { fontSize: 9, fontWeight: "700" },
  closeStr: { fontSize: 10, color: colors.textMuted ?? "#6b7280" },
  sectionHeader: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.text ?? "#111827",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionSubheader: {
    fontSize: 11,
    color: colors.textMuted ?? "#6b7280",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    marginTop: -2,
  },
  opinionToggle: {
    flexDirection: "row",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: 10,
    backgroundColor: "#F3F4F6",
    padding: 3,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: "center",
    borderRadius: 8,
  },
  toggleBtnActive: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  toggleBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted ?? "#6b7280",
  },
  toggleBtnTextActive: {
    color: colors.text ?? "#111827",
    fontWeight: "700",
  },
  unclusteredSection: { marginTop: spacing.sm },
  filterBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#C7D2FE",
  },
  filterBannerText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#4338CA",
    flex: 1,
  },
  filterClearBtn: {
    fontSize: 12,
    fontWeight: "700",
    color: "#4338CA",
    marginLeft: spacing.sm,
  },
});
