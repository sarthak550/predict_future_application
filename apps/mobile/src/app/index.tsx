import { Redirect } from "expo-router";

import { useSession } from "@/providers/session-provider";

export default function IndexScreen() {
  const { status, isNewUser } = useSession();

  // While SecureStore is being read, render nothing to avoid a redirect flash.
  if (status === "loading") return null;

  if (status === "unauthenticated") {
    return <Redirect href="/(auth)/sign-in" />;
  }

  // Freshly-registered users see onboarding first.
  // isNewUser is only true when signIn({ isNew: true }) was called in the
  // current app session — it is never persisted to SecureStore, so cold
  // launches always land here with isNewUser === false.
  if (isNewUser) {
    return <Redirect href="/onboarding" />;
  }

  return <Redirect href="/(tabs)/feed" />;
}
