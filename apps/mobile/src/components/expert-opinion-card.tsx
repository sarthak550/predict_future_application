import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ApiExpertOpinionItem } from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { ExpertOpinionRow } from "@/components/news-feed-card";

/**
 * Expert-opinion-first card for the Finance tab.
 *
 * Hero: the expert's take + dual polls. The story is shown as small context below.
 * This is distinct from NewsFeedCard which is news-first (used in the Feed tab).
 */
type Props = {
  opinion: ApiExpertOpinionItem;
  storyHeadline?: string;
  storyId?: string;
};

function getSourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 30);
  }
}

export function ExpertOpinionCard({ opinion, storyHeadline, storyId }: Props) {
  const router = useRouter();
  const sourceDomain = getSourceDomain(opinion.sourceUrl);

  return (
    <View style={styles.card}>
      {/* Expert opinion content */}
      <ExpertOpinionRow opinion={opinion} />

      {/* Related story row — at the bottom, restyled */}
      {storyHeadline ? (
        <Pressable
          onPress={() =>
            storyId ? router.push(`/story/${storyId}` as Parameters<typeof router.push>[0]) : undefined
          }
          style={styles.storyContext}
        >
          <Text style={styles.storyRow} numberOfLines={1}>
            {"↗ "}
            <Text style={styles.storySource}>{sourceDomain}</Text>
            <Text style={styles.storySeparator}>{" — "}</Text>
            <Text style={styles.storyHeadline}>{storyHeadline}</Text>
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  storyContext: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E5E7EB",
  },
  storyRow: {
    fontSize: 12,
    color: colors.textMuted ?? "#6b7280",
    lineHeight: 16,
  },
  storySource: {
    fontWeight: "600",
    color: colors.textMuted ?? "#6b7280",
  },
  storySeparator: {
    color: colors.textMuted ?? "#6b7280",
  },
  storyHeadline: {
    color: colors.textMuted ?? "#6b7280",
  },
});
