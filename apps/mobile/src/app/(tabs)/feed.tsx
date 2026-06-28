import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import type { ApiNewsFeedItem, AppAnalystTier, AppMarketCategory } from "@predict-future/types";
import { radius, spacing } from "@predict-future/ui-tokens";

import {
  CategoryFilterBar,
  FILTER_BAR_CATEGORIES,
  type CategoryKey,
} from "@/components/category-filter-bar";
import { GradientHeader } from "@/components/gradient-header";
import { InsightCard } from "@/components/insight-card";
import { NewsFeedCard } from "@/components/news-feed-card";
import { SkeletonFeedCard } from "@/components/skeleton-feed-card";
import { StreakBadge } from "@/components/streak-reminder";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

const FEED_PERSONALIZATION_KEY = "feed_personalization_mode";

const PAGE_SIZE = 10;
const TAB_BAR_HEIGHT = 72;
const CATEGORY_BAR_HEIGHT = 52;
// Inject an insight card every N news cards (for items that have a market with votes)
const INSIGHT_INTERVAL = 4;


const FEED_CATEGORIES = FILTER_BAR_CATEGORIES;

const ANALYST_TIER_LABELS: Record<AppAnalystTier, string> = {
  ROOKIE: "Rookie",
  ANALYST: "Analyst",
  SENIOR_ANALYST: "Senior Analyst",
  CHIEF_ANALYST: "Chief Analyst",
};

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

type PersonalizationMode = "for_you" | "all";

