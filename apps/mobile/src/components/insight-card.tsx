import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

import type { ApiNewsFeedItem } from "@predict-future/types";
import { formatPercent } from "@predict-future/utils";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

type Props = {
  item: ApiNewsFeedItem;
  viewportHeight: number;
};

const CATEGORY_BG: Record<string, { bg: string; accent: string; text: string }> = {
  TECH:          { bg: "#1E1B4B", accent: "#818CF8", text: "#EEF2FF" },
  BUSINESS:      { bg: "#0C1A2E", accent: "#38BDF8", text: "#E0F2FE" },
  SPORTS:        { bg: "#1C0A0A", accent: "#F87171", text: "#FEF2F2" },
  ENTERTAINMENT: { bg: "#1C1208", accent: "#FBBF24", text: "#FFFBEB" },
  WEATHER:       { bg: "#041D30", accent: "#67E8F9", text: "#ECFEFF" },
  GENERAL:       { bg: "#0F172A", accent: "#94A3B8", text: "#F1F5F9" },
  PRODUCT:       { bg: "#052E16", accent: "#4ADE80", text: "#F0FDF4" },
  COMPANY:       { bg: "#1E1A4B", accent: "#A78BFA", text: "#F5F3FF" },
};

export function InsightCard({ item, viewportHeight }: Props) {
  const market = item.market;
  const poll = item.poll;

  const theme = CATEGORY_BG[item.category] ?? CATEGORY_BG.GENERAL;

  const totalVotes = poll?.totalVotes ?? 0;
  const yesCount = poll?.yesCount ?? 0;
  const yesPct = totalVotes > 0 ? yesCount / totalVotes : 0.5;
  const noPct = 1 - yesPct;

  // Animate the bar in on mount
  const barAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(barAnim, {
      toValue: 1,
      duration: 800,
      delay: 200,
      useNativeDriver: false,
    }).start();
  }, []);

  const yesBarWidth = barAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", `${Math.max(4, Math.min(96, yesPct * 100))}%`],
  });

  if (!market) return null;

  const dominantSide = yesPct >= 0.5 ? "YES" : "NO";
  const dominantPct = Math.round(Math.max(yesPct, noPct) * 100);

  return (
    <View style={[styles.frame, { height: viewportHeight }]}>
      <View style={[styles.card, { backgroundColor: theme.bg }]}>
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.badge, { borderColor: theme.accent }]}>
            <Text style={[styles.badgeText, { color: theme.accent }]}>
              💡 CROWD CONSENSUS
            </Text>
          </View>
          <Text style={[styles.category, { color: theme.accent }]}>
            {item.category}
          </Text>
        </View>

        {/* Source story */}
        <Text style={[styles.sourceLine, { color: theme.accent + "99" }]} numberOfLines={1}>
          Re: {item.headline}
        </Text>

        {/* Market question */}
        <Text style={[styles.question, { color: theme.text }]} numberOfLines={3}>
          {market.title}
        </Text>

        {/* Big number */}
        <View style={styles.bigNumberRow}>
          <Text style={[styles.bigNumber, { color: theme.accent }]}>
            {dominantPct}%
          </Text>
          <View>
            <Text style={[styles.bigNumberLabel, { color: theme.text }]}>
              say {dominantSide}
            </Text>
            {totalVotes > 0 && (
              <Text style={[styles.voteCount, { color: theme.accent + "99" }]}>
                {totalVotes.toLocaleString()} predictions
              </Text>
            )}
          </View>
        </View>

        {/* Animated bar */}
        <View style={[styles.barTrack, { backgroundColor: theme.accent + "22" }]}>
          <Animated.View
            style={[styles.barYes, { width: yesBarWidth, backgroundColor: "#059669" }]}
          />
        </View>
        <View style={styles.barLabels}>
          <Text style={styles.barLabelYes}>YES {formatPercent(yesPct)}</Text>
          <Text style={styles.barLabelNo}>NO {formatPercent(noPct)}</Text>
        </View>

        {/* Footer */}
        <Text style={[styles.footer, { color: theme.accent + "66" }]}>
          Swipe to continue reading
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  card: {
    flex: 1,
    borderRadius: radius.lg,
    padding: spacing.xl,
    justifyContent: "center",
    gap: spacing.lg,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  category: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  sourceLine: {
    fontSize: 12,
    fontStyle: "italic",
  },
  question: {
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 30,
  },
  bigNumberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  bigNumber: {
    fontSize: 64,
    fontWeight: "900",
    lineHeight: 70,
  },
  bigNumberLabel: {
    fontSize: 18,
    fontWeight: "700",
  },
  voteCount: {
    fontSize: 13,
    marginTop: 4,
  },
  barTrack: {
    height: 12,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  barYes: {
    height: "100%",
    borderRadius: radius.pill,
  },
  barLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -spacing.sm,
  },
  barLabelYes: { fontSize: 12, fontWeight: "700", color: "#059669" },
  barLabelNo: { fontSize: 12, fontWeight: "700", color: "#F87171" },
  footer: {
    textAlign: "center",
    fontSize: 12,
  },
});
