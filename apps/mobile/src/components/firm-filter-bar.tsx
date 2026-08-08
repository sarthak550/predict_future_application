/**
 * FirmFilterBar
 *
 * Horizontally scrollable pill row for filtering an expert list by firm —
 * the mobile counterpart to apps/web's AnalystFirmFilter dropdown
 * (components/finance/analyst-firm-filter.tsx). Founder ask, 2026-08-08:
 * "not one click on UTI AMC but another filter with Analyst where you can
 * filter the firms" — a visible filter control next to the expert list, not
 * navigation triggered by tapping a firm name.
 *
 * Visually modeled on CategoryFilterBar (components/category-filter-bar.tsx)
 * — the same underline-tab idiom already used for Feed/Markets category
 * filtering — so a Firm filter reads as "the same kind of control" a user has
 * already learned elsewhere in the app, not a bespoke new pattern. Unlike
 * CategoryFilterBar's fixed enum, the firm list is data-driven (fetched from
 * GET /api/finance/experts/firms) so this component takes it as a prop rather
 * than owning a hardcoded set.
 *
 * "All firms" is always the first pill and the default selection.
 */

import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { spacing } from "@predict-future/ui-tokens";
import { useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

export const ALL_FIRMS = "ALL";

export type FirmOption = { firm: string; count: number };

type FirmFilterBarProps = {
  firms: FirmOption[];
  selected: string;
  onSelect: (firm: string) => void;
};

export function FirmFilterBar({ firms, selected, onSelect }: FirmFilterBarProps) {
  const styles = useThemedStyles(makeStyles);

  // Nothing to filter by — don't render an empty/useless control.
  if (firms.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <FirmPill
          label="All firms"
          isActive={selected === ALL_FIRMS}
          onPress={() => onSelect(ALL_FIRMS)}
          accessibilityLabel="Show all firms"
        />
        {firms.map((opt) => {
          const isActive = selected === opt.firm;
          return (
            <FirmPill
              key={opt.firm}
              label={`${opt.firm} (${opt.count})`}
              isActive={isActive}
              onPress={() => onSelect(opt.firm)}
              accessibilityLabel={`Filter by ${opt.firm}`}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

function FirmPill({
  label,
  isActive,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  isActive: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      style={styles.tab}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: isActive }}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
    >
      <Text style={[styles.tabText, isActive && styles.tabTextActive]} numberOfLines={1}>
        {label}
      </Text>
      <View style={[styles.underline, isActive && styles.underlineActive]} />
    </Pressable>
  );
}

const makeStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    container: {
      backgroundColor: t.colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.colors.border,
    },
    scrollContent: {
      paddingHorizontal: spacing.lg,
      paddingTop: 6,
      paddingBottom: 4,
      gap: 18,
      alignItems: "center",
    },
    tab: {
      alignItems: "center",
      paddingHorizontal: 2,
      paddingTop: 6,
      maxWidth: 220,
    },
    tabText: {
      fontSize: 13,
      fontWeight: "600",
      color: t.colors.textMuted,
      letterSpacing: 0.1,
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
