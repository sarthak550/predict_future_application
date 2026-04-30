import * as Notifications from "expo-notifications";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@predict-future/ui-tokens";

import { mobileApi } from "@/lib/api";
import { AppProviders } from "@/providers";
import { useSession } from "@/providers/session-provider";

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
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") return;

      const tokenData = await Notifications.getExpoPushTokenAsync();
      await mobileApi.registerPushToken({ token: tokenData.data }).catch(() => {
        // Best-effort — push token registration failures must never surface to
        // the user or interrupt the session. The user can still use the app.
      });
    })();
  }, [session?.userId]);

  return null;
}

export default function RootLayout() {
  return (
    <AppProviders>
      <PushTokenRegistrar />
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
