import { useCallback, useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OnboardingWalkthrough } from "@/components/onboarding-walkthrough";
import { StreakReminder } from "@/components/streak-reminder";
import { mobileApi } from "@/lib/api";
import { useTheme } from "@/providers/theme-provider";

function useNotificationBadge() {
  const [unreadCount, setUnreadCount] = useState<number>(0);

  const fetch = useCallback(() => {
    mobileApi
      .getNotifications({ limit: 1 })
      .then((res) => setUnreadCount(res.unreadCount ?? 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, 30_000);
    return () => clearInterval(id);
  }, [fetch]);

  return unreadCount;
}

export default function TabsLayout() {
  const notificationCount = useNotificationBadge();
  const profileBadge = notificationCount > 0 ? notificationCount : undefined;
  const { colors, shadows } = useTheme();
  // Add the system nav-bar inset so the tab bar sits ABOVE the Android gesture/
  // 3-button nav (was hardcoded height:72 → overlapped the system nav).
  const insets = useSafeAreaInsets();

  return (
    <>
      <OnboardingWalkthrough />
      <StreakReminder />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: {
            height: 72 + insets.bottom,
            paddingTop: 8,
            paddingBottom: 10 + insets.bottom,
            backgroundColor: colors.surface,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
            ...shadows.sm,
          },
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: "700",
            letterSpacing: 0.3,
          },
        }}
      >
        <Tabs.Screen
          name="feed"
          options={{
            title: "Feed",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="newspaper-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="finance"
          options={{
            title: "Finance",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="stats-chart-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="create"
          options={{
            title: "Create",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="add-circle-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="markets"
          options={{
            // Renamed from "Markets" to "Explore" — route path /(tabs)/markets unchanged.
            // analytics: existing "markets_tab_opened" event name preserved for historical comparability.
            title: "Explore",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="compass-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="person-outline" size={size} color={color} />
            ),
            tabBarBadge: profileBadge,
          }}
        />
        <Tabs.Screen
          name="groups"
          options={{
            // Tab hidden from bar — Groups are discoverable via the Explore tab
            // (community spotlight, communities rail, per-market Hosted-by chip).
            // The route /(tabs)/groups remains navigable for deep links.
            href: null,
            title: "Groups",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="people-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen name="sports" options={{ href: null }} />
        <Tabs.Screen name="leaderboard" options={{ href: null }} />
        <Tabs.Screen name="notifications" options={{ href: null }} />
      </Tabs>
    </>
  );
}
