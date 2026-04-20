import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { ApiMarketDetail } from "@predict-future/types";
import { formatPercent, formatPoints, formatRelativeTime } from "@predict-future/utils";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";

function normalizeParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export default function MarketDetailScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = normalizeParam(params.id);

  const fetcher = useCallback(
    () => mobileApi.getMarketById(id as string),
    [id]
  );

  const { data, status, error, refetch } = useApiQuery<ApiMarketDetail>(fetcher, [id], {
    enabled: Boolean(id),
    errorFallback: "Unable to load market."
  });

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Market" }} />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        {!id ? (
          <Text style={styles.error}>Missing market id.</Text>
        ) : status === "loading" || status === "idle" ? (
          <ActivityIndicator color={colors.accent} />
        ) : status === "error" ? (
          <View style={styles.card}>
            <Text style={styles.title}>Couldn't load market</Text>
            <Text style={styles.subtitle}>{error}</Text>
            <Pressable onPress={refetch} style={styles.retry}>
              <Text style={styles.retryLabel}>Retry</Text>
            </Pressable>
          </View>
        ) : data?.market ? (
          <MarketBody detail={data} />
        ) : (
          <Text style={styles.error}>Market not found.</Text>
        )}
      </ScrollView>
    </>
  );
}

function MarketBody({ detail }: { detail: ApiMarketDetail }) {
  const market = detail.market;
  const yesPool = market.yesPool ?? 0;
  const noPool = market.noPool ?? 0;
  const totalPool = yesPool + noPool;
  const yesProbability = totalPool > 0 ? yesPool / totalPool : 0.5;

  return (
    <View style={styles.card}>
      <Text style={styles.status}>{market.status}</Text>
      <Text style={styles.title}>{market.title}</Text>
      {market.description ? <Text style={styles.subtitle}>{market.description}</Text> : null}

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>YES probability</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.max(8, yesProbability * 100)}%` }]} />
        </View>
        <View style={styles.metricsRow}>
          <Text style={styles.metric}>YES {formatPercent(yesProbability)}</Text>
          <Text style={styles.metric}>Volume {formatPoints(market.totalVolume ?? totalPool)} pts</Text>
        </View>
      </View>

      {market.closeAt ? (
        <Text style={styles.metric}>Closes {formatRelativeTime(market.closeAt)}</Text>
      ) : null}
      {market.resolveAt ? (
        <Text style={styles.metric}>Resolves {formatRelativeTime(market.resolveAt)}</Text>
      ) : null}
      {market.creator?.username ? (
        <Text style={styles.metric}>Host @{market.creator.username}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background
  },
  content: {
    padding: spacing.xl
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl
  },
  status: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.accent
  },
  title: {
    marginTop: spacing.sm,
    fontSize: 24,
    fontWeight: "700",
    color: colors.text
  },
  subtitle: {
    marginTop: spacing.sm,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted
  },
  section: {
    marginTop: spacing.xl
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted
  },
  progressTrack: {
    marginTop: spacing.sm,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: "#DCE3F2",
    overflow: "hidden"
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.accent
  },
  metricsRow: {
    marginTop: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between"
  },
  metric: {
    marginTop: spacing.sm,
    fontSize: 14,
    color: colors.textMuted
  },
  error: {
    color: colors.danger
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
