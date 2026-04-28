import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useNavigation } from "expo-router";

import type { ApiNewsFeedItem, AppMarketCategory } from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { InsightCard } from "@/components/insight-card";
import { NewsFeedCard } from "@/components/news-feed-card";
import { mobileApi } from "@/lib/api";
import { env } from "@/lib/env";

const PAGE_SIZE = 10;
const TAB_BAR_HEIGHT = 72;
const CATEGORY_BAR_HEIGHT = 52;
// Inject an insight card every N news cards (for items that have a market with votes)
const INSIGHT_INTERVAL = 4;

type CategoryFilter = { key: AppMarketCategory | "ALL"; label: string; emoji: string };
const CATEGORIES: CategoryFilter[] = [
  { key: "ALL",           label: "All",           emoji: "🌐" },
  { key: "TECH",          label: "Tech",          emoji: "💻" },
  { key: "BUSINESS",      label: "Business",      emoji: "📈" },
  { key: "SPORTS",        label: "Sports",        emoji: "⚽" },
  { key: "ENTERTAINMENT", label: "Entertainment", emoji: "🎬" },
  { key: "GENERAL",       label: "General",       emoji: "📰" },
  { key: "WEATHER",       label: "Weather",       emoji: "🌤️" },
];

type NewsListItem =
  | { _type: "news"; _key: string; item: ApiNewsFeedItem }
  | { _type: "insight"; _key: string; item: ApiNewsFeedItem };

function buildFeedItems(newsItems: ApiNewsFeedItem[]): NewsListItem[] {
  const result: NewsListItem[] = [];
  let insightCandidateIndex = 0;

  for (let i = 0; i < newsItems.length; i++) {
    result.push({ _type: "news", _key: newsItems[i].id, item: newsItems[i] });

    // After every INSIGHT_INTERVAL items, inject a crowd context card
    // for the most recent item that has a market with votes
    if ((i + 1) % INSIGHT_INTERVAL === 0 && i + 1 < newsItems.length) {
      // Look back for the nearest item with a market that has votes
      for (let j = i; j >= insightCandidateIndex; j--) {
        const candidate = newsItems[j];
        if (candidate.market && (candidate.poll?.totalVotes ?? 0) > 0) {
          result.push({ _type: "insight", _key: `insight-${candidate.id}-${i}`, item: candidate });
          insightCandidateIndex = i + 1;
          break;
        }
      }
    }
  }
  return result;
}

