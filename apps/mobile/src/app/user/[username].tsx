import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type {
  ApiCategoryStat,
  ApiUserProfile,
  AppMarketStatus,
} from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";

// ── Badge helpers ─────────────────────────────────────────────────────────────

type BadgeMeta = { emoji: string; bg: string; color: string };

function getBadgeMeta(name: string): BadgeMeta {
  const lower = name.toLowerCase();
  if (lower.includes("oracle") || lower.includes("predict"))
    return { emoji: "🔮", bg: "#F5F3FF", color: "#7C3AED" };
  if (lower.includes("streak") || lower.includes("fire"))
    return { emoji: "🔥", bg: "#FFF7ED", color: "#EA580C" };
  if (lower.includes("contrarian") || lower.includes("upset"))
    return { emoji: "🎯", bg: "#FFF1F2", color: "#E11D48" };
  if (lower.includes("early") || lower.includes("first"))
    return { emoji: "⚡", bg: "#FFFBEB", color: "#D97706" };
  if (lower.includes("expert") || lower.includes("master"))
    return { emoji: "🏆", bg: "#ECFDF5", color: "#059669" };
  if (lower.includes("sport")) return { emoji: "⚽", bg: "#FFF1F2", color: "#DC2626" };
  if (lower.includes("tech")) return { emoji: "💻", bg: "#EFF6FF", color: "#2563EB" };
  if (lower.includes("business") || lower.includes("finance"))
    return { emoji: "📈", bg: "#F0FDF4", color: "#16A34A" };
  return { emoji: "⭐", bg: "#EFF6FF", color: "#0369A1" };
}

// ── Market status helpers ─────────────────────────────────────────────────────

const MARKET_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  OPEN: { label: "Open", color: "#059669", bg: "#ECFDF5" },
  CLOSED: { label: "Closed", color: "#D97706", bg: "#FFFBEB" },
  AWAITING_RESOLUTION: { label: "Pending", color: "#7C3AED", bg: "#F5F3FF" },
  RESOLVING: { label: "Resolving", color: "#0369A1", bg: "#EFF6FF" },
  RESOLVED: { label: "Resolved", color: "#64748B", bg: "#F1F5F9" },
  CANCELLED: { label: "Cancelled", color: "#94A3B8", bg: "#F8FAFC" },
};

