import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/error-boundary";
import { SessionProvider } from "@/providers/session-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import { WatchlistProvider } from "@/providers/watchlist-provider";

/**
 * Single place where all top-level providers compose. Keep this tree small and
 * explicit — every provider added here impacts app startup.
 *
 * SafeArea edge handling lives in the root _layout.tsx because it needs to
 * coexist with the expo-router <Stack /> sibling.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <SafeAreaProvider>
          <SessionProvider>
            <WatchlistProvider>{children}</WatchlistProvider>
          </SessionProvider>
        </SafeAreaProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
