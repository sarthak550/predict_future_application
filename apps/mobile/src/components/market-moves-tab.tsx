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
  ApiInstrumentDetail,
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

/** "₹1,830.50" — Indian digit grouping, at most 2 decimal places. Matches web's formatRupees. */
function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** "+₹52.00" / "-₹12.30" — signed rupee change, shown under the % figure. */
function formatSignedRupees(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}₹${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

const ANALYST_DIRECTION_LABEL: Record<"BULLISH" | "BEARISH" | "NEUTRAL", string> = {
  BULLISH: "Bullish",
  BEARISH: "Bearish",
  NEUTRAL: "Neutral",
};

const ANALYST_RESOLUTION_LABEL: Partial<Record<"PENDING" | "RESOLVED_HIT" | "RESOLVED_MISS" | "NOT_GRADED", string>> = {
  PENDING: "pending",
  RESOLVED_HIT: "hit",
  RESOLVED_MISS: "miss",
};

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
  // One shared toggle for both directions — independent expansion left the
  // columns lopsided and doubled the taps for what reads as one action.
  const [showAllMovers, setShowAllMovers] = useState(false);

  const [news, setNews] = useState<ApiMarketMoveNews[]>([]);
  const [newsShown, setNewsShown] = useState(SHOWN_INITIAL);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsLoadError, setNewsLoadError] = useState(false);

  const [events, setEvents] = useState<ApiMarketMoveEvent[]>([]);
  const [filingsShown, setFilingsShown] = useState(SHOWN_INITIAL);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [selectedEvent, setSelectedEvent] = useState<ApiMarketMoveEvent | null>(null);

  // Instrument tap-through sheet (Market Pulse Phase 2) — opened from a
  // MoverCard tap. Symbol drives both the Modal's visibility and the fetch;
  // detail/loading/error are separate from the symbol so the sheet can show a
  // spinner immediately on open and a stable "last good" render while closing.
  const [selectedMoverSymbol, setSelectedMoverSymbol] = useState<string | null>(null);
  const [instrumentDetail, setInstrumentDetail] = useState<ApiInstrumentDetail | null>(null);
  const [instrumentLoading, setInstrumentLoading] = useState(false);
  const [instrumentError, setInstrumentError] = useState(false);

  const loadInstrumentDetail = useCallback((symbol: string) => {
    setInstrumentLoading(true);
    setInstrumentError(false);
    mobileApi
      .getInstrumentDetail(symbol)
      .then(setInstrumentDetail)
      .catch((err: unknown) => {
        console.warn("[market-moves-tab] instrument detail fetch failed:", err);
        setInstrumentError(true);
      })
      .finally(() => setInstrumentLoading(false));
  }, []);

  const openInstrumentSheet = useCallback(
    (symbol: string) => {
      setSelectedMoverSymbol(symbol);
      setInstrumentDetail(null);
      loadInstrumentDetail(symbol);
    },
    [loadInstrumentDetail]
  );

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
            <MoverRow label="Gainers" items={movers.gainers} showAll={showAllMovers} onSelect={openInstrumentSheet} />
          )}
          {movers && movers.losers.length > 0 && (
            <MoverRow label="Losers" items={movers.losers} showAll={showAllMovers} onSelect={openInstrumentSheet} />
          )}
          {movers &&
            Math.max(movers.gainers.length, movers.losers.length) > MOVERS_COLLAPSED_COUNT && (
              <Pressable
                onPress={() => setShowAllMovers((v) => !v)}
                style={styles.moverShowToggle}
              >
                <Text style={styles.moverShowToggleText}>
                  {showAllMovers
                    ? "Show less"
                    : `Show all ${Math.max(movers.gainers.length, movers.losers.length)}`}
                </Text>
              </Pressable>
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

      <InstrumentDetailSheet
        symbol={selectedMoverSymbol}
        detail={instrumentDetail}
        loading={instrumentLoading}
        error={instrumentError}
        onRetry={() => selectedMoverSymbol && loadInstrumentDetail(selectedMoverSymbol)}
        onClose={() => setSelectedMoverSymbol(null)}
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
  onSelect,
}: {
  label: string;
  items: ApiMarketMover[];
  showAll: boolean;
  onSelect: (symbol: string) => void;
}) {
  const styles = useThemedStyles(makeMarketMovesStyles);
  const visible = showAll ? items : items.slice(0, MOVERS_COLLAPSED_COUNT);
  return (
    <View style={styles.moverRowSection}>
      <Text style={styles.moverRowLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.moverRowScroll}>
        {visible.map((m) => (
          <MoverCard key={m.tickerSymbol} mover={m} onPress={() => onSelect(m.tickerSymbol)} />
        ))}
      </ScrollView>
    </View>
  );
}

