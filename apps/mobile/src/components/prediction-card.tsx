import { Feather } from "@expo/vector-icons";
import { Link } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import type { ApiNewsFeedItem } from "@predict-future/types";
import { formatRelativeTime } from "@predict-future/utils";
import { radius, spacing } from "@predict-future/ui-tokens";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

const CATEGORY_COLORS: Record<string, string> = {
  SPORTS: "#14b8a6",
  BUSINESS: "#f59e0b",
  TECH: "#0ea5e9",
  ENTERTAINMENT: "#a855f7",
  GENERAL: "#64748b",
  WEATHER: "#06b6d4",
  PRODUCT: "#f97316",
  COMPANY: "#6366f1",
};

type Props = {
  item: ApiNewsFeedItem;
};

export function PredictionCard({ item }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const market = item.market;
  const catColor = CATEGORY_COLORS[item.category] ?? colors.accent;

  // Compute percentages
  const yesCount = market?.yesCount ?? 0;
  const noCount = market?.noCount ?? 0;
  const totalVotes = market?.totalVotes ?? 0;
  const yesPct = totalVotes > 0 ? Math.round((yesCount / totalVotes) * 100) : 50;

  const marketId = market?.id;
  const href = marketId ? (`/market/${marketId}` as const) : null;

  const cardContent = (
    <View style={styles.card}>
      {/* Top row: category + time */}
      <View style={styles.topRow}>
        <View style={[styles.categoryBadge, { backgroundColor: catColor + "18" }]}>
          <Text style={[styles.categoryText, { color: catColor }]}>{item.category}</Text>
        </View>
        {item.isTrending && (
          <View style={styles.trendingBadge}>
            <Feather name="trending-up" size={10} color={colors.warning} />
            <Text style={styles.trendingText}>Trending</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <Text style={styles.timeText}>{formatRelativeTime(item.publishedAt)}</Text>
      </View>

      {/* News headline (small) */}
      <Text style={styles.newsHeadline} numberOfLines={1}>{item.headline}</Text>

      {/* Prediction question (prominent) */}
      {market ? (
        <Text style={styles.predictionTitle} numberOfLines={2}>{market.title}</Text>
      ) : (
        <Text style={styles.noPrediction}>No prediction available</Text>
      )}

      {/* Odds bar + percentages */}
      {market ? (
        <>
          <View style={styles.barTrack}>
            <View style={[styles.barYes, { width: `${Math.max(8, yesPct)}%` }]} />
          </View>
          <View style={styles.oddsRow}>
            <Text style={styles.yesLabel}>YES {yesPct}%</Text>
            <Text style={styles.noLabel}>NO {100 - yesPct}%</Text>
          </View>
        </>
      ) : null}

      {/* Source + image */}
      <View style={styles.bottomRow}>
        <View style={styles.sourceChip}>
          <Feather name="globe" size={10} color={colors.textMuted} />
          <Text style={styles.sourceName}>{item.sourceName}</Text>
        </View>
        {market ? (
          <Text style={styles.volumeText}>{totalVotes} {totalVotes === 1 ? "vote" : "votes"}</Text>
        ) : null}
      </View>

      {item.imageUrl ? (
        <Image source={{ uri: item.imageUrl }} style={styles.thumbnail} resizeMode="cover" />
      ) : null}
    </View>
  );

  if (href) {
    return (
      <Link href={href} asChild>
        <Pressable>{cardContent}</Pressable>
      </Link>
    );
  }

  return cardContent;
}

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  categoryBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  categoryText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  trendingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: "rgba(245,158,11,0.1)",
  },
  trendingText: {
    fontSize: 10,
    fontWeight: "700",
    color: t.colors.warning,
  },
  timeText: {
    fontSize: 11,
    color: t.colors.textMuted,
  },
  newsHeadline: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: t.colors.textMuted,
    fontWeight: "500",
  },
  predictionTitle: {
    marginTop: spacing.xs,
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 23,
    color: t.colors.text,
  },
  noPrediction: {
    marginTop: spacing.xs,
    fontSize: 14,
    color: t.colors.textMuted,
    fontStyle: "italic",
  },
  barTrack: {
    marginTop: spacing.md,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: t.colors.border,
    overflow: "hidden",
    flexDirection: "row",
  },
  barYes: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: t.colors.accent,
  },
  oddsRow: {
    marginTop: spacing.xs,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  yesLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#059669",
  },
  noLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#e11d48",
  },
  bottomRow: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sourceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  sourceName: {
    fontSize: 11,
    fontWeight: "600",
    color: t.colors.textMuted,
  },
  volumeText: {
    fontSize: 11,
    fontWeight: "600",
    color: t.colors.textMuted,
  },
  thumbnail: {
    marginTop: spacing.md,
    width: "100%",
    height: 120,
    borderRadius: radius.md,
    backgroundColor: t.colors.surfaceMuted,
  },
});
