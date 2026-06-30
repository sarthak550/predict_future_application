/**
 * AnonymousToggleCard (S26-T5)
 *
 * "Show as anonymous" toggle card, extracted from profile.tsx (S65-T1).
 *
 * When enabled the user's calls appear as "AnonymousAnalyst_XXXXXX" on all
 * public-facing surfaces (leaderboard, market detail, comments, etc.). Their
 * accuracy record, league tier, and quest rewards continue to accrue to their
 * real account regardless of this setting.
 *
 * Own-view exception: the user always sees their real username on Profile.
 */

import React from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { radius, spacing } from "@predict-future/ui-tokens";
import type { AppUserDisplayMode } from "@predict-future/types";

import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

export function AnonymousToggleCard({
  displayMode,
  userId: _userId,
  onToggle,
}: {
  displayMode: AppUserDisplayMode;
  userId: string;
  onToggle: (enabled: boolean) => Promise<void>;
}) {
  const { colors } = useTheme();
  const anonStyles = useThemedStyles(makeAnonStyles);
  const isAnonymous = displayMode === "ANONYMOUS";

  function handleValueChange(value: boolean) {
    if (value) {
      // Show confirmation dialog before enabling anonymous mode.
      Alert.alert(
        "Show as anonymous?",
        "Your calls will appear as AnonymousAnalyst_XXXXXX on leaderboards, comments, and market details. Your accuracy record still accrues to your account and is fully preserved when you switch back.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Enable",
            style: "default",
            onPress: () => { void onToggle(true); },
          },
        ]
      );
    } else {
      void onToggle(false);
    }
  }

  return (
    <View style={anonStyles.card}>
      <View style={anonStyles.row}>
        <View style={anonStyles.iconWrap}>
          <Ionicons name="eye-off-outline" size={18} color={colors.textMuted} />
        </View>
        <View style={anonStyles.textWrap}>
          <Text style={anonStyles.label}>Show as anonymous</Text>
          <Text style={anonStyles.sublabel}>
            {isAnonymous
              ? "Public view: AnonymousAnalyst_XXXXXX (tap to reveal)"
              : "Your real username is visible publicly"}
          </Text>
        </View>
        <Switch
          value={isAnonymous}
          onValueChange={handleValueChange}
          trackColor={{ false: colors.border, true: colors.accent }}
          thumbColor="#FFFFFF"
        />
      </View>
      {isAnonymous && (
        <Text style={anonStyles.hint}>
          Your calls will appear as AnonymousAnalyst_XXXXXX. Your accuracy and
          track record still count.
        </Text>
      )}
    </View>
  );
}

const makeAnonStyles = (t: ThemeContextValue) => StyleSheet.create({
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.colors.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
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
  hint: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: t.colors.textMuted,
    lineHeight: 17,
    paddingLeft: 32 + spacing.md,
  },
});
