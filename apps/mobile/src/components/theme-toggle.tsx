/**
 * ThemeToggleRow — the user-facing dark-mode control (lives in Profile).
 *
 * Three modes: Light, Dark, System (follow the OS). The choice is persisted by
 * the ThemeProvider. This component is itself theme-aware (reads useTheme), so it
 * recolors immediately when the mode changes — instant feedback on tap.
 */

import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { radius, spacing } from "@predict-future/ui-tokens";

import { useTheme, type ThemeMode } from "@/providers/theme-provider";

const OPTIONS: { key: ThemeMode; label: string }[] = [
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
  { key: "system", label: "System" },
];

export function ThemeToggleRow() {
  const { mode, setMode, colors } = useTheme();

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Ionicons name="contrast-outline" size={20} color={colors.text} />
        <Text style={[styles.label, { color: colors.text }]}>Appearance</Text>
      </View>
      <View
        style={[styles.segment, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}
      >
        {OPTIONS.map((opt) => {
          const active = mode === opt.key;
          return (
            <Pressable
              key={opt.key}
              onPress={() => setMode(opt.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.segItem, active && { backgroundColor: colors.accent }]}
            >
              <Text
                style={[styles.segText, { color: active ? "#FFFFFF" : colors.textMuted }]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
  },
  segment: {
    flexDirection: "row",
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 3,
    gap: 3,
  },
  segItem: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: radius.sm,
    alignItems: "center",
  },
  segText: {
    fontSize: 13,
    fontWeight: "700",
  },
});
