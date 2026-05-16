/**
 * CategoryFilterBar
 *
 * Horizontally scrollable pill row for filtering by MarketCategory.
 * Categories are derived from the canonical MarketCategory enum in
 * apps/api/prisma/schema.prisma — values are case-sensitive and must
 * match exactly to align with API filtering.
 *
 * Props:
 *   selected      — currently active category key ("ALL" or a MarketCategory value)
 *   onSelect      — called with the new category key when a pill is tapped
 *   categories    — optional subset; defaults to FILTER_BAR_CATEGORIES
 *   elevated      — if true wraps in a surface-colored bordered container
 *   trailingNode  — optional React node appended after the last pill (e.g. StreakBadge)
 */

import React, { type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { colors, radius, spacing } from "@predict-future/ui-tokens";

export type CategoryKey =
  | "ALL"
  | "SPORTS"
  | "FINANCE"
  | "TECH"
  | "BUSINESS"
  | "ENTERTAINMENT"
  | "WEATHER"
  | "PRODUCT"
  | "COMPANY"
  | "GENERAL";

export type CategoryFilterBarCategory = {
  key: CategoryKey;
  label: string;
};

/**
 * Full ordered list of category pills. Order mirrors the ticket spec intent
 * while staying bound to the actual MarketCategory enum values.
 */
export const FILTER_BAR_CATEGORIES: CategoryFilterBarCategory[] = [
  { key: "ALL",           label: "All" },
  { key: "SPORTS",        label: "Sports" },
  { key: "FINANCE",       label: "Finance" },
  { key: "ENTERTAINMENT", label: "Entertainment" },
  { key: "TECH",          label: "Tech" },
  { key: "BUSINESS",      label: "Business" },
  { key: "WEATHER",       label: "Weather" },
  { key: "PRODUCT",       label: "Product" },
  { key: "COMPANY",       label: "Company" },
  { key: "GENERAL",       label: "General" },
];

type CategoryFilterBarProps = {
  selected: CategoryKey | string;
  onSelect: (category: CategoryKey) => void;
  /**
   * Optional subset of categories to render. Defaults to FILTER_BAR_CATEGORIES.
   * Allows callers to render a curated subset (e.g. Feed tab omits some).
   */
  categories?: CategoryFilterBarCategory[];
  /**
   * If true, renders the bar inside a View with a surface background and
   * bottom border — suitable for use as a sticky header strip.
   */
  elevated?: boolean;
  /**
   * Optional node rendered after the last pill in the horizontal scroll.
   * Used by the Feed tab to append the StreakBadge in-line.
   */
  trailingNode?: ReactNode;
};

export function CategoryFilterBar({
  selected,
  onSelect,
  categories = FILTER_BAR_CATEGORIES,
  elevated = false,
  trailingNode,
}: CategoryFilterBarProps) {
  const containerStyle = elevated
    ? [styles.elevatedContainer]
    : [styles.inlineContainer];

  return (
    <View style={containerStyle}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {categories.map((cat) => {
          const isActive = selected === cat.key;
          return (
            <Pressable
              key={cat.key}
              style={[styles.pill, isActive && styles.pillActive]}
              onPress={() => onSelect(cat.key)}
              accessibilityRole="button"
              accessibilityLabel={cat.key === "ALL" ? "Show all categories" : `Filter by ${cat.label}`}
              accessibilityState={{ selected: isActive }}
            >
              <Text
                style={[styles.pillText, isActive && styles.pillTextActive]}
                numberOfLines={1}
              >
                {cat.label}
              </Text>
            </Pressable>
          );
        })}
        {trailingNode != null ? trailingNode : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  inlineContainer: {
    // No background — inherits parent
  },
  elevatedContainer: {
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
    gap: 8,
    alignItems: "center",
  },
  pill: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
    // Subtle elevation for the active pill
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  pillTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
});
