import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ApiExpertCall, ApiExpertProfile } from "@predict-future/types";
import { radius, spacing } from "@predict-future/ui-tokens";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

import { mobileApi } from "@/lib/api";
import { withRetry } from "@/lib/retry";
import { getExpertInitials, getExpertInitialsColor } from "@/utils/expertAvatar";
import { AnalystCredibilityBadge } from "@/components/analyst-credibility-badge";


const DIRECTION_LABEL: Record<string, string> = {
  BULLISH: "Bullish",
  BEARISH: "Bearish",
  NEUTRAL: "Neutral",
};

const DIRECTION_COLOR: Record<string, string> = {
  BULLISH: "#16a34a",
  BEARISH: "#dc2626",
  NEUTRAL: "#6b7280",
};

const RESOLUTION_LABEL: Record<string, string> = {
  PENDING: "Pending",
  RESOLVED_HIT: "Hit",
  RESOLVED_MISS: "Miss",
  NOT_GRADED: "Ungraded",
};

const RESOLUTION_COLOR: Record<string, string> = {
  RESOLVED_HIT: "#16a34a",
  RESOLVED_MISS: "#dc2626",
  PENDING: "#6b7280",
  NOT_GRADED: "#9ca3af",
};

const makeExpertProfileStyles = (t: ThemeContextValue) => StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorText: { color: "#dc2626", fontSize: 15, padding: spacing.lg, textAlign: "center" },
  headerSection: { padding: spacing.lg },
  avatarRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg, alignItems: "flex-start" },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: { fontSize: 18, fontWeight: "800", color: "#fff" },
  nameBlock: { flex: 1, gap: 4 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  expertName: { fontSize: 18, fontWeight: "800", color: t.colors.text, flexShrink: 1 },
  verifiedInlineBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  verifiedInlineText: { fontSize: 9, fontWeight: "800", color: "#fff", lineHeight: 14 },
  orgName: { fontSize: 13, color: t.colors.textMuted },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  verifiedBadge: {
    backgroundColor: "#eff6ff",
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  verifiedText: { fontSize: 11, fontWeight: "700", color: "#2563eb" },
  credBadge: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  credBadgeText: { fontSize: 11, fontWeight: "700" },
  provisionalBadge: {
    backgroundColor: t.colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  provisionalText: { fontSize: 10, color: t.colors.textMuted, fontStyle: "italic" },
  statsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  statTile: {
    flex: 1,
    backgroundColor: t.colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    alignItems: "center",
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  statValue: { fontSize: 18, fontWeight: "800", color: t.colors.text },
  statLabel: { fontSize: 10, color: t.colors.textMuted, marginTop: 2 },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: t.colors.text, marginBottom: spacing.sm },
  callRow: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    backgroundColor: t.colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  callStoryHeadline: {
    fontSize: 11,
    fontWeight: "700",
    color: t.colors.accent,
    marginBottom: 4,
  },
  callQuote: { fontSize: 13, color: t.colors.text, lineHeight: 18, marginBottom: 6 },
  callMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 4 },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill },
  badgeText: { fontSize: 10, fontWeight: "700" },
  crowdNote: { fontSize: 10, color: t.colors.textMuted, alignSelf: "center" },
  callFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  callDate: { fontSize: 10, color: t.colors.textMuted },
  callReadMore: { fontSize: 10, fontWeight: "700", color: t.colors.accent },
  emptyText: { textAlign: "center", color: t.colors.textMuted, padding: spacing.lg },
  filterRow: { marginBottom: spacing.md },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surface,
  },
  filterChipText: { fontSize: 12, fontWeight: "700", color: t.colors.textMuted },
  resolutionNote: {
    borderLeftWidth: 2,
    paddingLeft: 8,
    marginBottom: 6,
    marginTop: 2,
  },
  resolutionNoteText: { fontSize: 11, color: t.colors.textMuted, fontStyle: "italic", lineHeight: 16 },
  loadMoreBtn: { margin: spacing.lg, alignItems: "center" },
  loadMoreText: { fontSize: 13, fontWeight: "700", color: t.colors.accent },
});

