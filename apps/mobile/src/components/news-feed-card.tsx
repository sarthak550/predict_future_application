import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import type { ApiNewsFeedItem } from "@predict-future/types";
import { formatPercent, formatPoints, formatRelativeTime } from "@predict-future/utils";
import { colors, radius, shadows, spacing } from "@predict-future/ui-tokens";

type Props = {
  item: ApiNewsFeedItem;
  viewportHeight: number;
};

export function NewsFeedCard({ item, viewportHeight }: Props) {
  const market = item.market;
  const totalPool = (market?.yesPool ?? 0) + (market?.noPool ?? 0);
  const yesProbability = totalPool > 0 ? (market?.yesPool ?? 0) / totalPool : 0.5;

  return (
    <View style={[styles.frame, { height: viewportHeight }]}>
      <View style={styles.card}>
        <Text style={styles.category}>{item.category}</Text>
        <Text style={styles.headline}>{item.headline}</Text>
        <Text style={styles.summary}>{item.summary}</Text>

        <View style={styles.metaRow}>
          <Text style={styles.source}>{item.sourceName}</Text>
          <Text style={styles.published}>{formatRelativeTime(item.publishedAt)}</Text>
        </View>

        {market ? (
          <View style={styles.marketBlock}>
            <Text style={styles.marketTitle}>{market.title}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.max(8, yesProbability * 100)}%` }]} />
            </View>
            <View style={styles.poolRow}>
              <Text style={styles.poolLabel}>YES {formatPercent(yesProbability)}</Text>
              <Text style={styles.poolLabel}>{formatPoints(market.totalVolume ?? totalPool)} pts</Text>
            </View>
            <Link href={`/market/${market.id}`} style={styles.link}>
              Open market
            </Link>
          </View>
        ) : (
          <View style={styles.marketBlock}>
            <Text style={styles.marketTitle}>Prediction attaching</Text>
            <Text style={styles.summary}>This story is live in the feed while prediction linking catches up.</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    justifyContent: "center",
    backgroundColor: colors.background
  },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    justifyContent: "center",
    ...shadows.card
  },
  category: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.accent
  },
  headline: {
    marginTop: spacing.sm,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "700",
    color: colors.text
  },
  summary: {
    marginTop: spacing.md,
    fontSize: 16,
    lineHeight: 24,
    color: colors.textMuted
  },
  metaRow: {
    marginTop: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  source: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text
  },
  published: {
    fontSize: 13,
    color: colors.textMuted
  },
  marketBlock: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted
  },
  marketTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text
  },
  progressTrack: {
    marginTop: spacing.lg,
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
  poolRow: {
    marginTop: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between"
  },
  poolLabel: {
    fontSize: 13,
    color: colors.textMuted
  },
  link: {
    marginTop: spacing.lg,
    fontSize: 15,
    fontWeight: "700",
    color: colors.primary
  }
});