function MoverCard({ mover, onPress }: { mover: ApiMarketMover; onPress: () => void }) {
  const styles = useThemedStyles(makeMarketMovesStyles);
  const { colors } = useTheme();
  const isGainer = mover.direction === "GAINER";
  const analystCall = mover.analystCall ?? null;
  const analystDirectionColor =
    analystCall?.direction === "BULLISH"
      ? colors.success
      : analystCall?.direction === "BEARISH"
        ? colors.danger
        : colors.textMuted;

  return (
    <Pressable style={styles.moverCard} onPress={onPress}>
      <TickerChip symbol={mover.tickerSymbol} tickerType="STOCK" size="sm" />
      {mover.companyName !== mover.tickerSymbol && (
        <Text style={styles.moverCompanyName} numberOfLines={1}>{mover.companyName}</Text>
      )}
      {mover.lastPrice != null && (
        <Text style={styles.moverPrice} numberOfLines={1}>{formatRupees(mover.lastPrice)}</Text>
      )}
      <View style={styles.moverChangeRow}>
        <Text style={[styles.moverChangeArrow, { color: isGainer ? styles.gainerColor.color : styles.loserColor.color }]}>
          {isGainer ? "▲" : "▼"}
        </Text>
        <Text style={[styles.moverChangePercent, isGainer ? styles.gainerColor : styles.loserColor]}>
          {Math.abs(mover.changePercent).toFixed(2)}%
        </Text>
      </View>
      <Text style={styles.moverChangeAbs} numberOfLines={1}>{formatSignedRupees(mover.changeAbs)}</Text>
      {mover.isUnusualVolume && (
        <View style={styles.unusualVolumeBadge}>
          <Text style={styles.unusualVolumeText}>Unusual volume</Text>
        </View>
      )}
      {mover.topHeadline && (
        <Pressable onPress={() => void Linking.openURL(mover.topHeadline!.sourceUrl)} hitSlop={4}>
          <Text style={styles.moverHeadline} numberOfLines={1}>{mover.topHeadline.headline}</Text>
        </Pressable>
      )}
      {analystCall && (
        <Text style={styles.moverAnalystCall} numberOfLines={1}>
          <Text style={{ color: colors.text, fontWeight: "600" }}>{analystCall.analystName}</Text>
          <Text>: </Text>
          <Text style={{ color: analystDirectionColor, fontWeight: "700" }}>
            {ANALYST_DIRECTION_LABEL[analystCall.direction]}
          </Text>
          {ANALYST_RESOLUTION_LABEL[analystCall.resolutionStatus] ? (
            <Text> · {ANALYST_RESOLUTION_LABEL[analystCall.resolutionStatus]}</Text>
          ) : null}
        </Text>
      )}
    </Pressable>
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

/** Latest N news / opinion rows shown inside the instrument sheet — the full lists live on the web detail page, this is a glanceable summary. */
const SHEET_NEWS_LIMIT = 5;
const SHEET_OPINIONS_LIMIT = 3;

/**
 * Market Pulse Phase 2 — instrument tap-through bottom sheet, opened from a
 * MoverCard tap. Follows the exact same Modal/backdrop/sheetContainer pattern
 * as EventDetailModal above (this app has no shared reusable bottom-sheet
 * primitive yet) rather than importing finance-mode.tsx's PulseSheet, which
 * is a private, unexported function local to that (already 4,000+ line) file.
 *
 * `symbol` alone drives visibility (`visible={symbol != null}`) so the sheet
 * can render its loading state immediately on open, before the fetch
 * resolves — `detail` only arrives once `mobileApi.getInstrumentDetail`
 * completes.
 */
function InstrumentDetailSheet({
  symbol,
  detail,
  loading,
  error,
  onRetry,
  onClose,
}: {
  symbol: string | null;
  detail: ApiInstrumentDetail | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const styles = useThemedStyles(makeMarketMovesStyles);
  const { colors } = useTheme();

  // Keep the last non-null symbol/detail around through the Modal's own close
  // animation, same rationale as EventDetailModal's displayEvent.
  const [displaySymbol, setDisplaySymbol] = useState<string | null>(null);
  useEffect(() => {
    if (symbol) setDisplaySymbol(symbol);
  }, [symbol]);

  const quote = detail?.quote ?? null;
  const isUp = quote != null && quote.changePercent >= 0;

  return (
    <Modal visible={symbol != null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={styles.sheetContainer}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          {displaySymbol && <TickerChip symbol={displaySymbol} tickerType="STOCK" />}
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.sheetClose}>Done</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={{ paddingVertical: 40, alignItems: "center" }}>
            <ActivityIndicator size="small" color={colors.accent} />
          </View>
        ) : error ? (
          <View style={{ paddingVertical: 32, alignItems: "center", paddingHorizontal: spacing.lg }}>
            <Text style={styles.emptyIcon}>⚠️</Text>
            <Text style={styles.emptyTitle}>Couldn&apos;t load {displaySymbol}</Text>
            <Pressable onPress={onRetry} style={styles.retryButton}>
              <Text style={styles.retryButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : detail ? (
          <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 40 }}>
            <Text style={styles.companyName}>{detail.companyName}</Text>

            {quote ? (
              <>
                <View style={styles.instrumentPriceRow}>
                  <Text style={styles.instrumentPrice}>{formatRupees(quote.close)}</Text>
                  <Text style={[styles.instrumentChange, isUp ? styles.gainerColor : styles.loserColor]}>
                    {isUp ? "▲" : "▼"} {Math.abs(quote.changePercent).toFixed(2)}%
                    {"  "}
                    {formatSignedRupees(quote.close - quote.prevClose)}
                  </Text>
                </View>
                <Text style={styles.footerMeta}>
                  As of {new Date(quote.sessionDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                </Text>
                <View style={styles.instrumentStatRow}>
                  <View style={styles.instrumentStat}>
                    <Text style={styles.instrumentStatLabel}>Volume</Text>
                    <Text style={styles.instrumentStatValue}>{quote.volume.toLocaleString("en-IN")}</Text>
                  </View>
                  {quote.deliveryPct != null && (
                    <View style={styles.instrumentStat}>
                      <Text style={styles.instrumentStatLabel}>Delivery %</Text>
                      <Text style={styles.instrumentStatValue}>{quote.deliveryPct.toFixed(1)}%</Text>
                    </View>
                  )}
                </View>
              </>
            ) : (
              <Text style={[styles.footerMeta, { marginTop: spacing.xs }]}>Price data pending.</Text>
            )}

            {detail.news.length > 0 && (
              <View style={{ marginTop: spacing.lg }}>
                <Text style={styles.instrumentSectionTitle}>Latest news</Text>
                {detail.news.slice(0, SHEET_NEWS_LIMIT).map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => void Linking.openURL(item.sourceUrl)}
                    style={styles.instrumentNewsRow}
                  >
                    <Text style={styles.instrumentNewsHeadline} numberOfLines={2}>{item.headline}</Text>
                    <Text style={styles.footerMeta}>
                      {item.publisher} · {formatRelativeTime(item.publishedAt)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            {detail.opinions.length > 0 && (
              <View style={{ marginTop: spacing.lg }}>
                <Text style={styles.instrumentSectionTitle}>Analyst opinions</Text>
                {detail.opinions.slice(0, SHEET_OPINIONS_LIMIT).map((opinion) => {
                  const directionColor =
                    opinion.direction === "BULLISH"
                      ? colors.success
                      : opinion.direction === "BEARISH"
                        ? colors.danger
                        : colors.textMuted;
                  return (
                    <View key={opinion.id} style={styles.instrumentOpinionRow}>
                      <Text style={styles.instrumentOpinionAnalyst} numberOfLines={1}>{opinion.expert.name}</Text>
                      <Text style={[styles.instrumentOpinionDirection, { color: directionColor }]}>
                        {ANALYST_DIRECTION_LABEL[opinion.direction]}
                        {ANALYST_RESOLUTION_LABEL[opinion.resolutionStatus]
                          ? ` · ${ANALYST_RESOLUTION_LABEL[opinion.resolutionStatus]}`
                          : ""}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}

            <Text style={[styles.footerMeta, { marginTop: spacing.lg }]}>
              {detail.filings.length} filing{detail.filings.length === 1 ? "" : "s"} in the last 10 announcements tracked.
            </Text>
          </ScrollView>
        ) : null}
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
      width: 168,
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
    moverPrice: {
      fontSize: 13,
      fontWeight: "700" as const,
      color: t.colors.text,
      marginTop: 1,
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
    moverChangeAbs: {
      fontSize: 10,
      color: t.colors.textMuted,
    },
    moverHeadline: {
      fontSize: 10,
      color: t.colors.textMuted,
      marginTop: 2,
      textDecorationLine: "underline" as const,
    },
    moverAnalystCall: {
      fontSize: 10,
      color: t.colors.textMuted,
      marginTop: 2,
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
    // Instrument tap-through sheet (Market Pulse Phase 2)
    instrumentPriceRow: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    instrumentPrice: {
      fontSize: 24,
      fontWeight: "800" as const,
      color: t.colors.text,
    },
    instrumentChange: {
      fontSize: 13,
      fontWeight: "700" as const,
    },
    instrumentStatRow: {
      flexDirection: "row",
      gap: spacing.lg,
      marginTop: spacing.md,
    },
    instrumentStat: {
      gap: 2,
    },
    instrumentStatLabel: {
      fontSize: 10,
      fontWeight: "700" as const,
      textTransform: "uppercase" as const,
      letterSpacing: 0.4,
      color: t.colors.textMuted,
    },
    instrumentStatValue: {
      fontSize: 14,
      fontWeight: "700" as const,
      color: t.colors.text,
    },
    instrumentSectionTitle: {
      fontSize: 12,
      fontWeight: "700" as const,
      textTransform: "uppercase" as const,
      letterSpacing: 0.4,
      color: t.colors.textMuted,
      marginBottom: spacing.xs,
    },
    instrumentNewsRow: {
      paddingVertical: spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.border,
      gap: 3,
    },
    instrumentNewsHeadline: {
      fontSize: 13,
      fontWeight: "600" as const,
      color: t.colors.text,
      lineHeight: 18,
    },
    instrumentOpinionRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.border,
      gap: spacing.sm,
    },
    instrumentOpinionAnalyst: {
      flex: 1,
      fontSize: 13,
      fontWeight: "600" as const,
      color: t.colors.text,
    },
    instrumentOpinionDirection: {
      fontSize: 12,
      fontWeight: "700" as const,
    },
  });
