/**
 * GroupNotifDefaultCard (S58/S59)
 *
 * Server-authoritative group notification default picker, extracted from
 * profile.tsx (S65-T1).
 *
 * Renders a tappable row that opens an Alert action-sheet to choose
 * ALL | MENTIONS_ONLY | NONE. The caller owns optimistic state + revert.
 */

import React from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { radius, spacing } from "@predict-future/ui-tokens";
import type { GroupNotifLevel } from "@predict-future/types";

import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

export const GROUP_NOTIF_OPTIONS: Array<{
  label: string;
  sublabel: string;
  value: GroupNotifLevel;
}> = [
  {
    label: "All activity",
    sublabel: "Get notified for all group events",
    value: "ALL",
  },
  {
    label: "Mentions only",
    sublabel: "Only when you are mentioned",
    value: "MENTIONS_ONLY",
  },
  {
    label: "Off",
    sublabel: "No group notifications",
    value: "NONE",
  },
];

export function GroupNotifDefaultCard({
  current,
  onChange,
}: {
  current: GroupNotifLevel;
  onChange: (level: GroupNotifLevel) => Promise<void>;
}) {
  const { colors } = useTheme();
  const groupNotifStyles = useThemedStyles(makeGroupNotifStyles);

  function handlePress() {
    const opts = GROUP_NOTIF_OPTIONS.map((o) => ({
      text: current === o.value ? `${o.label} (current)` : o.label,
      onPress: () => { void onChange(o.value); },
    }));
    Alert.alert(
      "Group notification default",
      "Applies to groups you join after changing this setting.",
      [...opts, { text: "Cancel", style: "cancel" as const }]
    );
  }

  const currentLabel =
    GROUP_NOTIF_OPTIONS.find((o) => o.value === current)?.label ?? "All activity";

  return (
    <View style={groupNotifStyles.card}>
      <Text style={groupNotifStyles.sectionTitle}>Groups</Text>
      <Pressable style={groupNotifStyles.row} onPress={handlePress}>
        <View style={groupNotifStyles.iconWrap}>
          <Ionicons name="people-outline" size={18} color={colors.textMuted} />
        </View>
        <View style={groupNotifStyles.textWrap}>
          <Text style={groupNotifStyles.label}>Group notifications default</Text>
          <Text style={groupNotifStyles.sublabel}>
            Applies to groups you join after changing this setting.
          </Text>
        </View>
        <Text style={groupNotifStyles.value}>{currentLabel}</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

const makeGroupNotifStyles = (t: ThemeContextValue) => StyleSheet.create({
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.colors.border,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: t.colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconWrap: {
    width: 32,
    alignItems: "center",
  },
  textWrap: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: t.colors.text,
  },
  sublabel: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 2,
  },
  value: {
    fontSize: 13,
    color: t.colors.textMuted,
    fontWeight: "500",
    marginRight: 4,
  },
});
