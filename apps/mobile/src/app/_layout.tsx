import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform, StyleSheet } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "@predict-future/ui-tokens";

import { mobileApi } from "@/lib/api";
import { AppProviders } from "@/providers";
import { useSession } from "@/providers/session-provider";
import { useTheme } from "@/providers/theme-provider";
import { LeagueBanner } from "@/components/league-banner";

/**
 * Lazy-load expo-notifications. In Expo Go (SDK 53+) Android remote-push support
 * was removed and the module logs an error at module-init time. We detect Expo Go
 * via Constants.appOwnership and skip the require entirely — push then becomes a
 * no-op until the user runs a development build (where Notifications loads cleanly).
 */
import Constants from "expo-constants";

type NotificationsModule = typeof import("expo-notifications");
let _notifications: NotificationsModule | null = null;
let _notificationsTried = false;
function tryLoadNotifications(): NotificationsModule | null {
  if (_notificationsTried) return _notifications;
  _notificationsTried = true;
  // Don't even attempt the require in Expo Go — the module's init logs a noisy
  // error in dev tools that can't be suppressed by try/catch alone.
  if (Constants.appOwnership === "expo") {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _notifications = require("expo-notifications");
  } catch {
    _notifications = null;
  }
  return _notifications;
}

/**
 * Registers an Expo push token with the API once the user is authenticated.
 * Runs as a fire-and-forget effect — failures are silently swallowed so they
 * never block navigation or surface errors to the user.
 *
 * Placed inside <AppProviders> so it has access to <SessionProvider>.
 */
function PushTokenRegistrar() {
  const { session } = useSession();

  useEffect(() => {
    if (!session) return;
    if (Platform.OS === "web") return;

    void (async () => {
      try {
        const Notifications = tryLoadNotifications();
        if (!Notifications) return; // expo-notifications unavailable (e.g. Expo Go SDK 53+)

        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== "granted") return;

        // Push notifications need FCM credentials on Android (google-services.json).
        // In dev builds without it, getExpoPushTokenAsync throws — swallow silently
        // so the app continues to work without notifications.
        const tokenData = await Notifications.getExpoPushTokenAsync();
        await mobileApi.registerPushToken({ token: tokenData.data });
      } catch {
        // Best-effort — push token registration failures must never surface to
        // the user or interrupt the session. The user can still use the app.
      }
    })();
  }, [session?.userId]);

  return null;
}

/**
 * The app shell — rendered INSIDE AppProviders so it can read the active theme.
 * StatusBar icons, safe-area background and Stack content background all follow
 * the light/dark toggle.
 */
function ThemedShell() {
  const { colors: themeColors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <>
      <StatusBar
        style={isDark ? "light" : "dark"}
        translucent={Platform.OS === "android"}
        backgroundColor="transparent"
      />
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: themeColors.background }]}
        edges={["left", "right"]}
      >
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: themeColors.background },
            // Theme-aware nav header (was defaulting to a white bar in dark mode).
            // Applies to every screen that sets headerShown: true.
            headerStyle: { backgroundColor: themeColors.background },
            headerTintColor: themeColors.text,
            headerTitleStyle: { color: themeColors.text },
            // Edge-to-edge (Expo 54) + translucent status bar: reserve the status-bar
            // height in the header so the back button isn't under the clock/battery.
            headerStatusBarHeight: insets.top,
          }}
        />
      </SafeAreaView>
    </>
  );
}

export default function RootLayout() {
  return (
    <AppProviders>
      <PushTokenRegistrar />
      <LeagueBanner />
      <ThemedShell />
    </AppProviders>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background
  }
});
