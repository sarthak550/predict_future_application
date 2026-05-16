import { Stack } from "expo-router";

import { colors } from "@predict-future/ui-tokens";

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
  );
}
