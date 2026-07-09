import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ApiExpertLeaderboardEntry } from "@predict-future/types";
import { radius, spacing } from "@predict-future/ui-tokens";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

import { mobileApi } from "@/lib/api";
import { getExpertInitials, getExpertInitialsColor } from "@/utils/expertAvatar";
import { AnalystCredibilityBadge } from "@/components/analyst-credibility-badge";

const makeLbStyles = (t: ThemeContextValue) => StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  subtitle: {
    fontSize: 12,
    color: t.colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
    backgroundColor: t.colors.background,
  },
  rank: {
    width: 32,
    fontSize: 13,
    fontWeight: "700",
    color: t.colors.textMuted,
    textAlign: "center",
  },
  rankTop: { color: t.colors.warning },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#818CF8",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: { fontSize: 14, fontWeight: "800", color: "#fff" },
  nameBlock: { flex: 1, gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  expertName: { fontSize: 14, fontWeight: "700", color: t.colors.text, flexShrink: 1 },
  orgName: { fontSize: 11, color: t.colors.textMuted },
  verifiedBadge: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  verifiedText: { fontSize: 8, fontWeight: "800", color: "#fff", lineHeight: 12 },
  barTrack: {
    flexDirection: "row",
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
    marginTop: 4,
    backgroundColor: t.colors.border,
  },
  barHit: { backgroundColor: "#16a34a" },
  barMiss: { backgroundColor: "#dc2626" },
  credBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    minWidth: 44,
    alignItems: "center",
  },
  credText: { fontSize: 12, fontWeight: "800" },
  emptyContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    color: t.colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
});

function HitMissBar({ hitCount, missCount }: { hitCount: number; missCount: number }) {
  const lbStyles = useThemedStyles(makeLbStyles);
  const total = hitCount + missCount;
  if (total === 0) return null;
  const hitPct = hitCount / total;

  return (
    <View style={lbStyles.barTrack}>
      <View style={[lbStyles.barHit, { flex: hitPct }]} />
      <View style={[lbStyles.barMiss, { flex: 1 - hitPct }]} />
    </View>
  );
}

function LeaderboardRow({ entry }: { entry: ApiExpertLeaderboardEntry }) {
  const router = useRouter();
  const lbStyles = useThemedStyles(makeLbStyles);
  const { rank, expert } = entry;
  const displayName = expert.name || expert.organization;
  const initials = getExpertInitials(expert.name, expert.organization);
  const initialsColor = getExpertInitialsColor(expert.name || expert.organization);

  return (
    <Pressable
      style={lbStyles.row}
      onPress={() => router.push(`/expert/${expert.id}`)}
    >
      {/* Rank */}
      <Text style={[lbStyles.rank, rank <= 3 && lbStyles.rankTop]}>{`#${rank}`}</Text>

      {/* Avatar */}
      {expert.avatarUrl ? (
        <Image source={{ uri: expert.avatarUrl }} style={lbStyles.avatar} />
      ) : (
        <View style={[lbStyles.avatarFallback, { backgroundColor: initialsColor }]}>
          <Text style={lbStyles.avatarInitials}>{initials}</Text>
        </View>
      )}

      {/* Name + credibility badge (inline) + hit/miss bar */}
      <View style={lbStyles.nameBlock}>
        <AnalystCredibilityBadge
          name={displayName}
          organization={expert.name && expert.organization ? expert.organization : undefined}
          hitRate={expert.credibilityScore}
          resolvedCount={expert.hitCount + expert.missCount}
          size="sm"
          layout="inline"
          onPress={() => router.push(`/expert/${expert.id}`)}
        />
        <HitMissBar hitCount={expert.hitCount} missCount={expert.missCount} />
      </View>
    </Pressable>
  );
}

export default function ExpertLeaderboardScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const lbStyles = useThemedStyles(makeLbStyles);
  const [entries, setEntries] = useState<ApiExpertLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await mobileApi.getExpertLeaderboard();
      setEntries(data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Top Finance Experts",
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/expert-search")}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ marginRight: 4 }}
            >
              <Text style={{ fontSize: 20 }}>🔍</Text>
            </Pressable>
          ),
        }}
      />
      {loading ? (
        <View style={lbStyles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.expert.id}
          ListHeaderComponent={
            <Text style={lbStyles.subtitle}>
              Ranked by verified accuracy (resolved calls only)
            </Text>
          }
          renderItem={({ item }) => <LeaderboardRow entry={item} />}
          ListEmptyComponent={
            <View style={lbStyles.emptyContainer}>
              <Text style={lbStyles.emptyText}>
                No experts have enough resolved calls yet. Check back soon.
              </Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(true)}
              tintColor={colors.accent}
            />
          }
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      )}
    </View>
  );
}