export default function FeedScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { height } = useWindowDimensions();
  const navigation = useNavigation();
  const router = useRouter();
  const { category: categoryParam } = useLocalSearchParams<{ category?: string }>();
  const { session, status: authStatus } = useSession();
  const listRef = useRef<FlatList<NewsListItem>>(null);
  const [streakCount, setStreakCount] = useState(0);
  const [followCount, setFollowCount] = useState<number | null>(null);

  // Personalization mode — "for_you" or "all". Loaded from AsyncStorage on mount.
  const [personalizationMode, setPersonalizationMode] = useState<PersonalizationMode>("all");
  const personalizationModeRef = useRef<PersonalizationMode>("all");

  // Tier upgrade nudge — shown when user is eligible for next tier
  const [tierUpgradeNextTier, setTierUpgradeNextTier] = useState<AppAnalystTier | null>(null);
  const [tierNudgeDismissed, setTierNudgeDismissed] = useState(true); // default hidden until loaded

  const [items, setItems] = useState<ApiNewsFeedItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<CategoryKey>(() => {
    const validKeys = FEED_CATEGORIES.map((c) => c.key);
    if (categoryParam && validKeys.includes(categoryParam as CategoryKey)) {
      return categoryParam as CategoryKey;
    }
    return "ALL";
  });

  // Sync `category` state whenever the URL param changes (e.g., navigating from
  // the Finance tab via "Read Finance News"). useState initializer only fires on
  // first render, so without this effect the param is ignored on subsequent
  // navigations.
  useEffect(() => {
    const validKeys = FEED_CATEGORIES.map((c) => c.key);
    if (categoryParam && validKeys.includes(categoryParam as CategoryKey)) {
      setCategory(categoryParam as CategoryKey);
    }
  }, [categoryParam]);

  // Skeleton loading: shown only on the FIRST load (items empty) after a 150ms
  // delay so fast API responses never flash the skeleton.
  const [showSkeleton, setShowSkeleton] = useState(false);
  // Track whether the very first load has ever produced items (prevents skeleton
  // from reappearing on pull-to-refresh or category switches once we've had data).
  const hasEverLoadedRef = useRef(false);

  // Load persisted personalization mode from AsyncStorage on mount
  useEffect(() => {
    void AsyncStorage.getItem(FEED_PERSONALIZATION_KEY).then((stored) => {
      if (stored === "for_you" || stored === "all") {
        personalizationModeRef.current = stored;
        setPersonalizationMode(stored);
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch streak count + follow count + tier progress once when authenticated
  useEffect(() => {
    if (authStatus !== "authenticated" || !session) return;
    void mobileApi.getMyProfile().then(async (p) => {
      setStreakCount(p.user.streak ?? 0);
      const following = (p.user as { followingCount?: number }).followingCount ?? 0;
      setFollowCount(following);
      // Default to "for_you" if user has follows and hasn't explicitly chosen a mode
      void AsyncStorage.getItem(FEED_PERSONALIZATION_KEY).then((stored) => {
        if (!stored && following > 0) {
          personalizationModeRef.current = "for_you";
          setPersonalizationMode("for_you");
        }
      }).catch(() => {});

      // Check tier upgrade nudge
      const tierProgress = (p.user as { tierProgress?: { isEligible?: boolean; nextTier?: AppAnalystTier | null } }).tierProgress;
      if (tierProgress?.isEligible && tierProgress.nextTier) {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const dismissKey = `tier_upgrade_nudge_dismissed_${today}`;
        const dismissed = await AsyncStorage.getItem(dismissKey).catch(() => "true");
        if (dismissed !== "true") {
          setTierUpgradeNextTier(tierProgress.nextTier);
          setTierNudgeDismissed(false);
        }
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  // Skeleton 150ms delay: only fires when loading is true and no items have
  // arrived yet AND we have never successfully loaded data before.
  // Cleared as soon as loading ends (data arrived or error) or items appear.
  useEffect(() => {
    if (!loading || items.length > 0 || hasEverLoadedRef.current) {
      setShowSkeleton(false);
      return;
    }
    const timer = setTimeout(() => {
      // Re-check conditions inside the timeout — may have resolved in 150ms
      if (!hasEverLoadedRef.current) {
        setShowSkeleton(true);
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      setShowSkeleton(false);
    };
  }, [loading, items.length]);

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
  // Initialise from the same source the state initialiser used so the very first
  // loadPage call honours the URL param (otherwise it always fetches "ALL").
  const categoryRef = useRef<CategoryKey>(category);

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
        personalized: personalizationModeRef.current === "for_you" ? true : undefined,
      };

      if (cat !== "ALL") {
        query.category = cat as AppMarketCategory;
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
      // Mark that we have successfully loaded at least once so the skeleton
      // never reappears after the first data arrives (pull-to-refresh, etc.)
      hasEverLoadedRef.current = true;
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

  // When the category state changes (URL param, chip tap, etc.), reset paging
  // and refetch with the new filter. Skipped on first mount because the loadPage
  // mount effect above already issues the initial fetch.
  const isFirstCategoryRender = useRef(true);
  useEffect(() => {
    if (isFirstCategoryRender.current) {
      isFirstCategoryRender.current = false;
      return;
    }
    if (categoryRef.current === category) return;
    categoryRef.current = category;
    setItems([]);
    cursorRef.current = null;
    hasMoreRef.current = true;
    inFlightRef.current = false;
    void loadPage("replace");
  }, [category, loadPage]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    cursorRef.current = null;
    hasMoreRef.current = true;
    await mobileApi.refreshNewsFeed().catch(() => {});
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

  // Silently reload feed every 3 minutes while tab is focused — picks up AI-generated polls.
  // Also re-applies the category URL param on focus so navigation from the Finance tab
  // ("Read Finance News") flips the filter even when this tab is already mounted.
  useFocusEffect(
    useCallback(() => {
      const validKeys = FEED_CATEGORIES.map((c) => c.key);
      if (
        categoryParam &&
        validKeys.includes(categoryParam as CategoryKey) &&
        categoryRef.current !== categoryParam
      ) {
        setCategory(categoryParam as CategoryKey);
      }
      const interval = setInterval(() => {
        if (!inFlightRef.current) {
          void loadPage("replace");
        }
      }, 3 * 60 * 1000);
      return () => clearInterval(interval);
    }, [loadPage, categoryParam])
  );

  const onEndReached = useCallback(() => {
    if (hasMoreRef.current && !inFlightRef.current) {
      void loadPage("append");
    }
  }, [loadPage]);

  function handleCategoryChange(cat: CategoryKey) {
    if (cat === "SPORTS") {
      router.push("/(tabs)/sports" as Parameters<typeof router.push>[0]);
      return;
    }
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

  function handlePersonalizationToggle(mode: PersonalizationMode) {
    if (mode === personalizationModeRef.current) return;
    personalizationModeRef.current = mode;
    setPersonalizationMode(mode);
    void AsyncStorage.setItem(FEED_PERSONALIZATION_KEY, mode).catch(() => {});
    // Reset paging and reload with the new mode
    setItems([]);
    cursorRef.current = null;
    hasMoreRef.current = true;
    inFlightRef.current = false;
    void loadPage("replace");
  }

  return (
    <View style={styles.screen}>
      <GradientHeader title="Feed" />

      {/* For You / All toggle pills */}
      {authStatus === "authenticated" && (
        <View style={styles.personalizationRow}>
          <Pressable
            style={[
              styles.personalizationPill,
              personalizationMode === "for_you" && styles.personalizationPillActive,
            ]}
            onPress={() => handlePersonalizationToggle("for_you")}
            accessibilityRole="button"
            accessibilityLabel="For You feed"
          >
            <Text
              style={[
                styles.personalizationPillText,
                personalizationMode === "for_you" && styles.personalizationPillTextActive,
              ]}
            >
              For You
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.personalizationPill,
              personalizationMode === "all" && styles.personalizationPillActive,
            ]}
            onPress={() => handlePersonalizationToggle("all")}
            accessibilityRole="button"
            accessibilityLabel="All feed"
          >
            <Text
              style={[
                styles.personalizationPillText,
                personalizationMode === "all" && styles.personalizationPillTextActive,
              ]}
            >
              All
            </Text>
          </Pressable>
        </View>
      )}

      {/* Category filter bar — sticky above the feed cards.
          StreakBadge is appended at the trailing end of the same scroll row. */}
      <View style={[styles.categoryBar, { height: CATEGORY_BAR_HEIGHT }]}>
        <CategoryFilterBar
          selected={category}
          onSelect={handleCategoryChange}
          categories={FEED_CATEGORIES}
          trailingNode={
            <StreakBadge
              streak={streakCount}
              onPress={() => router.push("/(tabs)/profile")}
            />
          }
        />
      </View>

      <FlatList
        ref={listRef}
        data={feedItems}
        keyExtractor={(item) => item._key}
        ListHeaderComponent={
          // Scrollable header — tier nudge and follow nudge scroll off with the
          // feed. snapToInterval excludes ListHeaderComponent from snap calculations
          // automatically, so news cards still snap cleanly.
          <>
            {/* Tier upgrade nudge — one-line dismissable banner for eligible users */}
            {authStatus === "authenticated" && !tierNudgeDismissed && tierUpgradeNextTier !== null && (
              <View style={styles.tierNudgeBanner}>
                <Text style={styles.tierNudgeText} numberOfLines={1}>
                  {`You're one call away from ${ANALYST_TIER_LABELS[tierUpgradeNextTier]} tier — make it count.`}
                </Text>
                <Pressable
                  hitSlop={8}
                  onPress={async () => {
                    const today = new Date().toISOString().slice(0, 10);
                    const dismissKey = `tier_upgrade_nudge_dismissed_${today}`;
                    await AsyncStorage.setItem(dismissKey, "true").catch(() => {});
                    setTierNudgeDismissed(true);
                  }}
                  accessibilityLabel="Dismiss tier nudge"
                >
                  <Ionicons name="close" size={14} color={colors.textMuted} />
                </Pressable>
              </View>
            )}

            {/* Nudge row: shown in "For You" mode when user has 0 follows */}
            {personalizationMode === "for_you" && followCount === 0 && (
              <Pressable
                style={styles.followNudgeRow}
                onPress={() => router.push("/expert-leaderboard")}
                accessibilityRole="button"
                accessibilityLabel="Browse the expert leaderboard to find analysts to follow"
              >
                <Text style={styles.followNudgeText}>
                  Follow analysts to personalize your feed
                </Text>
                <Text style={styles.followNudgeLink}>Browse Leaderboard</Text>
              </Pressable>
            )}
          </>
        }
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
          showSkeleton ? (
            // Skeleton cards — only shown on first load (items empty) after 150ms delay
            <View style={{ flex: 1 }}>
              <SkeletonFeedCard viewportHeight={cardHeight} />
              <SkeletonFeedCard viewportHeight={cardHeight} />
              <SkeletonFeedCard viewportHeight={cardHeight} />
            </View>
          ) : loading ? (
            // Brief spinner before skeleton threshold is reached (sub-150ms)
            <View style={styles.centerState}>
              <ActivityIndicator size="large" color={colors.accent} />
            </View>
          ) : error ? (
            <View style={styles.centerState}>
              <Text style={styles.stateTitle}>Couldn't load the feed</Text>
              <Text style={styles.stateText}>{error}</Text>
              <Pressable onPress={() => void loadPage("replace")} style={styles.retry}>
                <Text style={styles.retryLabel}>Retry</Text>
              </Pressable>
            </View>
          ) : category !== "ALL" ? (
            // Category-filtered empty state
            <View style={styles.centerState}>
              <Text style={styles.stateTitle}>
                {`No stories in ${FEED_CATEGORIES.find((c) => c.key === category)?.label ?? category}`}
              </Text>
              <Text style={styles.stateText}>
                No recent stories in this category.
              </Text>
              <Pressable
                onPress={() => handleCategoryChange("ALL")}
                style={styles.retry}
                accessibilityRole="button"
                accessibilityLabel="Show all categories"
              >
                <Text style={styles.retryLabel}>Show All</Text>
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
              onVoted={() => {
                // Silently refresh the feed so insight cards reflect updated vote counts
                if (!inFlightRef.current) {
                  cursorRef.current = null;
                  hasMoreRef.current = true;
                  void loadPage("replace");
                }
              }}
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

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.colors.background },

  // For You / All toggle
  personalizationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: t.colors.surface,
  },
  personalizationPill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.background,
  },
  personalizationPillActive: {
    backgroundColor: t.colors.accent,
    borderColor: t.colors.accent,
  },
  personalizationPillText: {
    fontSize: 13,
    fontWeight: "600",
    color: t.colors.textMuted,
  },
  personalizationPillTextActive: {
    color: "#fff",
  },

  // Follow nudge row
  followNudgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: "#EFF6FF",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  followNudgeText: {
    flex: 1,
    fontSize: 13,
    color: "#1D4ED8",
  },
  followNudgeLink: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1D4ED8",
    marginLeft: spacing.sm,
  },

  // Tier upgrade nudge banner
  tierNudgeBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: "#F5F3FF",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#DDD6FE",
    gap: spacing.sm,
  },
  tierNudgeText: {
    flex: 1,
    fontSize: 12,
    color: t.colors.accent,
    fontWeight: "600",
  },

  // Category bar — wraps the shared CategoryFilterBar
  categoryBar: {
    backgroundColor: t.colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.border,
    justifyContent: "center",
  },

  // List states
  emptyContent: { flexGrow: 1 },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  stateTitle: { fontSize: 24, fontWeight: "800", color: t.colors.text, letterSpacing: -0.5 },
  stateText: {
    marginTop: spacing.md,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    color: t.colors.textMuted,
  },
  footer: { paddingVertical: spacing.lg },
  retry: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: t.colors.accent,
  },
  retryLabel: { color: t.colors.surface, fontWeight: "700", fontSize: 14 },

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
    color: t.colors.textMuted,
    backgroundColor: t.colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: 7,
    borderRadius: radius.pill,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: t.colors.border,
  },
});
