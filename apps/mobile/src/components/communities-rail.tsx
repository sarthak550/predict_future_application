/**
 * CommunitiesRail
 *
 * Horizontal scrollable row of up to 8 OPEN groups shown on the
 * Explore screen below the CommunitySpotlightCard.
 *
 * Data source: GET /api/groups/discover?sort=members&limit=8
 *              Caller passes groups array (results[0..7]).
 *              results[0] is used by CommunitySpotlightCard separately.
 *
 * Each compact card: cover image or gradient fallback, group name,
 * optional category badge, member count. Taps to /group/[id].
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ApiDiscoverGroup } from "@predict-future/types";
import { radius, spacing } from "@predict-future/ui-tokens";
import { useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

import { trackExploreEvent } from "@/lib/analytics";

// ── Category colour palette ───────────────────────────────────────────

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

// ── Compact group card ────────────────────────────────────────────────

interface GroupCardProps {
  group: ApiDiscoverGroup;
}

function CompactGroupCard({ group }: GroupCardProps) {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);

  function handlePress() {
    trackExploreEvent("explore_communities_rail_tapped", {
      groupId: group.id,
      groupName: group.name,
      surface: "rail",
    });
    router.push(`/group/${group.id}` as Parameters<typeof router.push>[0]);
  }

  return (
    <Pressable
      style={styles.card}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${group.name} community, ${group.memberCount} members`}
    >
      {/* Cover image or gradient fallback */}
      {group.coverImageUrl ? (
        <Image
          source={{ uri: group.coverImageUrl }}
          style={styles.cardCover}
          resizeMode="cover"
        />
      ) : (
        <View
          style={[
            styles.cardCover,
            { backgroundColor: categoryColor(group.category) },
          ]}
        >
          <Ionicons
            name="people"
            size={28}
            color="rgba(255,255,255,0.3)"
          />
        </View>
      )}

      {/* Bottom gradient overlay for text */}
      <View style={styles.cardOverlay} />

      {/* Category badge — top-right */}
      {group.category ? (
        <View style={styles.cardCategoryBadge}>
          <Text style={styles.cardCategoryText}>
            {categoryLabel(group.category)}
          </Text>
        </View>
      ) : null}

      {/* S59-T5: Featured star badge — top-left */}
      {group.isFeatured ? (
        <View style={styles.cardFeaturedBadge}>
          <Text style={styles.cardFeaturedText}>Featured</Text>
        </View>
      ) : null}

      {/* Text content — bottom */}
      <View style={styles.cardTextBlock}>
        <Text style={styles.cardName} numberOfLines={2}>
          {group.name}
        </Text>
        <View style={styles.cardMemberRow}>
          <Ionicons name="people-outline" size={10} color="rgba(255,255,255,0.75)" />
          <Text style={styles.cardMemberText}>
            {group.memberCount.toLocaleString()}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

// ── Rail component ────────────────────────────────────────────────────

interface Props {
  /** Pass discover results (up to 8 groups). Rail hidden when empty. */
  groups: ApiDiscoverGroup[];
}

export function CommunitiesRail({ groups }: Props) {
  const styles = useThemedStyles(makeStyles);

  if (groups.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionHeader}>Communities you might like</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {groups.map((group) => (
          <CompactGroupCard key={group.id} group={group} />
        ))}
      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const CARD_WIDTH = 140;
const CARD_HEIGHT = 160;

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  container: {
    marginBottom: spacing.sm,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: "600",
    color: t.colors.text,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  // ── Card
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: radius.md,
    overflow: "hidden",
    ...t.shadows.card,
  },
  cardCover: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  cardOverlay: {
    ...StyleSheet.absoluteFillObject,
    // Gradient-like overlay: transparent at top, dark at bottom
    backgroundColor: "transparent",
    // React Native doesn't support CSS gradients inline; use a
    // two-layer approach: faint full overlay + bottom dark block.
  },
  cardCategoryBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
  },
  cardCategoryText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "600",
  },
  // S59-T5: Featured badge — top-left corner of rail card
  cardFeaturedBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: "#FEF9C3",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
  },
  cardFeaturedText: {
    color: "#854D0E",
    fontSize: 9,
    fontWeight: "700",
  },
  cardTextBlock: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    padding: 8,
    gap: 3,
  },
  cardName: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 17,
  },
  cardMemberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  cardMemberText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 11,
    fontWeight: "500",
  },
});
