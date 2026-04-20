import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import type { ApiHostStats } from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";

export default function ProfileScreen() {
  const { session, status: sessionStatus } = useSession();
  const userId = session?.userId;

  const { data: stats, status, error, refetch } = useApiQuery<ApiHostStats>(
    () => mobileApi.getUserHostStats(userId as string),
    [userId],
    {
      enabled: sessionStatus === "authenticated" && Boolean(userId),
      errorFallback: "Unable to load host stats."
    }
  );

  return (
    <View style={styles.screen}>
      <Text style={styles.kicker}>Profile</Text>
      <Text style={styles.title}>Host trust visibility</Text>
      <Text style={styles.subtitle}>
        Mobile is prepared to show trust, timeouts, overturns, and future notification/deep-link surfaces from the same
        shared backend.
      </Text>

      <View style={styles.card}>
        <ProfileBody
          isAuthenticated={sessionStatus === "authenticated" && Boolean(userId)}
          status={status}
          error={error}
          stats={stats}
          onRetry={refetch}
        />
      </View>
    </View>
  );
}

type ProfileBodyProps = {
  isAuthenticated: boolean;
  status: "idle" | "loading" | "success" | "error";
  error: string | null;
  stats: ApiHostStats | null;
  onRetry: () => void;
};

function ProfileBody({ isAuthenticated, status, error, stats, onRetry }: ProfileBodyProps) {
  if (!isAuthenticated) {
    return (
      <>
        <Text style={styles.cardTitle}>Sign in to continue</Text>
        <Text style={styles.metric}>
          Once mobile auth is wired up, this tab will show live host trust, timeouts, and overturns. For local dev set{" "}
          <Text style={styles.code}>EXPO_PUBLIC_DEMO_USER_ID</Text>.
        </Text>
      </>
    );
  }

  if (status === "loading" || status === "idle") {
    return <ActivityIndicator color={colors.accent} />;
  }

  if (status === "error") {
    return (
      <>
        <Text style={styles.cardTitle}>Couldn't load stats</Text>
        <Text style={styles.metric}>{error}</Text>
        <Pressable onPress={onRetry} style={styles.retry}>
          <Text style={styles.retryLabel}>Retry</Text>
        </Pressable>
      </>
    );
  }

  if (!stats?.hostStats) {
    return (
      <>
        <Text style={styles.cardTitle}>@{stats?.username ?? "user"}</Text>
        <Text style={styles.metric}>No host activity yet for this account.</Text>
      </>
    );
  }

  const hostStats = stats.hostStats;

  return (
    <>
      <Text style={styles.cardTitle}>@{stats.username}</Text>
      <Text style={styles.metric}>Trust score: {hostStats.hostTrustScore}</Text>
      <Text style={styles.metric}>
        Valid hosted markets: {hostStats.validFinalizedHostedMarketsCount}
      </Text>
      <Text style={styles.metric}>Timeouts: {hostStats.hostTimeoutCount}</Text>
      <Text style={styles.metric}>Overturned: {hostStats.overturnedHostedMarketsCount}</Text>
      <Text style={styles.metric}>Average fee: {(hostStats.avgHostCommissionBps / 100).toFixed(2)}%</Text>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.xl
  },
  kicker: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.accent
  },
  title: {
    marginTop: spacing.sm,
    fontSize: 30,
    fontWeight: "700",
    color: colors.text
  },
  subtitle: {
    marginTop: spacing.md,
    fontSize: 15,
    lineHeight: 24,
    color: colors.textMuted
  },
  card: {
    marginTop: spacing.xl,
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text
  },
  metric: {
    marginTop: spacing.md,
    fontSize: 15,
    color: colors.textMuted
  },
  code: {
    fontFamily: "Courier"
  },
  retry: {
    marginTop: spacing.lg,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accent
  },
  retryLabel: {
    color: colors.surface,
    fontWeight: "700",
    fontSize: 14
  }
});
