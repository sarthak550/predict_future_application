import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import type { ApiNewsFeedItem } from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { NewsFeedCard } from "@/components/news-feed-card";
import { mobileApi } from "@/lib/api";

const PAGE_SIZE = 10;
const TAB_BAR_HEIGHT = 72;

export default function FeedScreen() {
  const { height } = useWindowDimensions();
  const [items, setItems] = useState<ApiNewsFeedItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs so loadPage can be stable — avoids re-creating the callback on every state change,
  // which would otherwise retrigger the mount effect or thrash onEndReached.
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
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
      const response = await mobileApi.getNews({
        limit: PAGE_SIZE,
        cursor: mode === "append" ? cursorRef.current : null
      });
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
    void loadPage("replace");
  }, [loadPage]);

  const onEndReached = useCallback(() => {
    if (hasMoreRef.current && !inFlightRef.current) {
      void loadPage("append");
    }
  }, [loadPage]);

  const cardHeight = useMemo(() => Math.max(520, height - TAB_BAR_HEIGHT), [height]);

  return (
    <View style={styles.screen}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        pagingEnabled
        snapToAlignment="start"
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={items.length === 0 ? styles.emptyContent : undefined}
        onEndReachedThreshold={0.65}
        onEndReached={onEndReached}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
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
              <Text style={styles.stateTitle}>No news yet</Text>
              <Text style={styles.stateText}>The backend feed is still warming up.</Text>
            </View>
          )
        }
        ListFooterComponent={
          hasMore && items.length > 0 ? (
            <View style={styles.footer}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : null
        }
        renderItem={({ item }) => <NewsFeedCard item={item} viewportHeight={cardHeight} />}
      />
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
  screen: {
    flex: 1,
    backgroundColor: colors.background
  },
  emptyContent: {
    flexGrow: 1
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32
  },
  stateTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.text
  },
  stateText: {
    marginTop: spacing.md,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    color: colors.textMuted
  },
  footer: {
    paddingVertical: spacing.lg
  },
  retry: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accent
  },
  retryLabel: {
    color: colors.surface,
    fontWeight: "700",
    fontSize: 14
  }
});
