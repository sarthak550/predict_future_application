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
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { mobileApi } from "@/lib/api";
import { getExpertInitials, getExpertInitialsColor } from "@/utils/expertAvatar";

function credibilityColor(score: number): string {
  if (score >= 0.6) return "#16a34a";
  if (score >= 0.4) return "#d97706";
  return "#dc2626";
}

function HitMissBar({ hitCount, missCount }: { hitCount: number; missCount: number }) {
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
  const { rank, expert } = entry;
  const initials = getExpertInitials(expert.name, expert.organization);
  const initialsColor = getExpertInitialsColor(expert.name || expert.organization);
  const scoreColor = credibilityColor(expert.credibilityScore ?? 0);
  const displayName = expert.name || expert.organization;

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

      {/* Name + org + bar */}
      <View style={lbStyles.nameBlock}>
        <View style={lbStyles.nameRow}>
          <Text style={lbStyles.expertName} numberOfLines={1}>{displayName}</Text>
          {expert.verified && (
            <View style={lbStyles.verifiedBadge}>
              <Text style={lbStyles.verifiedText}>✓</Text>
            </View>
          )}
        </View>
        {expert.name && expert.organization ? (
          <Text style={lbStyles.orgName} numberOfLines={1}>{expert.organization}</Text>
        ) : null}
        <HitMissBar hitCount={expert.hitCount} missCount={expert.missCount} />
      </View>

      {/* Credibility badge */}
      {expert.credibilityScore !== null && (
        <View style={[lbStyles.credBadge, { backgroundColor: scoreColor + "20" }]}>
          <Text style={[lbStyles.credText, { color: scoreColor }]}>
            {Math.round(expert.credibilityScore * 100)}%
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export default function ExpertLeaderboardScreen() {
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
      <Stack.Screen options={{ title: "Top Finance Experts" }} />
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
              Ranked by retrospective accuracy (resolved calls only)
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

const lbStyles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
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
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  rank: {
    width: 32,
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
    textAlign: "center",
  },
  rankTop: { color: "#d97706" },
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
  expertName: { fontSize: 14, fontWeight: "700", color: colors.text, flexShrink: 1 },
  orgName: { fontSize: 11, color: colors.textMuted },
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
    backgroundColor: colors.border,
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
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
});
