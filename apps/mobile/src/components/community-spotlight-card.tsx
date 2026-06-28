/**
 * CommunitySpotlightCard
 *
 * Featured community card shown at the top of the Explore screen.
 * Surfaces the highest-memberCount OPEN group so users browsing
 * markets organically discover communities.
 *
 * Data source: GET /api/groups/discover?sort=members&limit=8
 *              (shared with CommunitiesRail — caller passes results[0])
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import type { ApiDiscoverGroup } from "@predict-future/types";
import { radius, spacing } from "@predict-future/ui-tokens";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

import { trackExploreEvent } from "@/lib/analytics";

// ── Category colour palette (mirrors group/[id].tsx) ─────────────────

const CATEGORY_COLORS: Record<string, string> = {
  FINANCE: "#1D4ED8",
  SPORTS: "#15803D",
  BUSINESS: "#7C3AED",
  TECH: "#0891B2",
  ENTERTAINMENT: "#DB2777",
  WEATHER: "#D97706",
  GENERAL: "#4B5563",
  PRODUCT: "#9333EA",
  COMPANY: "#059669",
};

function categoryColor(cat?: string | null): string {
  return CATEGORY_COLORS[cat ?? ""] ?? "#4B5563";
}

function categoryLabel(cat?: string | null): string {
  if (!cat) return "";
  return cat.charAt(0) + cat.slice(1).toLowerCase();
}

// ── Component ─────────────────────────────────────────────────────────

interface Props {
  group: ApiDiscoverGroup;
}

export function CommunitySpotlightCard({ group }: Props) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const teaserLine =
    group.description && group.description.length > 0
      ? group.description
      : null;

  function handlePress() {
    trackExploreEvent("explore_spotlight_tapped", {
      groupId: group.id,
      groupName: group.name,
      surface: "spotlight",
    });
    router.push(`/group/${group.id}` as Parameters<typeof router.push>[0]);
  }

  return (
    <Pressable
      style={styles.container}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Featured community: ${group.name}. ${group.memberCount} members.`}
    >
      {/* Cover image or gradient fallback */}
      {group.coverImageUrl ? (
        <Image
          source={{ uri: group.coverImageUrl }}
          style={styles.coverImage}
          resizeMode="cover"
        />
      ) : (
        <View
          style={[
            styles.coverGradient,
            { backgroundColor: categoryColor(group.category) },
          ]}
        >
          <Ionicons
            name="people"
            size={48}
            color="rgba(255,255,255,0.25)"
          />
        </View>
      )}

      {/* Dark overlay for text legibility */}
      <View style={styles.overlay} />

      {/* Featured pill — top-left */}
      <View style={styles.featuredPill}>
        <Ionicons name="star" size={10} color="#FBBF24" />
        <Text style={styles.featuredText}>Featured</Text>
      </View>

      {/* Category pill — top-right (if set) */}
      {group.category ? (
        <View style={styles.categoryPill}>
          <Text style={styles.categoryPillText}>
            {categoryLabel(group.category)}
          </Text>
        </View>
      ) : null}

      {/* Bottom content row */}
      <View style={styles.bottomRow}>
        {/* Left: name + stats + teaser */}
        <View style={styles.textBlock}>
          <Text style={styles.groupName} numberOfLines={1}>
            {group.name}
          </Text>

          <View style={styles.statsRow}>
            <Ionicons name="people-outline" size={12} color="rgba(255,255,255,0.8)" />
            <Text style={styles.statText}>
              {group.memberCount.toLocaleString()} members
            </Text>
            {group.recentMarketCount > 0 ? (
              <>
                <Text style={styles.statDot}>·</Text>
                <Ionicons
                  name="trending-up-outline"
                  size={12}
                  color="rgba(255,255,255,0.8)"
                />
                <Text style={styles.statText}>
                  {group.recentMarketCount} active{" "}
                  {group.recentMarketCount === 1 ? "market" : "markets"}
                </Text>
              </>
            ) : null}
          </View>

          {teaserLine ? (
            <Text style={styles.teaser} numberOfLines={1}>
              {teaserLine}
            </Text>
          ) : null}
        </View>

        {/* Right: Join community CTA */}
        <Pressable
          style={styles.ctaButton}
          onPress={handlePress}
          accessibilityRole="button"
          accessibilityLabel={`Join ${group.name} community`}
        >
          <Text style={styles.ctaText}>Join community</Text>
          <Ionicons name="arrow-forward" size={13} color={colors.accent} />
        </Pressable>
      </View>
    </Pressable>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const CARD_HEIGHT = 200;

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  container: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    height: CARD_HEIGHT,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...t.shadows.card,
  },
  coverImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  coverGradient: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  featuredPill: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
  },
  featuredText: {
    color: "#FBBF24",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  categoryPill: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
  },
  categoryPillText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "600",
  },
  bottomRow: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    padding: spacing.md,
    gap: spacing.sm,
  },
  textBlock: {
    flex: 1,
    gap: 4,
  },
  groupName: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
  },
  statText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    fontWeight: "500",
  },
  statDot: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
  },
  teaser: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    fontStyle: "italic",
    marginTop: 2,
  },
  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    flexShrink: 0,
  },
  ctaText: {
    color: t.colors.accent,
    fontSize: 13,
    fontWeight: "700",
  },
});
