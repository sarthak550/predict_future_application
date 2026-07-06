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

import { radius, spacing } from "@predict-future/ui-tokens";
import { useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

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

/**
 * CORE_CATEGORIES — the curated topic set shown to users (Feed + Markets).
 * Finance/Company fold into Business and Product folds into Tech server-side;
 * General has no chip (those items still appear under "All"). Single source of
 * truth so Feed and Markets stay in sync.
 */
export const CORE_CATEGORIES: CategoryFilterBarCategory[] = [
  { key: "ALL",           label: "All" },
  { key: "SPORTS",        label: "Sports" },
  { key: "BUSINESS",      label: "Business" },
  { key: "TECH",          label: "Tech" },
  { key: "ENTERTAINMENT", label: "Entertainment" },
  { key: "WEATHER",       label: "Weather" },
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
  const styles = useThemedStyles(makeStyles);

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
              style={styles.tab}
              onPress={() => onSelect(cat.key)}
              accessibilityRole="tab"
              accessibilityLabel={cat.key === "ALL" ? "Show all categories" : `Filter by ${cat.label}`}
              accessibilityState={{ selected: isActive }}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            >
              <Text
                style={[styles.tabText, isActive && styles.tabTextActive]}
                numberOfLines={1}
              >
                {cat.label}
              </Text>
              <View style={[styles.underline, isActive && styles.underlineActive]} />
            </Pressable>
          );
        })}
        {trailingNode != null ? trailingNode : null}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  inlineContainer: {
    // No background — inherits parent
  },
  elevatedContainer: {
    backgroundColor: t.colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.border,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: 6,
    paddingBottom: 4,
    gap: 22,
    alignItems: "center",
  },
  // Underline text tabs — no boxes. Inactive = muted text; active = bold accent
  // text with a short accent underline bar sized to the label.
  tab: {
    alignItems: "center",
    paddingHorizontal: 2,
    paddingTop: 6,
  },
  tabText: {
    fontSize: 15,
    fontWeight: "600",
    color: t.colors.textMuted,
    letterSpacing: 0.2,
  },
  tabTextActive: {
    color: t.colors.accent,
    fontWeight: "800",
  },
  underline: {
    marginTop: 7,
    height: 3,
    borderRadius: 2,
    alignSelf: "stretch",
    backgroundColor: "transparent",
  },
  underlineActive: {
    backgroundColor: t.colors.accent,
  },
});