export default function FeedScreen() {
  const { height } = useWindowDimensions();
  const navigation = useNavigation();
  const listRef = useRef<FlatList<NewsListItem>>(null);

  const [items, setItems] = useState<ApiNewsFeedItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<AppMarketCategory | "ALL">("ALL");

  // Swipe hint — shown on first load, disappears after 3s
  const [showHint, setShowHint] = useState(true);
  const hintOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (items.length > 0 && showHint) {
      Animated.sequence([
        Animated.timing(hintOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.delay(2200),
        Animated.timing(hintOpacity, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]).start(() => setShowHint(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length > 0]);

  // Stable refs to avoid re-creating loadPage
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const categoryRef = useRef<AppMarketCategory | "ALL">("ALL");

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadPage = useCallback(async (mode: "append" | "replace") => {
    if (inFlightRef.current) return;
    if (mode === "append" && !hasMoreRef.current) return;

    inFlightRef.current = true;
    if (mode === "replace") {
      setLoading(true);
      setError(null);
    }

    try {
      const cat = categoryRef.current;
      const query: Parameters<typeof mobileApi.getNews>[0] = {
        limit: PAGE_SIZE,
        cursor: mode === "append" ? cursorRef.current : null,
        userId: env.demoUserId,
      };

      if (cat === "ALL") {
        // Default: show everything except sports (sports has its own tab)
        // — but allow override if user explicitly wants sports
      } else {
        query.category = cat;
      }

      const response = await mobileApi.getNews(query);
      if (!mountedRef.current) return;

      const pageItems = response.items;
      setItems((current) =>
        mergeUniqueItems(mode === "append" ? current : [], pageItems)
      );
      cursorRef.current = response.nextCursor ?? null;
      hasMoreRef.current = Boolean(response.hasMore);
      setHasMore(hasMoreRef.current);
      setError(null);
    } catch (nextError) {
      if (!mountedRef.current) return;
      setError(nextError instanceof Error ? nextError.message : "Unable to fetch the feed.");
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void loadPage("replace");
  }, [loadPage]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    cursorRef.current = null;
    hasMoreRef.current = true;
    mobileApi.refreshNewsFeed({ userId: env.demoUserId }).catch(() => {});
    void loadPage("replace");
  }, [loadPage]);

  // Scroll to top + refresh when tab tapped while active
  useEffect(() => {
    const unsubscribe = navigation.addListener("tabPress" as never, () => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      onRefresh();
    });
    return unsubscribe;
  }, [navigation, onRefresh]);

  const onEndReached = useCallback(() => {
    if (hasMoreRef.current && !inFlightRef.current) {
      void loadPage("append");
    }
  }, [loadPage]);

  function handleCategoryChange(cat: AppMarketCategory | "ALL") {
    if (cat === category) return;
    categoryRef.current = cat;
    setCategory(cat);
    setItems([]);
    cursorRef.current = null;
    hasMoreRef.current = true;
    inFlightRef.current = false;
    void loadPage("replace");
  }

  const cardHeight = useMemo(
    () => Math.max(480, height - TAB_BAR_HEIGHT - CATEGORY_BAR_HEIGHT),
    [height]
  );

  const feedItems = useMemo(() => buildFeedItems(items), [items]);

  const getItemLayout = useCallback(
    (_data: ArrayLike<NewsListItem> | null | undefined, index: number) => ({
      length: cardHeight,
      offset: cardHeight * index,
      index,
    }),
    [cardHeight]
  );

  return (
    <View style={styles.screen}>
      {/* Category filter bar */}
      <View style={[styles.categoryBar, { height: CATEGORY_BAR_HEIGHT }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryScroll}
        >
          {CATEGORIES.map((cat) => {
            const active = category === cat.key;
            return (
              <Pressable
                key={cat.key}
                style={[styles.categoryChip, active && styles.categoryChipActive]}
                onPress={() => handleCategoryChange(cat.key)}
              >
                <Text style={styles.categoryChipEmoji}>{cat.emoji}</Text>
                <Text style={[styles.categoryChipLabel, active && styles.categoryChipLabelActive]}>
                  {cat.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <FlatList
        ref={listRef}
        data={feedItems}
        keyExtractor={(item) => item._key}
        snapToInterval={cardHeight}
        snapToAlignment="start"
        decelerationRate={0.985}
        showsVerticalScrollIndicator={false}
        getItemLayout={getItemLayout}
        removeClippedSubviews
        maxToRenderPerBatch={3}
        windowSize={5}
        contentContainerStyle={feedItems.length === 0 ? styles.emptyContent : undefined}
        onEndReachedThreshold={0.65}
        onEndReached={onEndReached}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.centerState}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.stateText}>Loading latest news…</Text>
            </View>
          ) : error ? (
            <View style={styles.centerState}>
              <Text style={styles.stateTitle}>Couldn't load the feed</Text>
              <Text style={styles.stateText}>{error}</Text>
              <Pressable onPress={() => void loadPage("replace")} style={styles.retry}>
                <Text style={styles.retryLabel}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.centerState}>
              <Text style={styles.stateTitle}>No stories yet</Text>
              <Text style={styles.stateText}>Pull down to refresh.</Text>
            </View>
          )
        }
        ListFooterComponent={
          hasMore && feedItems.length > 0 ? (
            <View style={styles.footer}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : null
        }
        renderItem={({ item, index }) => {
          if (item._type === "insight") {
            return <InsightCard item={item.item} viewportHeight={cardHeight} />;
          }
          return (
            <NewsFeedCard
              item={item.item}
              viewportHeight={cardHeight}
              showHint={index === 0 && showHint}
            />
          );
        }}
      />

      {/* Global swipe hint overlay for first card */}
      {showHint && feedItems.length > 0 && (
        <Animated.View
          style={[styles.swipeHintOverlay, { opacity: hintOpacity }]}
          pointerEvents="none"
        >
          <Text style={styles.swipeHintOverlayText}>↑  Swipe up for next story</Text>
        </Animated.View>
      )}
    </View>
  );
}

function mergeUniqueItems(current: ApiNewsFeedItem[], next: ApiNewsFeedItem[]) {
  const seen = new Set(current.map((item) => item.id));
  const merged = [...current];
  for (const item of next) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },

  // Category bar
  categoryBar: {
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    justifyContent: "center",
  },
  categoryScroll: {
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryChipActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  categoryChipEmoji: { fontSize: 13 },
  categoryChipLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  categoryChipLabelActive: { color: "#FFFFFF" },

  // List states
  emptyContent: { flexGrow: 1 },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  stateTitle: { fontSize: 24, fontWeight: "700", color: colors.text },
  stateText: {
    marginTop: spacing.md,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    color: colors.textMuted,
  },
  footer: { paddingVertical: spacing.lg },
  retry: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  retryLabel: { color: colors.surface, fontWeight: "700", fontSize: 14 },

  // Swipe hint overlay
  swipeHintOverlay: {
    position: "absolute",
    bottom: spacing.xl + 12,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  swipeHintOverlayText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: 7,
    borderRadius: radius.pill,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
});
