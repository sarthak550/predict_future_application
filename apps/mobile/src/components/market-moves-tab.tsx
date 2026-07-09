import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import type {
  ApiMarketMoveEvent,
  ApiMarketMover,
  AppMarketMoveEventType,
  AppMarketMoveSource,
} from "@predict-future/types";
import { radius, spacing, type ThemeColors } from "@predict-future/ui-tokens";
import { formatRelativeTime } from "@predict-future/utils";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";
import { TickerChip } from "@/components/ticker-chip";

/**
 * Market Pulse (Phase 1) — "Market Pulse" tab content (ShowScope value
 * "market-moves" in finance-mode.tsx). Extracted into its own component
 * rather than added inline, per the CEO brief, so finance-mode.tsx (already
 * 4,481 lines) doesn't grow further. Code prefix is `MarketMoves`, not
 * `Pulse*` — that prefix is taken by the Rates & Events tab's internals.
 *
 * Layout: pinned Top Movers strip (5 gainers + 5 losers, horizontally
 * scrollable) followed by a reverse-chronological NSE/BSE announcement feed.
 * Rendered as plain Views (not its own ScrollView/FlatList) because the
 * parent (finance-mode.tsx) already wraps tab content in one big ScrollView —
 * pagination here is a tap-triggered "Load more" footer rather than
 * onEndReached, so it doesn't need to hook into the parent's scroll handler.
 */

const EVENT_TYPE_META: Record<AppMarketMoveEventType, { label: string; color: (c: ThemeColors) => string }> = {
  MERGER_ACQUISITION: { label: "M&A", color: (c) => c.pillarA },
  RESULTS: { label: "Results", color: (c) => c.pillarB },
  BOARD_MEETING: { label: "Board Meeting", color: (c) => c.warning },
  RATING_CHANGE: { label: "Rating Change", color: (c) => c.accent },
  OTHER_MATERIAL: { label: "Material Update", color: (c) => c.textMuted },
};

export function MarketMovesTab() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeMarketMovesStyles);
  const router = useRouter();
  const { status: authStatus } = useSession();

  const [movers, setMovers] = useState<{ gainers: ApiMarketMover[]; losers: ApiMarketMover[]; asOf: string | null } | null>(null);
  const [moversLoading, setMoversLoading] = useState(true);

  const [events, setEvents] = useState<ApiMarketMoveEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [selectedEvent, setSelectedEvent] = useState<ApiMarketMoveEvent | null>(null);

  const loadInitial = useCallback(() => {
    setMoversLoading(true);
    setEventsLoading(true);
    setLoadError(false);

    mobileApi
      .getMarketMovers()
      .then(setMovers)
      .catch((err: unknown) => {
        console.warn("[market-moves-tab] movers fetch failed:", err);
        setMovers(null);
      })
      .finally(() => setMoversLoading(false));

    mobileApi
      .getMarketMoveEvents({ limit: 20 })
      .then((page) => {
        setEvents(page.items);
        setNextCursor(page.nextCursor);
        setHasMore(page.hasMore);
      })
      .catch((err: unknown) => {
        console.warn("[market-moves-tab] events fetch failed:", err);
        setLoadError(true);
      })
      .finally(() => setEventsLoading(false));
  }, []);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    mobileApi
      .getMarketMoveEvents({ cursor: nextCursor, limit: 20 })
      .then((page) => {
        setEvents((prev) => [...prev, ...page.items]);
        setNextCursor(page.nextCursor);
        setHasMore(page.hasMore);
      })
      .catch((err: unknown) => {
        console.warn("[market-moves-tab] load-more failed:", err);
      })
      .finally(() => setLoadingMore(false));
  }, [nextCursor, loadingMore]);

  const openCreateBet = useCallback(
    (event: ApiMarketMoveEvent) => {
      router.push({
        pathname: "/(tabs)/create",
        params: {
          initialDescription: `Context: ${event.headline}\nTicker: ${event.tickerSymbol}`,
          initialCategory: "FINANCE",
        },
      });
    },
    [router]
  );

  const hasAnyMovers = movers != null && (movers.gainers.length > 0 || movers.losers.length > 0);

  return (
    <View>
      {/* Top Movers strip — pinned at the top of this tab, always visible
          (not collapsible), matching IndiaMacroCard's "no empty chrome when
          truly empty" convention. */}
      {moversLoading ? (
        <View style={[styles.card, { paddingVertical: 24, alignItems: "center" }]}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      ) : hasAnyMovers ? (
        <View style={styles.card}>
          <View style={styles.moversHeaderRow}>
            <Text style={styles.cardTitle}>Top Movers</Text>
            {movers?.asOf && (
              <Text style={styles.asOfText}>as of {formatMoversTime(movers.asOf)}</Text>
            )}
          </View>
          {movers && movers.gainers.length > 0 && (
            <MoverRow label="Gainers" items={movers.gainers} />
          )}
          {movers && movers.losers.length > 0 && (
            <MoverRow label="Losers" items={movers.losers} />
          )}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.emptyIcon}>📈</Text>
          <Text style={styles.emptyTitle}>Movers update during market hours</Text>
          <Text style={styles.emptyText}>
            Top NIFTY 200 gainers and losers appear here 9:15–15:30 IST on trading days.
          </Text>
        </View>
      )}

      {/* Announcement feed */}
      {eventsLoading ? (
        <View style={{ paddingVertical: 32, alignItems: "center" }}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      ) : loadError ? (
        <View style={styles.card}>
          <Text style={styles.emptyIcon}>⚠️</Text>
          <Text style={styles.emptyTitle}>Couldn't load announcements</Text>
          <Pressable onPress={loadInitial} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Try again</Text>
          </Pressable>
        </View>
      ) : events.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.emptyIcon}>📰</Text>
          <Text style={styles.emptyTitle}>No announcements yet</Text>
          <Text style={styles.emptyText}>
            NSE and BSE corporate announcements will appear here as companies file them.
          </Text>
        </View>
      ) : (
        <>
          {events.map((event) => (
            <AnnouncementCard
              key={event.id}
              event={event}
              onPress={() => setSelectedEvent(event)}
              onCreateBet={authStatus === "authenticated" ? () => openCreateBet(event) : undefined}
            />
          ))}
          {hasMore && (
            <Pressable
              onPress={loadMore}
              disabled={loadingMore}
              style={styles.loadMoreFooter}
            >
              {loadingMore ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Text style={styles.loadMoreText}>Load more</Text>
              )}
            </Pressable>
          )}
        </>
      )}

      <EventDetailModal
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onCreateBet={
          selectedEvent && authStatus === "authenticated"
            ? () => {
                openCreateBet(selectedEvent);
                setSelectedEvent(null);
              }
            : undefined
        }
      />
    </View>
  );
}

function formatMoversTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function MoverRow({ label, items }: { label: string; items: ApiMarketMover[] }) {
  const styles = useThemedStyles(makeMarketMovesStyles);
  return (
    <View style={styles.moverRowSection}>
      <Text style={styles.moverRowLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.moverRowScroll}>
        {items.map((m) => (
          <MoverCard key={m.tickerSymbol} mover={m} />
        ))}
      </ScrollView>
    </View>
  );
}

function MoverCard({ mover }: { mover: ApiMarketMover }) {
  const styles = useThemedStyles(makeMarketMovesStyles);
  const isGainer = mover.direction === "GAINER";
  return (
    <View style={styles.moverCard}>
      <TickerChip symbol={mover.tickerSymbol} tickerType="STOCK" size="sm" />
      {mover.companyName !== mover.tickerSymbol && (
        <Text style={styles.moverCompanyName} numberOfLines={1}>{mover.companyName}</Text>
      )}
      <View style={styles.moverChangeRow}>
        <Text style={[styles.moverChangeArrow, { color: isGainer ? styles.gainerColor.color : styles.loserColor.color }]}>
          {isGainer ? "▲" : "▼"}
        </Text>
        <Text style={[styles.moverChangePercent, isGainer ? styles.gainerColor : styles.loserColor]}>
          {Math.abs(mover.changePercent).toFixed(2)}%
        </Text>
      </View>
      {mover.isUnusualVolume && (
        <View style={styles.unusualVolumeBadge}>
          <Text style={styles.unusualVolumeText}>Unusual volume</Text>
        </View>
      )}
    </View>
  );
}

function SourceBadge({ source }: { source: AppMarketMoveSource }) {
  const styles = useThemedStyles(makeMarketMovesStyles);
  return (
    <View style={styles.sourceBadge}>
      <Text style={styles.sourceBadgeText}>{source}</Text>
    </View>
  );
}

