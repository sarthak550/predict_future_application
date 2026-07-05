/**
 * ThemedStackHeader
 *
 * A custom header for native-stack detail screens. Set as the default `header`
 * in the root Stack screenOptions so every screen with headerShown:true uses it.
 *
 * Why custom: under Expo 54 edge-to-edge + a translucent status bar, the native
 * stack header does NOT reserve the status-bar height (neither headerStyle nor
 * headerStatusBarHeight fix it) — the back button ends up under the clock/battery.
 * This header pads `insets.top` explicitly (the same reliable mechanism the tab
 * GradientHeader uses) and is theme-aware, so it clears the status bar AND adapts
 * to dark mode.
 */
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/providers/theme-provider";

export function ThemedStackHeader({ navigation, options, back }: NativeStackHeaderProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const title = typeof options.headerTitle === "string" ? options.headerTitle : options.title ?? "";

  return (
    <View style={{ paddingTop: insets.top, backgroundColor: colors.background }}>
      <View style={styles.row}>
        {back ? (
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
        ) : (
          <View style={styles.backSpacer} />
        )}
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.rightSlot}>
          {options.headerRight ? options.headerRight({ canGoBack: Boolean(back), tintColor: colors.text }) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  backBtn: {
    padding: 8,
  },
  backSpacer: {
    width: 40,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    marginLeft: 4,
  },
  rightSlot: {
    minWidth: 40,
    alignItems: "flex-end",
    justifyContent: "center",
  },
});
