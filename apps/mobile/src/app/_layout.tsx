import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@predict-future/ui-tokens";

import { mobileApi } from "@/lib/api";
import { AppProviders } from "@/providers";
import { useSession } from "@/providers/session-provider";
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

export default function RootLayout() {
  return (
    <AppProviders>
      <PushTokenRegistrar />
      <LeagueBanner />
      <StatusBar style="dark" translucent={Platform.OS === "android"} backgroundColor="transparent" />
      <SafeAreaView
        style={styles.safeArea}
        edges={Platform.OS === "android" ? ["top", "left", "right"] : ["left", "right"]}
      >
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background }
          }}
        />
      </SafeAreaView>
    </AppProviders>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background
  }
});