function getMarketStatusMeta(status: string) {
  return (
    MARKET_STATUS_META[status] ?? {
      label: status,
      color: colors.textMuted as string,
      bg: colors.background as string,
    }
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Tag({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <View style={[styles.tag, accent === true && styles.tagAccent]}>
      <Text style={styles.tagText}>{label}</Text>
    </View>
  );
}

function BadgesSection({
  badges,
}: {
  badges: NonNullable<ApiUserProfile["badges"]>;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Badges</Text>
      {badges.length === 0 ? (
        <Text style={styles.emptyText}>No badges yet.</Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.badgeShelf}
        >
          {badges.map((ub) => {
            const meta = getBadgeMeta(ub.badge.name);
            return (
              <View
                key={ub.badge.id}
                style={[styles.badgePill, { backgroundColor: meta.bg }]}
              >
                <Text style={styles.badgePillEmoji}>{meta.emoji}</Text>
                <Text style={[styles.badgePillLabel, { color: meta.color }]}>
                  {ub.badge.name}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

function CategoryBreakdown({ categoryStats }: { categoryStats: ApiCategoryStat[] }) {
  const top3 = [...categoryStats]
    .sort((a, b) => b.accuracyScore - a.accuracyScore)
    .slice(0, 3);

  return (
    <View style={styles.card}>
      <Text style={[styles.sectionTitle, { marginBottom: spacing.md }]}>
        Category Breakdown
      </Text>
      {top3.map((cs) => (
        <View key={cs.category} style={styles.catBreakRow}>
          <Text style={styles.catBreakLabel}>{cs.category}</Text>
          <View style={styles.catBreakBarTrack}>
            <View
              style={[
                styles.catBreakBarFill,
                { width: `${Math.min(100, cs.accuracyScore)}%` },
              ]}
            />
          </View>
          <Text style={styles.catBreakPct}>{cs.accuracyScore.toFixed(0)}%</Text>
        </View>
      ))}
    </View>
  );
}

function CreatedMarketsSection({
  markets,
}: {
  markets: Array<{ id: string; title: string; status: AppMarketStatus }>;
}) {
  const router = useRouter();

  return (
    <View style={styles.card}>
      <Text style={[styles.sectionTitle, { marginBottom: spacing.md }]}>
        Recent Markets
      </Text>
      {markets.map((m) => {
        const meta = getMarketStatusMeta(m.status);
        return (
          <Pressable
            key={m.id}
            style={({ pressed }) => [
              styles.marketRow,
              pressed && styles.marketRowPressed,
            ]}
            onPress={() => router.push(`/market/${m.id}`)}
          >
            <Text style={[styles.marketTitle, { flex: 1 }]} numberOfLines={2}>
              {m.title}
            </Text>
            <View
              style={[
                styles.statusPill,
                { backgroundColor: meta.bg, marginLeft: spacing.sm },
              ]}
            >
              <Text style={[styles.statusPillText, { color: meta.color }]}>
                {meta.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function UserProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();

  const fetcher = useCallback(
    () => mobileApi.getUserProfile(username),
    [username]
  );
  const { data, loading, error, refetch } = useApiQuery<{ user: ApiUserProfile }>(
    fetcher,
    [username]
  );

  const headerTitle = username ? `@${username}` : "Profile";

  if (loading && !data) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            title: headerTitle,
            headerBackTitle: "Back",
            headerStyle: { backgroundColor: colors.background as string },
            headerTintColor: colors.text as string,
            headerShadowVisible: false,
          }}
        />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </>
    );
  }

  if (error || !data?.user) {
    const isNotFound = error?.includes("not found") || error?.includes("404");
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            title: headerTitle,
            headerBackTitle: "Back",
            headerStyle: { backgroundColor: colors.background as string },
            headerTintColor: colors.text as string,
            headerShadowVisible: false,
          }}
        />
        <View style={styles.center}>
          <Text style={styles.errorTitle}>
            {isNotFound ? "User not found" : "Failed to load profile"}
          </Text>
          <Text style={styles.errorSubtitle}>
            {isNotFound
              ? `@${username} doesn't exist or has been removed.`
              : "There was a problem loading this profile."}
          </Text>
          {!isNotFound && (
            <Pressable style={styles.retryBtn} onPress={refetch}>
              <Text style={styles.retryLabel}>Retry</Text>
            </Pressable>
          )}
          <Pressable style={[styles.retryBtn, styles.backBtn]} onPress={() => router.back()}>
            <Text style={styles.retryLabel}>Go Back</Text>
          </Pressable>
        </View>
      </>
    );
  }

  const user = data.user;
  const badges = user.badges ?? [];
  const categoryStats = user.categoryStats ?? [];
  const createdMarkets = user.createdMarkets ?? [];
  const totalPredictions = user.stats?.totalPredictions ?? 0;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: `@${user.username}`,
          headerBackTitle: "Back",
          headerStyle: { backgroundColor: colors.background as string },
          headerTintColor: colors.text as string,
          headerShadowVisible: false,
        }}
      />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.scrollContent}
      >
        {/* ── Header Card ── */}
        <View style={styles.headerCard}>
          <View style={styles.headerTop}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>
                {user.username.slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <View style={styles.headerRight}>
              <Text style={styles.username}>@{user.username}</Text>
              <View style={styles.tagRow}>
                {user.level != null && <Tag label={`Lv ${user.level}`} />}
                {(user.streak ?? 0) > 0 && (
                  <Tag label={`🔥 ${user.streak} streak`} accent />
                )}
              </View>
            </View>
          </View>

          {/* Reputation bar */}
          <View style={styles.repRow}>
            <Text style={styles.repLabel}>
              {user.reputationScore.toLocaleString()} reputation
            </Text>
            <View style={styles.repBarTrack}>
              <View
                style={[
                  styles.repBarFill,
                  {
                    width: `${Math.min(100, (user.reputationScore / 5000) * 100)}%`,
                  },
                ]}
              />
            </View>
          </View>
        </View>

        {/* ── Stats Row ── */}
        <View style={styles.statsCard}>
          <StatBox
            label="Accuracy"
            value={`${(user.accuracyScore ?? 0).toFixed(0)}%`}
          />
          <View style={styles.statDivider} />
          <StatBox
            label="Predictions"
            value={totalPredictions.toLocaleString()}
          />
          <View style={styles.statDivider} />
          <StatBox
            label="Reputation"
            value={user.reputationScore.toLocaleString()}
          />
        </View>

        {/* ── Badges ── */}
        <BadgesSection badges={badges} />

        {/* ── Category Breakdown ── */}
        {categoryStats.length > 0 && (
          <CategoryBreakdown categoryStats={categoryStats} />
        )}

        {/* ── Recent Created Markets ── */}
        {createdMarkets.length > 0 && (
          <CreatedMarketsSection markets={createdMarkets} />
        )}

        {/* Empty state when nothing to show */}
        {badges.length === 0 && categoryStats.length === 0 && createdMarkets.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyCardText}>
              This user hasn't made any public predictions yet.
            </Text>
          </View>
        )}
      </ScrollView>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background as string },
  scrollContent: {
    padding: spacing.xl,
    paddingBottom: spacing["2xl"],
    gap: spacing.lg,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: colors.background as string,
  },

  // Header card
  headerCard: {
    backgroundColor: colors.surface as string,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  headerTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent as string,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 20, fontWeight: "700", color: "#FFFFFF" },
  headerRight: { flex: 1 },
  username: { fontSize: 20, fontWeight: "700", color: colors.text as string },
  tagRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.xs, flexWrap: "wrap" },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.border as string,
  },
  tagAccent: { backgroundColor: "#FFF7ED" },
  tagText: { fontSize: 11, fontWeight: "600", color: colors.textMuted as string },

  // Reputation bar
  repRow: { marginTop: spacing.md },
  repLabel: { fontSize: 12, color: colors.textMuted as string, marginBottom: 6 },
  repBarTrack: {
    height: 6,
    backgroundColor: colors.border as string,
    borderRadius: 3,
    overflow: "hidden",
  },
  repBarFill: {
    height: "100%",
    backgroundColor: colors.accent as string,
    borderRadius: 3,
  },

  // Stats card (horizontal row)
  statsCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface as string,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  statBox: { flex: 1, alignItems: "center" },
  statValue: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text as string,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textMuted as string,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: colors.border as string,
  },

  // Generic card
  card: {
    backgroundColor: colors.surface as string,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text as string,
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted as string,
    paddingVertical: spacing.sm,
  },

  // Badges
  badgeShelf: { gap: spacing.sm, paddingVertical: spacing.xs },
  badgePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  badgePillEmoji: { fontSize: 14 },
  badgePillLabel: { fontSize: 12, fontWeight: "600" },

  // Category breakdown
  catBreakRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  catBreakLabel: {
    width: 68,
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted as string,
  },
  catBreakBarTrack: {
    flex: 1,
    height: 6,
    backgroundColor: colors.border as string,
    borderRadius: 3,
    overflow: "hidden",
  },
  catBreakBarFill: {
    height: "100%",
    backgroundColor: colors.accent as string,
    borderRadius: 3,
  },
  catBreakPct: {
    width: 36,
    fontSize: 12,
    fontWeight: "700",
    color: colors.text as string,
    textAlign: "right",
  },

  // Market rows
  marketRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border as string,
  },
  marketRowPressed: { opacity: 0.65 },
  marketTitle: {
    fontSize: 14,
    color: colors.text as string,
    fontWeight: "500",
    lineHeight: 20,
  },
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  statusPillText: { fontSize: 11, fontWeight: "600" },

  // Error / empty states
  errorTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text as string,
    textAlign: "center",
  },
  errorSubtitle: {
    fontSize: 14,
    color: colors.textMuted as string,
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accent as string,
  },
  backBtn: {
    backgroundColor: colors.surface as string,
    borderWidth: 1,
    borderColor: colors.border as string,
  },
  retryLabel: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
    textAlign: "center",
  },
  emptyCard: {
    backgroundColor: colors.surface as string,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
  },
  emptyCardText: {
    fontSize: 14,
    color: colors.textMuted as string,
    textAlign: "center",
    lineHeight: 20,
  },
});
