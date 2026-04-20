import { useCallback } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import type { ApiMarketSummary } from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { MarketSummaryCard } from "@/components/market-summary-card";
import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";

export default function MarketsScreen() {
  const fetcher = useCallback(() => mobileApi.getPublicMarkets(), []);
  const { data, status, error, loading, refetch } = useApiQuery<{ markets: ApiMarketSummary[] }>(
    fetcher,
    [],
    { errorFallback: "Unable to load markets." }
  );

  const markets = data?.markets ?? [];

  if (status === "loading" && markets.length === 0) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.kicker}>Public markets</Text>
        <Text style={styles.title}>Ranked discovery from the shared backend</Text>
        <Text style={styles.subtitle}>
          This tab consumes the API workspace and keeps market ordering server-controlled.
        </Text>
      </View>

      <FlatList
        data={markets}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={colors.accent} />}
        renderItem={({ item }) => <MarketSummaryCard item={item} />}
        ListEmptyComponent={
          status === "error" ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Couldn't load markets</Text>
              <Text style={styles.emptyText}>{error}</Text>
              <Pressable onPress={refetch} style={styles.retry}>
                <Text style={styles.retryLabel}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No public markets yet</Text>
              <Text style={styles.emptyText}>Check back once hosts begin publishing.</Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg
  },
  kicker: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.accent
  },
  title: {
    marginTop: spacing.sm,
    fontSize: 28,
    fontWeight: "700",
    color: colors.text
  },
  subtitle: {
    marginTop: spacing.sm,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted
  },
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing["2xl"],
    gap: spacing.lg,
    flexGrow: 1
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background
  },
  emptyCard: {
    marginTop: spacing.lg,
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text
  },
  emptyText: {
    marginTop: spacing.sm,
    fontSize: 14,
    lineHeight: 22,
    color: colors.textMuted
  },
  retry: {
    marginTop: spacing.lg,
    alignSelf: "flex-start",
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
