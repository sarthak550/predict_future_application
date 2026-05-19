import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
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
  ApiFlagshipEvent,
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

// ─── Flagship Events Carousel (S32-T2) ────────────────────────────────────────

const EVENT_TYPE_COLORS: Record<string, string> = {
  RBI: "#DC2626",
  BUDGET: "#D97706",
  GST: "#7C3AED",
  GLOBAL: "#0284C7",
  FED: "#065F46",
  OTHER: "#4B5563",
};

function getCountdownLabel(flagshipEventAt: string): string {
  const now = Date.now();
  const target = new Date(flagshipEventAt).getTime();
  const diffMs = target - now;
  if (diffMs <= 0) return "Today";
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 1) return "Tomorrow";
  if (diffDays <= 7) return `in ${diffDays} days`;
  const diffWeeks = Math.round(diffDays / 7);
  return `in ${diffWeeks}w`;
}

function FlagshipProbabilityBar({
  market,
  crowdProbability,
}: {
  market: ApiFlagshipEvent;
  crowdProbability: Record<string, number> | null;
}) {
  if (!crowdProbability) {
    return (
      <Text style={flagshipStyles.noDataText}>No predictions yet</Text>
    );
  }

  if (market.marketType === "BINARY") {
    const yesP = crowdProbability["YES"] ?? 0;
    const noP = crowdProbability["NO"] ?? 0;
    return (
      <View>
        <View style={flagshipStyles.barTrack}>
          <View style={[flagshipStyles.barSegment, { flex: yesP, backgroundColor: "#16a34a" }]} />
          <View style={[flagshipStyles.barSegment, { flex: noP, backgroundColor: "#dc2626" }]} />
        </View>
        <View style={flagshipStyles.barLabels}>
          <Text style={[flagshipStyles.barLabel, { color: "#16a34a" }]}>YES {Math.round(yesP * 100)}%</Text>
          <Text style={[flagshipStyles.barLabel, { color: "#dc2626" }]}>NO {Math.round(noP * 100)}%</Text>
        </View>
      </View>
    );
  }

  // MULTIPLE_CHOICE — show top 3-4 segments with option labels
  if (market.marketType === "MULTIPLE_CHOICE" && market.options?.length) {
    const sorted = market.options
      .filter((o) => crowdProbability[o.id] !== undefined)
      .map((o) => ({ label: o.label, pct: crowdProbability[o.id] ?? 0 }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 4);
    const segColors = ["#0284C7", "#7C3AED", "#D97706", "#64748B"];
    return (
      <View>
        <View style={flagshipStyles.barTrack}>
          {sorted.map((seg, i) => (
            <View
              key={i}
              style={[flagshipStyles.barSegment, { flex: seg.pct, backgroundColor: segColors[i % segColors.length] }]}
            />
          ))}
        </View>
        <View style={flagshipStyles.barLabelsWrap}>
          {sorted.map((seg, i) => (
            <Text key={i} style={[flagshipStyles.barLabelSmall, { color: segColors[i % segColors.length] }]}>
              {seg.label.length > 10 ? seg.label.slice(0, 9) + "…" : seg.label} {Math.round(seg.pct * 100)}%
            </Text>
          ))}
        </View>
      </View>
    );
  }

  return null;
}

function ExpertConsensusLine({
  expertProbability,
  expertCount,
  market,
}: {
  expertProbability: Record<string, number> | null;
  expertCount?: number;
  market: ApiFlagshipEvent;
}) {
  if (expertProbability === null) {
    return (
      <Text style={flagshipStyles.expertLineNull}>Experts: not enough data yet</Text>
    );
  }

  const count = expertCount ?? 0;

  if (market.marketType === "BINARY") {
    const yesP = expertProbability["YES"] ?? 0;
    const noP = expertProbability["NO"] ?? 0;
    return (
      <Text style={flagshipStyles.expertLine}>
        {`Experts (${count}): ${Math.round(yesP * 100)}% YES · ${Math.round(noP * 100)}% NO`}
      </Text>
    );
  }

  if (market.marketType === "MULTIPLE_CHOICE" && market.options?.length) {
    const parts = market.options
      .filter((o) => expertProbability[o.id] !== undefined)
      .sort((a, b) => (expertProbability[b.id] ?? 0) - (expertProbability[a.id] ?? 0))
      .slice(0, 3)
      .map((o) => `${Math.round((expertProbability[o.id] ?? 0) * 100)}% ${o.label.split(" ")[0]}`);
    return (
      <Text style={flagshipStyles.expertLine}>
        {`Experts (${count}): ${parts.join(" · ")}`}
      </Text>
    );
  }

  return null;
}

function FlagshipHeroCard({ event }: { event: ApiFlagshipEvent }) {
  const router = useRouter();
  const accentColor = EVENT_TYPE_COLORS[event.flagshipEventType] ?? EVENT_TYPE_COLORS["OTHER"];
  const countdown = getCountdownLabel(event.flagshipEventAt);

  return (
    <Pressable
      style={[flagshipStyles.card, { borderLeftColor: accentColor }]}
      onPress={() => router.push(`/finance/poll/${event.id}` as Parameters<typeof router.push>[0])}
    >
      {/* Top row: type chip + countdown */}
      <View style={flagshipStyles.cardTopRow}>
        <View style={[flagshipStyles.typeChip, { backgroundColor: accentColor + "20", borderColor: accentColor + "60" }]}>
          <Text style={[flagshipStyles.typeChipText, { color: accentColor }]}>{event.flagshipEventType}</Text>
        </View>
        <View style={flagshipStyles.countdownBadge}>
          <Text style={flagshipStyles.countdownText}>{countdown}</Text>
        </View>
      </View>

      {/* Market title */}
      <Text style={flagshipStyles.cardTitle} numberOfLines={2}>{event.title}</Text>

      {/* Probability bar */}
      <View style={flagshipStyles.probSection}>
        <Text style={flagshipStyles.crowdLabel}>Crowd</Text>
        <FlagshipProbabilityBar market={event} crowdProbability={event.crowdProbability} />
      </View>

      {/* Expert consensus */}
      <ExpertConsensusLine
        expertProbability={event.expertProbability}
        expertCount={event.expertCount}
        market={event}
      />

      {/* CTA */}
      <View style={flagshipStyles.cardFooter}>
        <Text style={[flagshipStyles.predictBtn, { color: accentColor }]}>Predict</Text>
      </View>
    </Pressable>
  );
}

function FlagshipEventsCarousel({ events }: { events: ApiFlagshipEvent[] }) {
  const router = useRouter();

  const goCreate = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (router.push as (href: any) => void)({
      pathname: "/(tabs)/create",
      params: { preselectCategory: "FINANCE", flagshipOn: "1" },
    });
  };

  return (
    <View style={flagshipStyles.section}>
      <View style={flagshipStyles.headerRow}>
        <Text style={flagshipStyles.sectionHeader}>{"🔥 Policy & Big Events"}</Text>
        <Pressable onPress={goCreate} style={flagshipStyles.createBtn} hitSlop={8}>
          <Text style={flagshipStyles.createBtnText}>+ Create poll</Text>
        </Pressable>
      </View>
      {events.length === 0 ? (
        <Pressable onPress={goCreate} style={flagshipStyles.emptyCard}>
          <Text style={flagshipStyles.emptyTitle}>No live event polls yet</Text>
          <Text style={flagshipStyles.emptyHint}>
            Start the first poll on an upcoming RBI meeting, Budget, or global event.
          </Text>
        </Pressable>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={flagshipStyles.scroll}
        >
          {events.map((event) => (
            <FlagshipHeroCard key={event.id} event={event} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

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


type PulseKind = "events" | "sentiment" | "calendar";

type PulsePill = {
  kind: PulseKind;
  icon: string;
  label: string;
  value: string;
  enabled: boolean;
};

function PulseRibbon({
  flagshipEvents,
  analystSentiment,
  clustersCount,
  onPress,
}: {
  flagshipEvents: ApiFlagshipEvent[];
  analystSentiment: ApiFinanceExpertSentiment | null;
  clustersCount: number;
  onPress: (kind: PulseKind) => void;
}) {
  // Compose pulse pills based on what data is available.
  const nextEvent = flagshipEvents[0];
  const cdLabel = nextEvent
    ? (() => {
        const ms = new Date(nextEvent.flagshipEventAt ?? Date.now()).getTime() - Date.now();
        const days = Math.floor(ms / (24 * 60 * 60 * 1000));
        if (days >= 2) return `in ${days}d`;
        if (days === 1) return "tomorrow";
        return "today";
      })()
    : "";

  const sentimentLean = analystSentiment
    ? analystSentiment.bullishPercent >= analystSentiment.bearishPercent &&
      analystSentiment.bullishPercent >= analystSentiment.neutralPercent
      ? `${Math.round(analystSentiment.bullishPercent)}% Bullish`
      : analystSentiment.bearishPercent >= analystSentiment.neutralPercent
        ? `${Math.round(analystSentiment.bearishPercent)}% Bearish`
        : `${Math.round(analystSentiment.neutralPercent)}% Neutral`
    : "";

  const pills: PulsePill[] = [
    {
      kind: "events",
      icon: "🔥",
      label: nextEvent ? "Next event" : "Big events",
      value: nextEvent
        ? `${nextEvent.flagshipEventType ?? "Event"} ${cdLabel}`
        : flagshipEvents.length > 0
          ? `${flagshipEvents.length} upcoming`
          : "Create one",
      enabled: true,
    },
    {
      kind: "sentiment",
      icon: "📊",
      label: "Today's sentiment",
      value: sentimentLean || "Loading…",
      enabled: analystSentiment !== null,
    },
    {
      kind: "calendar",
      icon: "💼",
      label: "Policy calendar",
      value: clustersCount > 0 ? `${clustersCount} this week` : "Quiet week",
      enabled: clustersCount > 0,
    },
  ];

  // Show only pills that have meaningful data — hide entire ribbon if all empty.
  const visiblePills = pills.filter((p) => p.value.length > 0);
  if (visiblePills.length === 0) return null;

  return (
    <View style={pulseStyles.wrapper}>
      <Text style={pulseStyles.heading}>TODAY&apos;S PULSE</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={pulseStyles.scroll}
      >
        {visiblePills.map((p) => (
          <Pressable
            key={p.kind}
            onPress={() => onPress(p.kind)}
            style={({ pressed }) => [
              pulseStyles.pill,
              !p.enabled && pulseStyles.pillMuted,
              pressed && { transform: [{ scale: 0.97 }], opacity: 0.85 },
            ]}
          >
            <View style={pulseStyles.pillTop}>
              <Text style={pulseStyles.pillIcon}>{p.icon}</Text>
              <Text style={pulseStyles.pillLabel}>{p.label}</Text>
            </View>
            <Text style={pulseStyles.pillValue} numberOfLines={1}>{p.value}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function PulseSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={pulseStyles.sheetBackdrop} onPress={onClose} />
      <View style={pulseStyles.sheetContainer}>
        <View style={pulseStyles.sheetHandle} />
        <View style={pulseStyles.sheetHeader}>
          <Text style={pulseStyles.sheetTitle}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={pulseStyles.sheetClose}>Done</Text>
          </Pressable>
        </View>
        <ScrollView style={{ maxHeight: "90%" }} contentContainerStyle={{ paddingBottom: 40 }}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

const pulseStyles = StyleSheet.create({
  wrapper: { marginBottom: spacing.md },
  heading: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    color: "#9ca3af",
    paddingHorizontal: spacing.lg,
    marginBottom: 8,
  },
  scroll: { paddingHorizontal: spacing.lg, gap: 10 },
  pill: {
    width: 140,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  pillMuted: { backgroundColor: "#111827", borderColor: "#1f2937" },
  pillTop: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  pillIcon: { fontSize: 16 },
  pillLabel: { fontSize: 10, fontWeight: "700", color: "#94a3b8", letterSpacing: 0.3, textTransform: "uppercase" },
  pillValue: { fontSize: 14, fontWeight: "800", color: "#f9fafb" },

  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheetContainer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.lg,
    maxHeight: "85%",
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#d1d5db", alignSelf: "center", marginBottom: spacing.md },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md, paddingHorizontal: 4 },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: "#111827" },
  sheetClose: { fontSize: 14, fontWeight: "700", color: colors.accent },
});

export function FinanceMode({ onNavigateToFeed }: { onNavigateToFeed?: () => void }) {
  const [data, setData] = useState<ApiFinanceMarketsResponse | null>(null);
  const [analystSentiment, setAnalystSentiment] = useState<ApiFinanceExpertSentiment | null>(null);
  const [flagshipEvents, setFlagshipEvents] = useState<ApiFlagshipEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which pulse sheet is open. null = none.
  const [pulseOpen, setPulseOpen] = useState<PulseKind | null>(null);

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
      const [marketsResult, newsResult, sentimentResult, verifiedResult, flagshipResult] = await Promise.all([
        mobileApi.getFinanceMarkets(),
        mobileApi.getNews({
          category: "FINANCE",
          limit: 10,
          requireExpertOpinions: true,
          expertOpinionClusterId: selectedClusterFilter ?? undefined,
        }),
        mobileApi.getFinanceExpertSentiment().catch(() => null),
        mobileApi.getVerifiedCalls().catch(() => []),
        mobileApi.getFlagshipEvents().catch(() => ({ events: [] })),
      ]);
      setData(marketsResult);
      setFinanceNews(newsResult.items ?? []);
      setNextCursor(newsResult.nextCursor ?? null);
      setHasMore(newsResult.hasMore ?? false);
      setAnalystSentiment(sentimentResult);
      setVerifiedCalls(verifiedResult ?? []);
      setFlagshipEvents((flagshipResult?.events ?? []) as ApiFlagshipEvent[]);

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
        expertOpinionClusterId: selectedClusterFilter ?? undefined,
      });
      setFinanceNews((prev) => [...prev, ...(result.items ?? [])]);
      setNextCursor(result.nextCursor ?? null);
      setHasMore(result.hasMore ?? false);
    } catch {
      // Silently fail — user can scroll again to retry
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, nextCursor, selectedClusterFilter]);

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

  // Refetch news when cluster filter changes so server-side filtering
  // surfaces all matching stories, not just those in the first page.
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await mobileApi.getNews({
          category: "FINANCE",
          limit: 10,
          requireExpertOpinions: true,
          expertOpinionClusterId: selectedClusterFilter ?? undefined,
        });
        if (cancelled) return;
        setFinanceNews(result.items ?? []);
        setNextCursor(result.nextCursor ?? null);
        setHasMore(result.hasMore ?? false);
      } catch {
        // silently fail — keep current items
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedClusterFilter]);

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
    <>
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
      {/* Pulse ribbon — compact glanceable strip at the top */}
      <PulseRibbon
        flagshipEvents={flagshipEvents}
        analystSentiment={analystSentiment}
        clustersCount={data?.eventClusters.length ?? 0}
        onPress={(kind) => setPulseOpen(kind)}
      />

      {/* HERO HEADER — Expert Opinions is the main feature */}
      <View style={financeStyles.heroHeader}>
        <Text style={financeStyles.heroTitle}>Expert Opinions</Text>
        <Text style={financeStyles.heroSubtitle}>
          What India&apos;s top analysts are saying right now
        </Text>
        <Pressable onPress={onNavigateToFeed} style={financeStyles.heroNewsLink}>
          <Text style={financeStyles.heroNewsLinkText}>Read Finance News →</Text>
        </Pressable>
      </View>

      {/* Section 3: Expert Opinions + Market Analysis (NOW THE HERO FEED) */}
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

      {/* Top Experts link at the bottom, after the infinite-scroll feed */}
      {leaderboardCount >= 3 && (
        <Pressable
          style={financeStyles.crossTabLink}
          onPress={() => router.push("/expert-leaderboard" as Parameters<typeof router.push>[0])}
        >
          <Text style={financeStyles.crossTabLinkText}>See Top Experts →</Text>
        </Pressable>
      )}
    </ScrollView>

    {/* ── Pulse bottom sheets ────────────────────────────────────────────── */}
    <PulseSheet
      visible={pulseOpen === "events"}
      onClose={() => setPulseOpen(null)}
      title="🔥 Policy & Big Events"
    >
      <FlagshipEventsCarousel events={flagshipEvents} />
    </PulseSheet>

    <PulseSheet
      visible={pulseOpen === "sentiment"}
      onClose={() => setPulseOpen(null)}
      title="📊 Today's Analyst Sentiment"
    >
      {analystSentiment !== null ? (
        <AnalystSentimentCard
          sentiment={analystSentiment}
          onPress={() => { setPulseOpen(null); handleSentimentCardPress(); }}
        />
      ) : (
        <View style={financeStyles.emptyState}>
          <Text style={financeStyles.emptyText}>No sentiment data yet.</Text>
        </View>
      )}
    </PulseSheet>

    <PulseSheet
      visible={pulseOpen === "calendar"}
      onClose={() => setPulseOpen(null)}
      title="💼 Policy Calendar"
    >
      {data && data.eventClusters.length > 0 ? (
        data.eventClusters.map((cluster) => (
          <View key={cluster.id} style={financeStyles.clusterSection}>
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
                      {dp.date ? <Text style={financeStyles.dataPanelDate}>{dp.date}</Text> : null}
                      {dp.subtext ? <Text style={financeStyles.dataPanelSubtext}>{dp.subtext}</Text> : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={financeStyles.clusterFooter}>
              {cluster.expertTakeCount > 0 ? (
                <Pressable
                  onPress={() => {
                    setSelectedClusterFilter(cluster.id);
                    setPulseOpen(null);
                    setTimeout(() => scrollViewRef.current?.scrollTo({ y: expertSectionY.current, animated: true }), 200);
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
          <Text style={financeStyles.emptyText}>No events on the calendar this week.</Text>
        </View>
      )}
    </PulseSheet>

    </>
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
  heroHeader: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#0f172a",
    letterSpacing: -0.5,
    lineHeight: 32,
  },
  heroSubtitle: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 4,
    fontWeight: "500",
  },
  heroNewsLink: {
    marginTop: 6,
    alignSelf: "flex-start",
  },
  heroNewsLinkText: {
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

// ─── Flagship carousel styles ─────────────────────────────────────────────────
const flagshipStyles = StyleSheet.create({
  section: {
    marginBottom: spacing.lg,
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111827",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  createBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderWidth: 1,
    borderColor: "#fbbf24",
  },
  createBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#92400e",
  },
  emptyCard: {
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
    borderRadius: 12,
    backgroundColor: "rgba(245, 158, 11, 0.06)",
    borderWidth: 1,
    borderColor: "#fde68a",
    borderStyle: "dashed",
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#92400e",
    marginBottom: 4,
  },
  emptyHint: {
    fontSize: 12,
    color: "#92400e",
    opacity: 0.85,
    lineHeight: 17,
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    paddingRight: spacing.lg * 2,
  },
  card: {
    width: 280,
    backgroundColor: "#fff",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderLeftWidth: 4,
    padding: spacing.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 3,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  typeChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  typeChipText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  countdownBadge: {
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  countdownText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#92400E",
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  probSection: {
    marginBottom: spacing.xs ?? 4,
  },
  crowdLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#6B7280",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  barTrack: {
    flexDirection: "row",
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    gap: 2,
    marginBottom: 4,
  },
  barSegment: {
    borderRadius: 4,
  },
  barLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  barLabel: {
    fontSize: 11,
    fontWeight: "700",
  },
  barLabelsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  barLabelSmall: {
    fontSize: 10,
    fontWeight: "600",
  },
  noDataText: {
    fontSize: 11,
    color: "#9CA3AF",
    fontStyle: "italic",
    marginBottom: 4,
  },
  expertLine: {
    fontSize: 11,
    fontWeight: "600",
    color: "#4338CA",
    marginTop: spacing.xs ?? 4,
  },
  expertLineNull: {
    fontSize: 11,
    color: "#9CA3AF",
    fontStyle: "italic",
    marginTop: spacing.xs ?? 4,
  },
  cardFooter: {
    marginTop: spacing.sm,
    alignItems: "flex-end",
  },
  predictBtn: {
    fontSize: 13,
    fontWeight: "800",
  },
});
