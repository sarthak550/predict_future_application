import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@predict-future/ui-tokens";

import { AppProviders } from "@/providers";

export default function RootLayout() {
  return (
    <AppProviders>
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