function CallRow({ call }: { call: ApiExpertCall }) {
  const router = useRouter();
  const expertProfileStyles = useThemedStyles(makeExpertProfileStyles);
  const dirColor = DIRECTION_COLOR[call.direction] ?? "#6b7280";
  const dirLabel = DIRECTION_LABEL[call.direction] ?? call.direction;
  const resColor = RESOLUTION_COLOR[call.resolutionStatus] ?? "#6b7280";
  const resLabel = RESOLUTION_LABEL[call.resolutionStatus] ?? call.resolutionStatus;

  const handlePress = () => {
    if (call.storyId) {
      router.push(`/story/${call.storyId}` as Parameters<typeof router.push>[0]);
    }
  };

  return (
    <Pressable
      style={({ pressed }) => [expertProfileStyles.callRow, pressed && { opacity: 0.75 }]}
      onPress={handlePress}
      disabled={!call.storyId}
    >
      {call.storyHeadline ? (
        <Text style={expertProfileStyles.callStoryHeadline} numberOfLines={1}>
          {call.storyHeadline}
        </Text>
      ) : null}
      <Text style={expertProfileStyles.callQuote}>
        {call.quote}
      </Text>
      <View style={expertProfileStyles.callMeta}>
        <View style={[expertProfileStyles.badge, { backgroundColor: dirColor + "20" }]}>
          <Text style={[expertProfileStyles.badgeText, { color: dirColor }]}>{dirLabel}</Text>
        </View>
        <View style={[expertProfileStyles.badge, { backgroundColor: resColor + "20" }]}>
          <Text style={[expertProfileStyles.badgeText, { color: resColor }]}>{resLabel}</Text>
        </View>
      </View>
      {call.resolutionNote && call.resolutionStatus !== "PENDING" && call.resolutionStatus !== "NOT_GRADED" ? (
        <View style={[expertProfileStyles.resolutionNote, { borderLeftColor: resColor }]}>
          <Text style={expertProfileStyles.resolutionNoteText}>{call.resolutionNote}</Text>
        </View>
      ) : null}
      <View style={expertProfileStyles.callFooter}>
        <Text style={expertProfileStyles.callDate}>
          {"Called "}
          {new Date(call.publishedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          {call.resolvedAt && (call.resolutionStatus === "RESOLVED_HIT" || call.resolutionStatus === "RESOLVED_MISS")
            ? `  ·  Resolved ${new Date(call.resolvedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
            : ""}
        </Text>
        {call.storyId ? (
          <Text style={expertProfileStyles.callReadMore}>Read article →</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function ExpertProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const expertProfileStyles = useThemedStyles(makeExpertProfileStyles);

  const [profile, setProfile] = useState<ApiExpertProfile | null>(null);
  const [calls, setCalls] = useState<ApiExpertCall[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callFilter, setCallFilter] = useState<"ALL" | "RESOLVED_HIT" | "RESOLVED_MISS" | "PENDING">("ALL");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const [profileData, callsData] = await Promise.all([
          withRetry(() => mobileApi.getExpertProfile(id)),
          withRetry(() => mobileApi.getExpertCalls(id)),
        ]);
        if (cancelled) return;
        setProfile(profileData);
        setCalls(callsData.items);
        setNextCursor(callsData.nextCursor);
      } catch {
        if (!cancelled) setError("Expert not found.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore || !id) return;
    setLoadingMore(true);
    try {
      const data = await withRetry(() => mobileApi.getExpertCalls(id, { cursor: nextCursor }));
      setCalls((prev) => {
        const existingIds = new Set(prev.map((c) => c.id));
        return [...prev, ...data.items.filter((c) => !existingIds.has(c.id))];
      });
      setNextCursor(data.nextCursor);
    } catch (err) {
      // Don't leave an unhandled rejection — keep the cursor so the user can tap "Load more" again.
      console.error("[expert] loadMore failed:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  const displayName = profile ? (profile.name || profile.organization) : "Expert";

  const filteredCalls = useMemo(() => {
    if (callFilter === "ALL") return calls;
    if (callFilter === "PENDING") return calls.filter((c) => c.resolutionStatus === "PENDING" || c.resolutionStatus === "NOT_GRADED");
    return calls.filter((c) => c.resolutionStatus === callFilter);
  }, [calls, callFilter]);

  if (loading) {
    return (
      <View style={expertProfileStyles.center}>
        <Stack.Screen options={{ headerShown: true, title: "Expert Profile" }} />
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={expertProfileStyles.center}>
        <Stack.Screen options={{ headerShown: true, title: "Expert Profile" }} />
        <Text style={expertProfileStyles.errorText}>{error ?? "Expert not found."}</Text>
      </View>
    );
  }

  const initials = getExpertInitials(profile.name, profile.organization);
  const initialsColor = getExpertInitialsColor(profile.name || profile.organization);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: true, title: displayName, headerBackTitle: "Back" }} />
      <FlatList
        keyExtractor={(c) => c.id}
        ListHeaderComponent={
          <View style={expertProfileStyles.headerSection}>
            {/* Avatar */}
            <View style={expertProfileStyles.avatarRow}>
              {profile.avatarUrl ? (
                <Image source={{ uri: profile.avatarUrl }} style={expertProfileStyles.avatar} />
              ) : (
                <View style={[expertProfileStyles.avatarFallback, { backgroundColor: initialsColor }]}>
                  <Text style={expertProfileStyles.avatarInitials}>{initials}</Text>
                </View>
              )}
              <View style={expertProfileStyles.nameBlock}>
                <AnalystCredibilityBadge
                  name={displayName}
                  organization={profile.name && profile.organization ? profile.organization : undefined}
                  hitRate={profile.credibilityScore}
                  resolvedCount={profile.resolvedCount}
                  size="md"
                />
                {profile.credibilityScore === null && (
                  <View style={expertProfileStyles.provisionalBadge}>
                    <Text style={expertProfileStyles.provisionalText}>
                      Provisional — fewer than 3 resolved calls
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Stats row */}
            <View style={expertProfileStyles.statsRow}>
              <View style={expertProfileStyles.statTile}>
                <Text style={expertProfileStyles.statValue}>{profile.totalOpinions}</Text>
                <Text style={expertProfileStyles.statLabel}>Total Calls</Text>
              </View>
              <View style={expertProfileStyles.statTile}>
                <Text style={expertProfileStyles.statValue}>{profile.resolvedCount}</Text>
                <Text style={expertProfileStyles.statLabel}>Resolved</Text>
              </View>
              <View style={expertProfileStyles.statTile}>
                <Text style={expertProfileStyles.statValue}>
                  {profile.credibilityScore !== null
                    ? `${Math.round(profile.credibilityScore * 100)}%`
                    : "—"}
                </Text>
                <Text style={expertProfileStyles.statLabel}>Hit Rate</Text>
              </View>
              <View style={expertProfileStyles.statTile}>
                <Text style={expertProfileStyles.statValue}>
                  {profile.followerCount >= 1000
                    ? `${(profile.followerCount / 1000).toFixed(1)}k`
                    : profile.followerCount}
                </Text>
                <Text style={expertProfileStyles.statLabel}>Followers</Text>
              </View>
            </View>

            <Text style={expertProfileStyles.sectionTitle}>Calls</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={expertProfileStyles.filterRow}
              contentContainerStyle={{ gap: 8 }}
            >
              {(
                [
                  { key: "ALL", label: "All" },
                  { key: "RESOLVED_HIT", label: "Hit ✓" },
                  { key: "RESOLVED_MISS", label: "Miss ✗" },
                  { key: "PENDING", label: "Pending" },
                ] as const
              ).map(({ key, label }) => {
                const isActive = callFilter === key;
                const chipColor =
                  key === "RESOLVED_HIT" ? "#16a34a" :
                  key === "RESOLVED_MISS" ? "#dc2626" :
                  colors.accent;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setCallFilter(key)}
                    style={[
                      expertProfileStyles.filterChip,
                      isActive && { backgroundColor: chipColor, borderColor: chipColor },
                    ]}
                  >
                    <Text style={[expertProfileStyles.filterChipText, isActive && { color: "#fff" }]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        }
        renderItem={({ item }) => <CallRow call={item} />}
        data={filteredCalls}
        ListEmptyComponent={
          <Text style={expertProfileStyles.emptyText}>
            {callFilter === "ALL" ? "No calls yet." : "No calls matching this filter."}
          </Text>
        }
        ListFooterComponent={
          nextCursor ? (
            <Pressable style={expertProfileStyles.loadMoreBtn} onPress={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Text style={expertProfileStyles.loadMoreText}>Load more</Text>
              )}
            </Pressable>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: 32 }}
      />
    </View>
  );
}
