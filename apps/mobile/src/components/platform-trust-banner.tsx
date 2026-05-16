/**
 * PlatformTrustBanner
 *
 * A compact pill-style banner that displays aggregate platform accuracy stats.
 * Used on the Feed tab (below the category filter bar) and on public profiles
 * (above the stats card).
 *
 * - Fetches GET /api/platform/stats on mount (no auth required).
 * - Shows a skeleton while loading.
 * - Silently hides on fetch failure (fail-silent UX).
 */

import { useEffect, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ApiPlatformStats } from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { mobileApi } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: ApiPlatformStats }
  | { status: "error" };

// ── Skeleton ───────────────────────────────────────────────────────────────────

function SkeletonPill() {
  return (
    <View style={styles.pill}>
      <View style={styles.skeletonBar} />
    </View>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PlatformTrustBanner() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    void mobileApi.getPlatformStats().then((data) => {
      if (!cancelled) {
        setState({ status: "ready", data });
      }
    }).catch(() => {
      if (!cancelled) {
        setState({ status: "error" });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Loading — show skeleton pill
  if (state.status === "loading") {
    return <SkeletonPill />;
  }

  // Error — fail silently (render nothing)
  if (state.status === "error") {
    return null;
  }

  const { avgAccuracyScore, totalResolvedMarkets } = state.data;
  const accuracyPct = (avgAccuracyScore * 100).toFixed(1);

  return (
    <View style={styles.pill}>
      <Text style={styles.text}>
        {`${accuracyPct}% accuracy across ${totalResolvedMarkets.toLocaleString()} resolved markets`}
      </Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  pill: {
    alignSelf: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginVertical: spacing.xs,
    maxWidth: "90%",
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "500",
    textAlign: "center",
  },
  skeletonBar: {
    height: 12,
    width: 200,
    borderRadius: radius.sm,
    backgroundColor: colors.border,
  },
});
