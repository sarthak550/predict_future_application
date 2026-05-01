import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

import { OnboardingWalkthrough } from "@/components/onboarding-walkthrough";
import { StreakReminder } from "@/components/streak-reminder";
import { mobileApi } from "@/lib/api";

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

  return (
    <>
      <OnboardingWalkthrough />
      <StreakReminder />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: "#0F172A",
          tabBarInactiveTintColor: "#94A3B8",
          tabBarStyle: {
            height: 72,
            paddingTop: 8,
            paddingBottom: 10,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: "600",
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
          name="sports"
          options={{
            title: "Sports",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="football-outline" size={size} color={color} />
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
            title: "Markets",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="trending-up-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen name="leaderboard" options={{ href: null }} />
        <Tabs.Screen name="notifications" options={{ href: null }} />
        <Tabs.Screen name="groups" options={{ href: null }} />
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
      </Tabs>
    </>
  );
}
