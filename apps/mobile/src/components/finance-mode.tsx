import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type {
  ApiFinanceExpertSentiment,
  ApiFinanceMarketsResponse,
  ApiMarketSummary,
  ApiNewsFeedItem,
} from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { ExpertOpinionCard } from "@/components/expert-opinion-card";
import { mobileApi } from "@/lib/api";

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

function SentimentCard({ data }: { data: NonNullable<ApiFinanceMarketsResponse["sentimentToday"]> }) {
  const router = useRouter();
  const leanColor =
    data.leanLabel === "Bullish" ? "#16a34a" : data.leanLabel === "Bearish" ? "#dc2626" : "#6b7280";

  const deltaLabel = formatSentimentDelta(data.yesPercent, data.previousDayScore);
  const isNew = data.previousDayScore === null;
  const deltaPositive = deltaLabel?.startsWith("▲");
  const deltaColor = deltaPositive ? "#16a34a" : deltaLabel?.startsWith("▼") ? "#dc2626" : "#6b7280";

  return (
    <Pressable
      style={financeStyles.sentimentCard}
      onPress={() => router.push(`/market/${data.marketId}` as Parameters<typeof router.push>[0])}
    >
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
    </Pressable>
  );
}

function AnalystSentimentCard({ sentiment }: { sentiment: ApiFinanceExpertSentiment }) {
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
    <View style={financeStyles.analystSentimentCard}>
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
    </View>
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

export function FinanceMode({ onNavigateToFeed }: { onNavigateToFeed?: () => void }) {
  const [data, setData] = useState<ApiFinanceMarketsResponse | null>(null);
  const [analystSentiment, setAnalystSentiment] = useState<ApiFinanceExpertSentiment | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Expert leaderboard count for conditional "Top Experts" link
  const [leaderboardCount, setLeaderboardCount] = useState(0);

  // Latest finance news with attached expert opinions and dual polls
  const [financeNews, setFinanceNews] = useState<ApiNewsFeedItem[]>([]);

  // ScrollView ref and expert section Y offset for scroll-to navigation (S18-T2 / T4)
  const scrollViewRef = useRef<ScrollView>(null);
  const expertSectionY = useRef<number>(0);

  // Cluster filter state: when set, only opinions with matching eventClusterId are shown (S18-T4)
  const [selectedClusterFilter, setSelectedClusterFilter] = useState<string | null>(null);

  const router = useRouter();

  const load = async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError(null);
    try {
      const [marketsResult, newsResult, sentimentResult] = await Promise.all([
        mobileApi.getFinanceMarkets(),
        mobileApi.getNews({ category: "FINANCE", limit: 10, requireExpertOpinions: true }),
        mobileApi.getFinanceExpertSentiment().catch(() => null),
      ]);
      setData(marketsResult);
      setFinanceNews(newsResult.items ?? []);
      setAnalystSentiment(sentimentResult);
    } catch {
      setError("Couldn't load finance content. Check your connection and tap Retry.");
    } finally {
      setLoading(false);
      if (isRefresh) setRefreshing(false);
    }
  };

  // Check leaderboard for conditional link
  const checkLeaderboard = async () => {
    try {
      const lb = await mobileApi.getExpertLeaderboard();
      setLeaderboardCount(Array.isArray(lb) ? lb.length : 0);
    } catch {
      setLeaderboardCount(0);
    }
  };

  useEffect(() => {
    void load();
    void checkLeaderboard();
  }, []);

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
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            setSelectedClusterFilter(null);
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
        <AnalystSentimentCard sentiment={analystSentiment} />
      ) : (
        <View style={financeStyles.emptyState}>
          <Text style={financeStyles.emptyText}>Loading analyst sentiment...</Text>
        </View>
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

      {/* Section 3: Expert Opinions (the heart of the Finance tab —
          extracted from trusted India-finance sources) */}
      <View
        style={financeStyles.unclusteredSection}
        onLayout={(e) => { expertSectionY.current = e.nativeEvent.layout.y; }}
      >
        <Text style={financeStyles.sectionHeader}>Expert Opinions</Text>

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
          const flatOpinions = financeNews.flatMap((item) =>
            (item.expertOpinions ?? []).map((op) => ({
              opinion: op,
              storyId: item.id,
              storyHeadline: item.headline,
            }))
          );

          // Apply cluster filter if active
          const displayedOpinions = selectedClusterFilter
            ? flatOpinions.filter((op) => op.opinion.eventClusterId === selectedClusterFilter)
            : flatOpinions;

          if (flatOpinions.length === 0) {
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

          if (displayedOpinions.length === 0 && selectedClusterFilter !== null) {
            return (
              <View style={financeStyles.expertEmptyCard}>
                <Text style={financeStyles.expertEmptyTitle}>No opinions tagged to this cluster yet</Text>
                <Pressable onPress={() => setSelectedClusterFilter(null)} style={financeStyles.expertEmptyLink}>
                  <Text style={financeStyles.expertEmptyLinkText}>Show all opinions</Text>
                </Pressable>
              </View>
            );
          }

          return displayedOpinions.map(({ opinion, storyId, storyHeadline }) => (
            <ExpertOpinionCard
              key={opinion.id}
              opinion={opinion}
              storyHeadline={storyHeadline}
              storyId={storyId}
            />
          ));
        })()}
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
    paddingTop: spacing.xs,
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
    marginTop: spacing.xs,
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
