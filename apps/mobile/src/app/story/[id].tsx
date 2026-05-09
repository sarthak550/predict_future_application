import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ApiStory } from "@predict-future/types";
import { formatRelativeTime } from "@predict-future/utils";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { mobileApi } from "@/lib/api";
import { ExpertOpinionCard } from "@/components/expert-opinion-card";

// ── Skeleton placeholder ──────────────────────────────────────────────────────

function SkeletonBlock({ width, height, style }: { width: string | number; height: number; style?: object }) {
  return (
    <View
      style={[
        { width, height, backgroundColor: "#E5E7EB", borderRadius: 6 },
        style,
      ]}
    />
  );
}

function StorySkeleton() {
  return (
    <View style={styles.container}>
      <View style={{ height: 220, backgroundColor: "#E5E7EB" }} />
      <View style={styles.contentPad}>
        <SkeletonBlock width={80} height={18} style={{ marginBottom: 12 }} />
        <SkeletonBlock width="90%" height={28} style={{ marginBottom: 8 }} />
        <SkeletonBlock width="70%" height={28} style={{ marginBottom: 20 }} />
        <SkeletonBlock width="100%" height={14} style={{ marginBottom: 6 }} />
        <SkeletonBlock width="100%" height={14} style={{ marginBottom: 6 }} />
        <SkeletonBlock width="80%" height={14} style={{ marginBottom: 6 }} />
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function StoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [story, setStory] = useState<ApiStory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const data = await mobileApi.getStory(id);
        setStory(data.story);
      } catch (err: unknown) {
        const isNotFound =
          err instanceof Error &&
          "status" in (err as { status?: number }) &&
          (err as { status?: number }).status === 404;
        setError(isNotFound ? "Story not found." : "Failed to load story. Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            title: "Story",
            headerBackTitle: "Back",
          }}
        />
        <StorySkeleton />
      </>
    );
  }

  if (error || !story) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            title: "Story",
            headerBackTitle: "Back",
          }}
        />
        <View style={styles.errorContainer}>
          <Text style={styles.errorEmoji}>📰</Text>
          <Text style={styles.errorTitle}>{error ?? "Story not found."}</Text>
          <Text style={styles.errorSubtitle}>
            This story may have been removed or is not available.
          </Text>
        </View>
      </>
    );
  }

  const hasExpertOpinions = story.expertOpinions.length > 0;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: story.sourceName,
          headerBackTitle: "Back",
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero image */}
        {story.imageUrl ? (
          <Image
            source={{ uri: story.imageUrl }}
            style={styles.heroImage}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.heroPlaceholder}>
            <Text style={styles.placeholderEmoji}>📰</Text>
          </View>
        )}

        <View style={styles.contentPad}>
          {/* Category chip */}
          <Text style={styles.categoryChip}>{story.category}</Text>

          {/* Headline */}
          <Text style={styles.headline}>{story.headline}</Text>

          {/* Meta row: source + published date */}
          <Pressable
            style={styles.metaRow}
            onPress={() => void Linking.openURL(story.sourceUrl)}
          >
            <Text style={styles.sourceName}>{story.sourceName}</Text>
            <Text style={styles.readMore}>Read original →</Text>
            <View style={{ flex: 1 }} />
            <Text style={styles.publishedAt}>
              {formatRelativeTime(story.publishedAt)}
            </Text>
          </Pressable>

          {/* Summary / body */}
          <Text style={styles.summary}>{story.summary}</Text>
        </View>

        {/* Expert Takes section */}
        {hasExpertOpinions && (
          <View style={styles.expertSection}>
            <View style={styles.expertSectionHeader}>
              <Text style={styles.expertSectionTitle}>Expert Takes</Text>
              <Text style={styles.expertSectionCount}>
                {story.expertOpinions.length}{" "}
                {story.expertOpinions.length === 1 ? "take" : "takes"}
              </Text>
            </View>

            {story.expertOpinions.map((opinion) => (
              <ExpertOpinionCard
                key={opinion.id}
                opinion={opinion}
                storyHeadline={story.headline}
                storyId={story.id}
              />
            ))}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  contentPad: {
    padding: spacing.xl,
  },
  heroImage: {
    width: "100%",
    height: 240,
  },
  heroPlaceholder: {
    width: "100%",
    height: 160,
    backgroundColor: "#E0E7FF",
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderEmoji: {
    fontSize: 52,
  },
  categoryChip: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.accent,
    backgroundColor: "#EFF6FF",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
    overflow: "hidden",
    marginBottom: spacing.md,
  },
  headline: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: "800",
    color: colors.text,
    marginBottom: spacing.md,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border ?? "#E5E7EB",
  },
  sourceName: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.text,
  },
  readMore: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.accent,
  },
  publishedAt: {
    fontSize: 12,
    color: colors.textMuted,
  },
  summary: {
    fontSize: 16,
    lineHeight: 26,
    color: colors.text,
  },
  expertSection: {
    marginTop: spacing.lg,
  },
  expertSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.md,
  },
  expertSectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
  },
  expertSectionCount: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  errorEmoji: {
    fontSize: 48,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
  },
  errorSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 22,
  },
});