function AnnouncementCard({
  event,
  onPress,
  onCreateBet,
}: {
  event: ApiMarketMoveEvent;
  onPress: () => void;
  onCreateBet?: () => void;
}) {
  const styles = useThemedStyles(makeMarketMovesStyles);
  const { colors } = useTheme();
  const meta = EVENT_TYPE_META[event.eventType];

  return (
    <Pressable style={styles.announcementCard} onPress={onPress}>
      <View style={styles.announcementTopRow}>
        <TickerChip symbol={event.tickerSymbol} tickerType={event.tickerType} />
        <SourceBadge source={event.source} />
      </View>

      <Text style={styles.companyName} numberOfLines={1}>{event.companyName}</Text>

      <View style={[styles.eventTypePill, { borderColor: meta.color(colors) }]}>
        <Text style={[styles.eventTypePillText, { color: meta.color(colors) }]}>
          {meta.label}
        </Text>
      </View>

      <Text style={styles.headline} numberOfLines={3}>{event.headline}</Text>

      <View style={styles.announcementFooter}>
        <Text style={styles.footerMeta}>{formatRelativeTime(event.announcedAt)}</Text>
        {onCreateBet && (
          <Pressable onPress={onCreateBet} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} style={styles.createBetCta}>
            <Ionicons name="add-circle-outline" size={12} color={colors.textMuted} style={{ marginRight: 4 }} />
            <Text style={styles.createBetLabel}>Create a bet on this</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

function EventDetailModal({
  event,
  onClose,
  onCreateBet,
}: {
  event: ApiMarketMoveEvent | null;
  onClose: () => void;
  onCreateBet?: () => void;
}) {
  const styles = useThemedStyles(makeMarketMovesStyles);
  const { colors } = useTheme();
  // Keep the last non-null event around so the sheet's content doesn't pop to
  // empty while the Modal's own close animation is still playing — `event`
  // goes null the instant the caller starts closing, but the Modal itself
  // stays mounted (visible=false) until the slide-down finishes.
  const [displayEvent, setDisplayEvent] = useState<ApiMarketMoveEvent | null>(null);
  useEffect(() => {
    if (event) setDisplayEvent(event);
  }, [event]);

  const meta = displayEvent ? EVENT_TYPE_META[displayEvent.eventType] : null;

  return (
    <Modal visible={event != null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={styles.sheetContainer}>
        <View style={styles.sheetHandle} />
        {displayEvent && meta && (
          <>
            <View style={styles.sheetHeader}>
              <TickerChip symbol={displayEvent.tickerSymbol} tickerType={displayEvent.tickerType} />
              <Pressable onPress={onClose} hitSlop={12}>
                <Text style={styles.sheetClose}>Done</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 40 }}>
              <Text style={styles.companyName}>{displayEvent.companyName}</Text>
              <View style={[styles.eventTypePill, { borderColor: meta.color(colors), marginTop: spacing.sm }]}>
                <Text style={[styles.eventTypePillText, { color: meta.color(colors) }]}>
                  {meta.label}
                </Text>
              </View>
              <Text style={styles.sheetHeadline}>{displayEvent.headline}</Text>
              {displayEvent.rawText && displayEvent.rawText !== displayEvent.headline && (
                <Text style={styles.sheetBody}>{displayEvent.rawText}</Text>
              )}
              <View style={styles.sheetMetaRow}>
                <SourceBadge source={displayEvent.source} />
                <Text style={styles.footerMeta}>{formatRelativeTime(displayEvent.announcedAt)}</Text>
              </View>
              {displayEvent.detailUrl && (
                <Pressable onPress={() => void Linking.openURL(displayEvent.detailUrl as string)} style={styles.filingLink}>
                  <Text style={styles.filingLinkText}>View filing →</Text>
                </Pressable>
              )}
              {onCreateBet && (
                <Pressable onPress={onCreateBet} style={styles.sheetCreateBetButton}>
                  <Text style={styles.sheetCreateBetText}>Create a bet on this</Text>
                </Pressable>
              )}
            </ScrollView>
          </>
        )}
      </View>
    </Modal>
  );
}

const makeMarketMovesStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    card: {
      marginHorizontal: spacing.lg,
      marginTop: spacing.xs,
      marginBottom: spacing.xs,
      backgroundColor: t.colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.colors.border,
      padding: spacing.md,
    },
    cardTitle: {
      fontSize: 13,
      fontWeight: "600" as const,
      color: t.colors.text,
    },
    moversHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.xs,
    },
    asOfText: {
      fontSize: 11,
      color: t.colors.textMuted,
    },
    moverRowSection: {
      marginTop: spacing.xs,
    },
    moverRowLabel: {
      fontSize: 10,
      fontWeight: "700" as const,
      color: t.colors.textMuted,
      textTransform: "uppercase" as const,
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    moverRowScroll: {
      gap: spacing.sm,
      paddingRight: spacing.md,
    },
    moverCard: {
      width: 128,
      padding: spacing.sm,
      borderRadius: radius.sm,
      backgroundColor: t.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: t.colors.border,
      gap: 4,
    },
    moverCompanyName: {
      fontSize: 10,
      color: t.colors.textMuted,
      marginTop: 2,
    },
    moverChangeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      marginTop: 2,
    },
    moverChangeArrow: {
      fontSize: 10,
    },
    moverChangePercent: {
      fontSize: 13,
      fontWeight: "800" as const,
    },
    gainerColor: { color: t.colors.success },
    loserColor: { color: t.colors.danger },
    unusualVolumeBadge: {
      marginTop: 4,
      alignSelf: "flex-start",
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 4,
      backgroundColor: t.colors.warningSoft,
    },
    unusualVolumeText: {
      fontSize: 8,
      fontWeight: "700" as const,
      color: t.colors.warning,
    },
    emptyIcon: {
      fontSize: 30,
      textAlign: "center",
      marginBottom: spacing.xs,
    },
    emptyTitle: {
      fontSize: 14,
      fontWeight: "600" as const,
      color: t.colors.text,
      textAlign: "center",
    },
    emptyText: {
      fontSize: 12,
      color: t.colors.textMuted,
      textAlign: "center",
      marginTop: 4,
    },
    retryButton: {
      marginTop: spacing.sm,
      alignSelf: "center",
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radius.sm,
      backgroundColor: t.colors.accentSoft,
    },
    retryButtonText: {
      fontSize: 12,
      fontWeight: "600" as const,
      color: t.colors.accent,
    },
    announcementCard: {
      marginHorizontal: spacing.lg,
      marginTop: spacing.xs,
      marginBottom: spacing.xs,
      backgroundColor: t.colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.colors.border,
      padding: spacing.md,
      gap: 6,
    },
    announcementTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    companyName: {
      fontSize: 13,
      fontWeight: "600" as const,
      color: t.colors.text,
    },
    eventTypePill: {
      alignSelf: "flex-start",
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    eventTypePillText: {
      fontSize: 10,
      fontWeight: "700" as const,
    },
    headline: {
      fontSize: 13,
      color: t.colors.text,
      lineHeight: 18,
    },
    announcementFooter: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 2,
    },
    footerMeta: {
      fontSize: 11,
      color: t.colors.textMuted,
    },
    createBetCta: {
      flexDirection: "row",
      alignItems: "center",
    },
    createBetLabel: {
      fontSize: 11,
      color: t.colors.textMuted,
      fontWeight: "500" as const,
    },
    sourceBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      backgroundColor: t.colors.surfaceMuted,
    },
    sourceBadgeText: {
      fontSize: 9,
      fontWeight: "700" as const,
      color: t.colors.textMuted,
      letterSpacing: 0.3,
    },
    loadMoreFooter: {
      marginHorizontal: spacing.lg,
      marginTop: spacing.xs,
      marginBottom: spacing.lg,
      paddingVertical: 12,
      alignItems: "center",
      borderRadius: radius.sm,
      backgroundColor: t.colors.surfaceMuted,
    },
    loadMoreText: {
      fontSize: 13,
      fontWeight: "600" as const,
      color: t.colors.accent,
    },
    // Detail sheet
    sheetBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.4)",
    },
    sheetContainer: {
      position: "absolute" as const,
      bottom: 0,
      left: 0,
      right: 0,
      maxHeight: "80%",
      backgroundColor: t.colors.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingTop: spacing.sm,
    },
    sheetHandle: {
      alignSelf: "center",
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.colors.border,
      marginBottom: spacing.sm,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    sheetClose: {
      fontSize: 14,
      fontWeight: "600" as const,
      color: t.colors.accent,
    },
    sheetHeadline: {
      fontSize: 15,
      fontWeight: "600" as const,
      color: t.colors.text,
      marginTop: spacing.sm,
      lineHeight: 21,
    },
    sheetBody: {
      fontSize: 13,
      color: t.colors.textMuted,
      marginTop: spacing.sm,
      lineHeight: 19,
    },
    sheetMetaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    filingLink: {
      marginTop: spacing.md,
    },
    filingLinkText: {
      fontSize: 13,
      fontWeight: "600" as const,
      color: t.colors.accent,
    },
    sheetCreateBetButton: {
      marginTop: spacing.lg,
      backgroundColor: t.colors.accent,
      borderRadius: radius.sm,
      paddingVertical: 12,
      alignItems: "center",
    },
    sheetCreateBetText: {
      fontSize: 14,
      fontWeight: "700" as const,
      color: "#FFFFFF",
    },
  });
