import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
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
import { radius, spacing } from "@predict-future/ui-tokens";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

import { mobileApi } from "@/lib/api";
import { withRetry } from "@/lib/retry";
import { ExpertOpinionCard } from "@/components/expert-opinion-card";

// ── Skeleton placeholder ──────────────────────────────────────────────────────

function SkeletonBlock({ width, height, style }: { width: string | number; height: number; style?: object }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        { width, height, backgroundColor: colors.border, borderRadius: 6 },
        style,
      ]}
    />
  );
}

function StorySkeleton() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <View style={styles.container}>
      <View style={{ height: 220, backgroundColor: colors.border }} />
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

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.colors.background,
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
    backgroundColor: t.colors.surfaceMuted,
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
    color: t.colors.accent,
    backgroundColor: t.colors.surfaceMuted,
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
    color: t.colors.text,
    marginBottom: spacing.md,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.border,
  },
  sourceName: {
    fontSize: 13,
    fontWeight: "700",
    color: t.colors.text,
  },
  readMore: {
    fontSize: 13,
    fontWeight: "600",
    color: t.colors.accent,
  },
  publishedAt: {
    fontSize: 12,
    color: t.colors.textMuted,
  },
  summary: {
    fontSize: 16,
    lineHeight: 26,
    color: t.colors.text,
  },
  expertSection: {
    marginTop: spacing.lg,
  },
  // ── takesFirst condensed header ──
  condensedHeader: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  condensedHeadline: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "700",
    color: t.colors.text,
    marginBottom: spacing.sm,
  },
  condensedSourceLink: {
    fontSize: 13,
    color: t.colors.accent,
    fontWeight: "600",
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
    color: t.colors.text,
  },
  expertSectionCount: {
    fontSize: 12,
    fontWeight: "600",
    color: t.colors.textMuted,
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
    color: t.colors.text,
    textAlign: "center",
  },
  errorSubtitle: {
    fontSize: 14,
    color: t.colors.textMuted,
    textAlign: "center",
    lineHeight: 22,
  },
  retryButton: {
    marginTop: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: radius.md,
    backgroundColor: t.colors.accent,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
});

export default function StoryScreen() {
  const { id, takesFirst } = useLocalSearchParams<{ id: string; takesFirst?: string }>();
  const styles = useThemedStyles(makeStyles);
  const isTakesFirst = takesFirst === "1";
  const [story, setStory] = useState<ApiStory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      // No id param — don't sit on the skeleton forever.
      setError("Story not found.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Retry transient network blips so one flaky request doesn't strand the screen.
      const data = await withRetry(() => mobileApi.getStory(id));
      setStory(data.story);
    } catch (err: unknown) {
      const isNotFound =
        err instanceof Error &&
        "status" in (err as { status?: number }) &&
        (err as { status?: number }).status === 404;
      setError(isNotFound ? "Story not found." : "Failed to load safeStory. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

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
          {error && error !== "Story not found." ? (
            <Pressable
              onPress={() => void load()}
              style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      </>
    );
  }

  // story is guaranteed non-null by the guards above — capture as const for inner closures.
  const safeStory = story;
  const hasExpertOpinions = safeStory.expertOpinions.length > 0;

  // ── Shared helper: render the expert takes list ───────────────────────────

  function renderExpertTakes() {
    if (!hasExpertOpinions) return null;
    const grouped: { key: string; opinions: typeof safeStory.expertOpinions }[] = [];
    const seen = new Map<string, number>();
    for (const op of safeStory.expertOpinions) {
      const idx = seen.get(op.expertId);
      if (idx !== undefined) {
        grouped[idx].opinions.push(op);
      } else {
        seen.set(op.expertId, grouped.length);
        grouped.push({ key: op.expertId, opinions: [op] });
      }
    }
    return grouped.map(({ key, opinions }) => (
      <ExpertOpinionCard
        key={key}
        opinions={opinions}
        storyHeadline={safeStory.headline}
        storyId={safeStory.id}
        articlePublishedAt={safeStory.publishedAt}
      />
    ));
  }

  // ── takesFirst mode: condensed header → takes section leads ──────────────

  if (isTakesFirst) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            title: "Expert Takes",
            headerBackTitle: "Back",
          }}
        />
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Condensed header: 2-line headline + source link */}
          <View style={styles.condensedHeader}>
            <Text style={styles.condensedHeadline} numberOfLines={2}>
              {safeStory.headline}
            </Text>
            <Pressable onPress={() => void Linking.openURL(safeStory.sourceUrl)}>
              <Text style={styles.condensedSourceLink}>
                {safeStory.sourceName} · Read full story →
              </Text>
            </Pressable>
          </View>

          {/* Expert Takes section — leads immediately */}
          <View style={styles.expertSection}>
            <View style={styles.expertSectionHeader}>
              <Text style={styles.expertSectionTitle}>Expert Takes</Text>
              {hasExpertOpinions && (
                <Text style={styles.expertSectionCount}>
                  {safeStory.expertOpinions.length}{" "}
                  {safeStory.expertOpinions.length === 1 ? "take" : "takes"}
                </Text>
              )}
            </View>
            {hasExpertOpinions ? renderExpertTakes() : (
              <Text style={{ paddingHorizontal: spacing.xl, color: "#888", fontSize: 14 }}>
                No expert takes yet.
              </Text>
            )}
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </>
    );
  }

  // ── Default mode: full-article render ─────────────────────────────────────

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: safeStory.sourceName,
          headerBackTitle: "Back",
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero image */}
        {safeStory.imageUrl ? (
          <Image
            source={{ uri: safeStory.imageUrl }}
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
          <Text style={styles.categoryChip}>{safeStory.category}</Text>

          {/* Headline */}
          <Text style={styles.headline}>{safeStory.headline}</Text>

          {/* Meta row: source + published date */}
          <Pressable
            style={styles.metaRow}
            onPress={() => void Linking.openURL(safeStory.sourceUrl)}
          >
            <Text style={styles.sourceName}>{safeStory.sourceName}</Text>
            <Text style={styles.readMore}>Read original →</Text>
            <View style={{ flex: 1 }} />
            <Text style={styles.publishedAt}>
              {formatRelativeTime(safeStory.publishedAt)}
            </Text>
          </Pressable>

          {/* Summary / body */}
          <Text style={styles.summary}>{safeStory.summary}</Text>
        </View>

        {/* Expert Takes section */}
        {hasExpertOpinions && (
          <View style={styles.expertSection}>
            <View style={styles.expertSectionHeader}>
              <Text style={styles.expertSectionTitle}>Expert Takes</Text>
              <Text style={styles.expertSectionCount}>
                {safeStory.expertOpinions.length}{" "}
                {safeStory.expertOpinions.length === 1 ? "take" : "takes"}
              </Text>
            </View>
            {renderExpertTakes()}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </>
  );
}
