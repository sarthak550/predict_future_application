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
  ApiMarketMoveNews,
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
 * Layout: pinned Top Movers strip (top 5 gainers/losers with a "Show all N"
 * toggle per column — the DB holds ~20/direction per session, see the
 * `/api/finance/market-moves/movers` route doc), then a peer-tab section —
 * "Stock News" (readable Google News headlines, MarketMoveNews) and "Filings
 * & announcements" (NSE/BSE corporate announcements, MarketMoveEvent) as
 * equal tabs, mirroring the web /pulse redesign (`PulseTabs`/`MoverList` in
 * apps/web/components/finance). Filings are no longer buried in a
 * collapsed-by-default disclosure at the bottom — they're a first-class peer
 * of Stock News, just one tap away.
 *
 * Both feeds are fetched ONCE on mount at a generous limit (news ~60,
 * filings ~40 — well under the routes' 100/60 caps) and revealed
 * incrementally client-side via a "Show more" (+20) button that just grows a
 * `.slice()` count, exactly like the web implementation — no repeated
 * network round-trips for pagination within this view.
 *
 * Rendered as plain Views (not its own ScrollView/FlatList) because the
 * parent (finance-mode.tsx) already wraps tab content in one big ScrollView —
 * the "Show more" buttons just grow local slice counts, so no scroll-handler
 * wiring (onEndReached etc.) is needed either.
 */

const EVENT_TYPE_META: Record<AppMarketMoveEventType, { label: string; color: (c: ThemeColors) => string }> = {
  MERGER_ACQUISITION: { label: "M&A", color: (c) => c.pillarA },
  RESULTS: { label: "Results", color: (c) => c.pillarB },
  BOARD_MEETING: { label: "Board Meeting", color: (c) => c.warning },
  RATING_CHANGE: { label: "Rating Change", color: (c) => c.accent },
  OTHER_MATERIAL: { label: "Material Update", color: (c) => c.textMuted },
};

/** Top Movers strip: collapsed row size, matching web's MoverList COLLAPSED_COUNT. */
const MOVERS_COLLAPSED_COUNT = 5;

/** Peer-tab feeds: fetched once at this size (server caps: news 100, filings 60),
 *  then revealed incrementally client-side — see file-header doc comment. */
const NEWS_FETCH_LIMIT = 60;
const FILINGS_FETCH_LIMIT = 40;
const SHOWN_INITIAL = 20;
const SHOWN_STEP = 20;

type PulseFeedTab = "news" | "filings";

export function MarketMovesTab() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeMarketMovesStyles);
  const router = useRouter();
  const { status: authStatus } = useSession();

  const [movers, setMovers] = useState<{ gainers: ApiMarketMover[]; losers: ApiMarketMover[]; asOf: string | null } | null>(null);
  const [moversLoading, setMoversLoading] = useState(true);
  const [showAllGainers, setShowAllGainers] = useState(false);
  const [showAllLosers, setShowAllLosers] = useState(false);

  const [news, setNews] = useState<ApiMarketMoveNews[]>([]);
  const [newsShown, setNewsShown] = useState(SHOWN_INITIAL);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsLoadError, setNewsLoadError] = useState(false);

  const [events, setEvents] = useState<ApiMarketMoveEvent[]>([]);
  const [filingsShown, setFilingsShown] = useState(SHOWN_INITIAL);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [selectedEvent, setSelectedEvent] = useState<ApiMarketMoveEvent | null>(null);

  // Stock News / Filings & announcements peer tabs — News leads by default
  // (primary Zone 2 read surface); filings are one tap away instead of
  // buried behind a collapsed disclosure.
  const [feedTab, setFeedTab] = useState<PulseFeedTab>("news");

  const loadInitial = useCallback(() => {
    setMoversLoading(true);
    setNewsLoading(true);
    setEventsLoading(true);
    setLoadError(false);
    setNewsLoadError(false);
    setNewsShown(SHOWN_INITIAL);
    setFilingsShown(SHOWN_INITIAL);

    mobileApi
      .getMarketMovers()
      .then(setMovers)
      .catch((err: unknown) => {
        console.warn("[market-moves-tab] movers fetch failed:", err);
        setMovers(null);
      })
      .finally(() => setMoversLoading(false));

    mobileApi
      .getMarketMoveNews({ limit: NEWS_FETCH_LIMIT })
      .then((page) => {
        setNews(page.items);
      })
      .catch((err: unknown) => {
        console.warn("[market-moves-tab] news fetch failed:", err);
        setNewsLoadError(true);
      })
      .finally(() => setNewsLoading(false));

    mobileApi
      .getMarketMoveEvents({ limit: FILINGS_FETCH_LIMIT })
      .then((page) => {
        setEvents(page.items);
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

  const showMoreNews = useCallback(() => {
    setNewsShown((prev) => Math.min(prev + SHOWN_STEP, news.length));
  }, [news.length]);

  const showMoreFilings = useCallback(() => {
    setFilingsShown((prev) => Math.min(prev + SHOWN_STEP, events.length));
  }, [events.length]);

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
            <MoverRow
              label="Gainers"
              items={movers.gainers}
              showAll={showAllGainers}
              onToggleShowAll={() => setShowAllGainers((v) => !v)}
            />
          )}
          {movers && movers.losers.length > 0 && (
            <MoverRow
              label="Losers"
              items={movers.losers}
              showAll={showAllLosers}
              onToggleShowAll={() => setShowAllLosers((v) => !v)}
            />
          )}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.emptyIcon}>📈</Text>
          <Text style={styles.emptyTitle}>Top Movers loading</Text>
          <Text style={styles.emptyText}>
            The latest session's top NIFTY 200 gainers and losers will appear here shortly.
          </Text>
        </View>
      )}

      {/* Stock News / Filings & announcements — equal peer tabs (mirrors the
          web /pulse PulseTabs redesign). Both feeds are fetched upfront on
          mount, so switching tabs is instant — no per-tab loading state. */}
      <View style={styles.feedTabBar}>
        <Pressable
          onPress={() => setFeedTab("news")}
          style={[styles.feedTab, feedTab === "news" && styles.feedTabActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: feedTab === "news" }}
        >
          <Text style={[styles.feedTabText, feedTab === "news" && styles.feedTabTextActive]} numberOfLines={1}>
            Stock News
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setFeedTab("filings")}
          style={[styles.feedTab, feedTab === "filings" && styles.feedTabActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: feedTab === "filings" }}
        >
          <Text style={[styles.feedTabText, feedTab === "filings" && styles.feedTabTextActive]} numberOfLines={1}>
            Filings &amp; announcements
          </Text>
        </Pressable>
      </View>

      {feedTab === "news" ? (
        newsLoading ? (
          <View style={{ paddingVertical: 32, alignItems: "center" }}>
            <ActivityIndicator size="small" color={colors.accent} />
          </View>
        ) : newsLoadError ? (
          <View style={styles.card}>
            <Text style={styles.emptyIcon}>⚠️</Text>
            <Text style={styles.emptyTitle}>Couldn't load news</Text>
            <Pressable onPress={loadInitial} style={styles.retryButton}>
              <Text style={styles.retryButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : news.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.emptyIcon}>📰</Text>
            <Text style={styles.emptyTitle}>No fresh headlines yet</Text>
            <Text style={styles.emptyText}>
              Readable news for today's movers and filings will appear here as stories are published.
            </Text>
          </View>
        ) : (
          <>
            {news.slice(0, newsShown).map((item) => (
              <NewsCard key={item.id} item={item} />
            ))}
            <ShowMoreFooter shown={Math.min(newsShown, news.length)} total={news.length} onPress={showMoreNews} />
          </>
        )
      ) : eventsLoading ? (
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
          {events.slice(0, filingsShown).map((event) => (
            <AnnouncementCard
              key={event.id}
              event={event}
              onPress={() => setSelectedEvent(event)}
              onCreateBet={authStatus === "authenticated" ? () => openCreateBet(event) : undefined}
            />
          ))}
          <ShowMoreFooter shown={Math.min(filingsShown, events.length)} total={events.length} onPress={showMoreFilings} />
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

/**
 * Incremental "Show more" footer for the Stock News / Filings & announcements
 * tabs — grows a client-side slice count rather than issuing another network
 * request, matching web's `ShowMoreFooter` in pulse-tabs.tsx. Renders a quiet
 * "showing the latest N" caption once fully revealed instead of disappearing,
 * so the list doesn't end with a jarring hard cut.
 */
function ShowMoreFooter({ shown, total, onPress }: { shown: number; total: number; onPress: () => void }) {
  const styles = useThemedStyles(makeMarketMovesStyles);
  if (shown >= total) {
    return (
      <Text style={styles.showMoreExhaustedText}>
        Showing the latest {total} — older items roll off as new ones arrive.
      </Text>
    );
  }
  return (
    <Pressable onPress={onPress} style={styles.loadMoreFooter}>
      <Text style={styles.loadMoreText}>Show more ({shown} of {total})</Text>
    </Pressable>
  );
}

/**
 * One direction's row in the Top Movers strip. Server now returns the FULL
 * latest-session list (~20/direction) — this renders the first
 * MOVERS_COLLAPSED_COUNT by default with a "Show all N"/"Show less" toggle,
 * matching web's MoverList component.
 */
function MoverRow({
  label,
  items,
  showAll,
  onToggleShowAll,
}: {
  label: string;
  items: ApiMarketMover[];
  showAll: boolean;
  onToggleShowAll: () => void;
}) {
  const styles = useThemedStyles(makeMarketMovesStyles);
  const visible = showAll ? items : items.slice(0, MOVERS_COLLAPSED_COUNT);
  const hiddenCount = items.length - MOVERS_COLLAPSED_COUNT;
  return (
    <View style={styles.moverRowSection}>
      <Text style={styles.moverRowLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.moverRowScroll}>
        {visible.map((m) => (
          <MoverCard key={m.tickerSymbol} mover={m} />
        ))}
      </ScrollView>
      {hiddenCount > 0 && (
        <Pressable onPress={onToggleShowAll} style={styles.moverShowToggle}>
          <Text style={styles.moverShowToggleText}>
            {showAll ? "Show less" : `Show all ${items.length}`}
          </Text>
        </Pressable>
      )}
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

function NewsCard({ item }: { item: ApiMarketMoveNews }) {
  const styles = useThemedStyles(makeMarketMovesStyles);

  return (
    <Pressable style={styles.newsCard} onPress={() => void Linking.openURL(item.sourceUrl)}>
      <View style={styles.newsTopRow}>
        <TickerChip symbol={item.tickerSymbol} tickerType="STOCK" size="sm" />
        <Text style={styles.newsPublisher} numberOfLines={1}>{item.publisher}</Text>
      </View>
      <Text style={styles.newsHeadline} numberOfLines={4}>{item.headline}</Text>
      <Text style={styles.footerMeta}>{formatRelativeTime(item.publishedAt)}</Text>
    </Pressable>
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
    moverShowToggle: {
      marginTop: spacing.xs,
      alignSelf: "flex-start",
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radius.sm,
      backgroundColor: t.colors.surfaceMuted,
    },
    moverShowToggleText: {
      fontSize: 11,
      fontWeight: "600" as const,
      color: t.colors.accent,
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
    newsCard: {
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
    newsTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    newsPublisher: {
      flex: 1,
      fontSize: 11,
      fontWeight: "600" as const,
      color: t.colors.textMuted,
      textAlign: "right",
    },
    newsHeadline: {
      fontSize: 15,
      fontWeight: "700" as const,
      color: t.colors.text,
      lineHeight: 21,
    },
    // Stock News / Filings & announcements peer-tab bar — mirrors the
    // finance-mode.tsx scope-tab pill pattern (controlsStyles.tab/tabActive)
    // for visual consistency with the rest of the Finance section.
    feedTabBar: {
      flexDirection: "row",
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    feedTab: {
      flex: 1,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surface,
      alignItems: "center",
    },
    feedTabActive: {
      backgroundColor: t.colors.accent,
      borderColor: t.colors.accent,
    },
    feedTabText: {
      fontSize: 13,
      fontWeight: "700" as const,
      color: t.colors.textMuted,
    },
    feedTabTextActive: {
      color: "#FFFFFF",
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
    showMoreExhaustedText: {
      marginHorizontal: spacing.lg,
      marginTop: spacing.xs,
      marginBottom: spacing.lg,
      fontSize: 11,
      color: t.colors.textMuted,
      textAlign: "center",
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
