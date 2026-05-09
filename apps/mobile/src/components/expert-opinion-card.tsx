import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ApiExpertOpinionItem } from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { ExpertOpinionRow } from "@/components/news-feed-card";

/**
 * Finance tab article card — article context at the top, all analyst takes below.
 *
 * One card per story, with all opinions stacked inside (not one card per opinion).
 */
type Props = {
  opinions: ApiExpertOpinionItem[];
  storyHeadline: string;
  storySourceName: string;
  storyId: string;
};

export function ExpertOpinionCard({ opinions, storyHeadline, storySourceName, storyId }: Props) {
  const router = useRouter();
  if (opinions.length === 0) return null;

  return (
    <View style={styles.card}>
      {/* Article header */}
      <Pressable
        onPress={() => router.push(`/story/${storyId}` as Parameters<typeof router.push>[0])}
        style={styles.articleHeader}
      >
        <Text style={styles.sourceLabel}>{storySourceName}</Text>
        <Text style={styles.headline} numberOfLines={3}>{storyHeadline}</Text>
      </Pressable>

      {/* All analyst takes — separated by dividers */}
      {opinions.map((opinion, idx) => (
        <View key={opinion.id}>
          <View style={styles.divider} />
          <ExpertOpinionRow opinion={opinion} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    overflow: "hidden",
  },
  articleHeader: {
    padding: spacing.md,
    backgroundColor: "#F9FAFB",
  },
  sourceLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textMuted ?? "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  headline: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text ?? "#111827",
    lineHeight: 21,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#E5E7EB",
    marginHorizontal: spacing.md,
  },
});
