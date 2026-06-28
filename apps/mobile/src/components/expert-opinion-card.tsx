import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ApiExpertOpinionItem } from "@predict-future/types";
import { radius, spacing } from "@predict-future/ui-tokens";
import { useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

import { ExpertOpinionRow } from "@/components/news-feed-card";
import { ExpertOpinionPostCard } from "@/components/expert-opinion-post-card";
import { USE_POST_CARD } from "@/lib/feature-flags";

/**
 * Expert-opinion-first card for the Finance tab and story detail page.
 *
 * When multiple opinions from the same analyst on the same article are passed,
 * the analyst byline is shown once and each take's quote+polls is stacked below.
 */
type Props = {
  opinions: ApiExpertOpinionItem[];
  storyHeadline?: string;
  storyId?: string;
  articlePublishedAt?: string;
  /** Set of followed expert IDs — drives Follow/Following pill visibility */
  followedExpertIds?: string[];
  /** Called when the user taps Follow/Following */
  onFollowToggle?: (expertId: string, currentlyFollowing: boolean) => void;
};

function getSourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 30);
  }
}

export function ExpertOpinionCard({ opinions, storyHeadline, storyId, articlePublishedAt, followedExpertIds, onFollowToggle }: Props) {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);

  if (opinions.length === 0) return null;

  // S34-T1: Feature-flagged swap to the redesigned post card.
  // Each opinion gets its own standalone card in the new design (no grouped rows).
  if (USE_POST_CARD) {
    return (
      <>
        {opinions.map((opinion) => (
          <ExpertOpinionPostCard
            key={opinion.id}
            opinion={opinion}
            articlePublishedAt={articlePublishedAt}
            isFollowed={followedExpertIds?.includes(opinion.expertId)}
            onFollowToggle={onFollowToggle}
          />
        ))}
      </>
    );
  }

  const sourceDomain = getSourceDomain(opinions[0].sourceUrl);

  return (
    <View style={styles.card}>
      {opinions.map((opinion, index) => (
        <View key={opinion.id}>
          {index > 0 && <View style={styles.takeDivider} />}
          <ExpertOpinionRow
            opinion={opinion}
            hideByline={index > 0}
            isFollowed={followedExpertIds?.includes(opinion.expertId)}
            onFollowToggle={onFollowToggle}
            articlePublishedAt={articlePublishedAt}
          />
        </View>
      ))}

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

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  takeDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: t.colors.border,
    marginVertical: spacing.md,
  },
  storyContext: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.border,
  },
  storyRow: {
    fontSize: 12,
    color: t.colors.textMuted,
    lineHeight: 16,
  },
  storySource: {
    fontWeight: "600",
    color: t.colors.textMuted,
  },
  storySeparator: {
    color: t.colors.textMuted,
  },
  storyHeadline: {
    color: t.colors.textMuted,
  },
});
