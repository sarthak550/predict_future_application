import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import type { ApiMarketSummary } from "@predict-future/types";
import { formatPoints } from "@predict-future/utils";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

type Props = {
  item: ApiMarketSummary;
};

export function MarketSummaryCard({ item }: Props) {
  const trust = item.creator?.stats?.hostTrustScore;

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.status}>{item.status}</Text>
        {item.visibility ? <Text style={styles.visibility}>{item.visibility}</Text> : null}
      </View>
      <Text style={styles.title}>{item.title}</Text>
      {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
      <View style={styles.metrics}>
        <Text style={styles.metric}>Volume {formatPoints(item.totalVolume ?? 0)}</Text>
        {typeof trust === "number" ? <Text style={styles.metric}>Host trust {trust}</Text> : null}
      </View>
      <Link href={`/market/${item.id}`} style={styles.link}>
        View details
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm
  },
  status: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    color: colors.success
  },
  visibility: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    color: colors.textMuted
  },
  title: {
    marginTop: spacing.sm,
    fontSize: 20,
    fontWeight: "700",
    color: colors.text
  },
  description: {
    marginTop: spacing.sm,
    fontSize: 14,
    lineHeight: 22,
    color: colors.textMuted
  },
  metrics: {
    marginTop: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between"
  },
  metric: {
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
