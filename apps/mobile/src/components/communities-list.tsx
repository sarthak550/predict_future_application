/**
 * CommunitiesList — compact vertical list of OPEN groups for discovery
 * surfaces. Each row is ~52px (leading colored avatar + name + meta + Join
 * chip), max `limit` visible (default 5). Replaces the much-heavier
 * CommunitySpotlightCard + CommunitiesRail in the My Groups Discover section.
 *
 * Used in: My Groups sub-tab of Explore (S55-T7 + T8 iteration).
 */

import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ApiDiscoverGroup } from "@predict-future/types";
import { radius, spacing } from "@predict-future/ui-tokens";
import { useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

import { trackExploreEvent } from "@/lib/analytics";

const CATEGORY_COLORS: Record<string, string> = {
  FINANCE: "#1D4ED8",
  SPORTS: "#15803D",
  BUSINESS: "#7C3AED",
  TECH: "#0891B2",
  ENTERTAINMENT: "#DB2777",
  WEATHER: "#D97706",
  GENERAL: "#4B5563",
};

function categoryColor(category: string | null): string {
  if (!category) return CATEGORY_COLORS.GENERAL!;
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.GENERAL!;
}

function categoryLabel(category: string | null): string | null {
  if (!category) return null;
  return category.charAt(0) + category.slice(1).toLowerCase();
}

type Props = {
  groups: ApiDiscoverGroup[];
  limit?: number;
};

export function CommunitiesList({ groups, limit = 5 }: Props) {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);

  if (groups.length === 0) return null;
  const visible = groups.slice(0, limit);

  return (
    <View style={styles.container}>
      {visible.map((g) => {
        const memberLabel = g.memberCount === 1 ? "member" : "members";
        const cat = categoryLabel(g.category);
        const meta = cat ? `${cat} · ${g.memberCount} ${memberLabel}` : `${g.memberCount} ${memberLabel}`;
        return (
          <Pressable
            key={g.id}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => {
              trackExploreEvent("explore_communities_rail_tapped", {
                groupId: g.id,
                groupName: g.name,
                surface: "list",
              });
              router.push(`/group/${g.id}` as Parameters<typeof router.push>[0]);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${g.name}, ${meta}`}
          >
            <View style={[styles.avatar, { backgroundColor: categoryColor(g.category) }]}>
              <Text style={styles.avatarText}>{g.name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.content}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {g.name}
                </Text>
                {/* S59-T5: Featured badge */}
                {g.isFeatured ? (
                  <View style={styles.featuredBadge}>
                    <Text style={styles.featuredBadgeText}>Featured</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.meta} numberOfLines={1}>
                {meta}
              </Text>
            </View>
            <View style={styles.joinChip}>
              <Text style={styles.joinChipText}>Join</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  container: {
    marginHorizontal: spacing.lg,
    backgroundColor: t.colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.colors.border,
    overflow: "hidden" as const,
  },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.border,
  },
  rowPressed: {
    backgroundColor: t.colors.surfaceMuted,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  avatarText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700" as const,
  },
  content: {
    flex: 1,
  },
  nameRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    flexWrap: "nowrap" as const,
  },
  name: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: t.colors.text,
    flexShrink: 1,
  },
  // S59-T5: "Featured" editorial pill
  featuredBadge: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: "#FEF9C3",
    flexShrink: 0,
  },
  featuredBadgeText: {
    fontSize: 10,
    fontWeight: "700" as const,
    color: "#854D0E",
  },
  meta: {
    fontSize: 11,
    color: t.colors.textMuted,
    marginTop: 1,
  },
  joinChip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: t.colors.accent,
  },
  joinChipText: {
    fontSize: 11,
    fontWeight: "700" as const,
    color: "#fff",
  },
});
