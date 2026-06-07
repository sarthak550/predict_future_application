import { Feather, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, Share, StyleSheet, Text, View } from "react-native";

import type { ApiMarketSummary } from "@predict-future/types";
import { formatPercent, formatPoints, formatRelativeTime } from "@predict-future/utils";
import { colors, radius, shadows, spacing } from "@predict-future/ui-tokens";

import { mobileApi } from "@/lib/api";

type Props = {
  item: ApiMarketSummary;
  /** Called after a successful save toggle so parent can sync state. */
  onSaveToggled?: (marketId: string, saved: boolean) => void;
  /**
   * S55-T5: When true, suppresses the "Hosted by [Group]" chip and other
   * secondary metadata in dense / compact list contexts.
   */
  compact?: boolean;
};

async function shareMarket(item: ApiMarketSummary) {
  const url = `https://predictfuture.app/markets/${item.id}`;
  const message = `"${item.title}" — what do you think? Predict on Predict Future: ${url}`;
  await Share.share({ message, url });
}

export function MarketSummaryCard({ item, onSaveToggled, compact = false }: Props) {
  const router = useRouter();
  const [isSaved, setIsSaved] = useState(item.iSaved ?? false);
  const [savingInFlight, setSavingInFlight] = useState(false);
  const trust = item.creator?.stats?.hostTrustScore;
  const yesPool = item.yesPool ?? 0;
  const noPool = item.noPool ?? 0;
  const totalPool = yesPool + noPool;
  const yesProbability = totalPool > 0 ? yesPool / totalPool : 0.5;
  const isOpen = item.status === "OPEN";

  const handleToggleSave = async () => {
    if (savingInFlight) return;
    setSavingInFlight(true);
    const optimisticSaved = !isSaved;
    setIsSaved(optimisticSaved);
    try {
      const res = await mobileApi.toggleSaveMarket(item.id);
      setIsSaved(res.saved);
      onSaveToggled?.(item.id, res.saved);
    } catch {
      // Revert optimistic update on failure
      setIsSaved(!optimisticSaved);
    } finally {
      setSavingInFlight(false);
    }
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => router.push(`/market/${item.id}`)}
    >
      <View style={styles.topRow}>
        <View style={[styles.badge, isOpen ? styles.badgeOpen : styles.badgeClosed]}>
          <Text style={[styles.badgeText, isOpen ? styles.badgeTextOpen : styles.badgeTextClosed]}>
            {item.status}
          </Text>
        </View>
        {item.category ? (
          <Text style={styles.category}>{item.category}</Text>
        ) : null}
        <View style={styles.topRowActions}>
          <Pressable
            style={styles.bookmarkBtn}
            onPress={(e) => { e.stopPropagation?.(); void handleToggleSave(); }}
            hitSlop={8}
            accessibilityLabel={isSaved ? "Remove bookmark" : "Bookmark market"}
          >
            <Feather
              name={isSaved ? "bookmark" : "bookmark"}
              size={16}
              color={isSaved ? colors.accent : colors.textMuted}
            />
          </Pressable>
          <Pressable
            style={styles.shareBtn}
            onPress={(e) => { e.stopPropagation?.(); void shareMarket(item); }}
            hitSlop={8}
          >
            <Text style={styles.shareBtnText}>Share</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.title} numberOfLines={2}>{item.title}</Text>


      {item.description ? (
        <Text style={styles.description} numberOfLines={2}>{item.description}</Text>
      ) : null}

      {item.marketType === "NUMERIC" ? (
        <View style={styles.numericSection}>
          <Text style={styles.numericLabel}>Avg. Prediction</Text>
          <View style={styles.numericRow}>
            <Text style={styles.numericValue}>
              {item.averageNumericValue != null
                ? `${Number(item.averageNumericValue).toLocaleString(undefined, { maximumFractionDigits: 2 })}${item.unit ? ` ${item.unit}` : ""}`
                : "No guesses yet"}
            </Text>
            {(item.totalParticipants ?? 0) > 0 ? (
              <Text style={styles.numericGuesses}>
                {item.totalParticipants} {item.totalParticipants === 1 ? "guess" : "guesses"}
              </Text>
            ) : null}
          </View>
          {item.minValue != null && item.maxValue != null && item.averageNumericValue != null ? (
            <View style={styles.rangeTrack}>
              <View
                style={[
                  styles.rangeFill,
                  {
                    left: `${Math.max(0, Math.min(100, ((item.averageNumericValue - item.minValue) / (item.maxValue - item.minValue)) * 100))}%`,
                  },
                ]}
              />
            </View>
          ) : null}
          {item.minValue != null && item.maxValue != null ? (
            <View style={styles.rangeLabels}>
              <Text style={styles.rangeLabel}>{item.minValue}</Text>
              <Text style={styles.rangeLabel}>{item.maxValue}</Text>
            </View>
          ) : null}
        </View>
      ) : item.status === "RESOLVED" ? (
        // Resolved binary markets: show the final outcome chip instead of a probability bar.
        (() => {
          const resolvedSide = item.outcome ?? null;
          if (resolvedSide === "YES" || resolvedSide === "NO") {
            return (
              <View style={styles.outcomeRow}>
                <View
                  style={[
                    styles.outcomeChip,
                    resolvedSide === "YES" ? styles.outcomeChipYes : styles.outcomeChipNo,
                  ]}
                >
                  <Text style={[styles.outcomeChipText, { color: resolvedSide === "YES" ? "#16A34A" : "#DC2626" }]}>{`✓ Resolved ${resolvedSide}`}</Text>
                </View>
              </View>
            );
          }
          return null;
        })()
      ) : (
        <View style={styles.probabilitySection}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.max(6, yesProbability * 100)}%` }]} />
          </View>
          <View style={styles.probRow}>
            <Text style={styles.probYes}>YES {formatPercent(yesProbability)}</Text>
            <Text style={styles.probNo}>NO {formatPercent(1 - yesProbability)}</Text>
          </View>
        </View>
      )}

      <View style={styles.metricsRow}>
        <View style={styles.metricItem}>
          <Text style={styles.metricValue}>{formatPoints(item.totalVolume ?? 0)}</Text>
          <Text style={styles.metricLabel}>Volume</Text>
        </View>
        <View style={styles.metricItem}>
          <Text style={styles.metricValue}>{item.totalParticipants ?? 0}</Text>
          <Text style={styles.metricLabel}>Players</Text>
        </View>
        {typeof trust === "number" ? (
          <View style={styles.metricItem}>
            <Text style={styles.metricValue}>{trust}</Text>
            <Text style={styles.metricLabel}>Trust</Text>
          </View>
        ) : null}
        {item.closeAt ? (
          <View style={styles.metricItem}>
            <Text style={styles.metricValue}>{formatRelativeTime(item.closeAt)}</Text>
            <Text style={styles.metricLabel}>Closes</Text>
          </View>
        ) : null}
      </View>

      {/* S55-T5: Hosted by [Group] chip — shown when market belongs to a group and not in compact mode */}
      {!compact && item.group ? (
        <Pressable
          style={styles.hostedByChip}
          onPress={(e) => {
            e.stopPropagation?.();
            router.push(`/group/${item.group!.id}` as Parameters<typeof router.push>[0]);
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Hosted by ${item.group.name}`}
        >
          <Ionicons name="people-outline" size={11} color="#64748B" />
          <Text style={styles.hostedByText}>Hosted by {item.group.name}</Text>
        </Pressable>
      ) : null}

      {/* Host line — only for native markets (no originPlatform) */}
      {!item.originPlatform && item.creator?.username ? (
        <Text style={styles.host}>@{item.creator.username}</Text>
      ) : null}

      {/* Source attribution for imported markets */}
      {item.originPlatform != null && item.resolutionSourceUrl ? (
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            void Linking.openURL(item.resolutionSourceUrl as string);
          }}
          hitSlop={8}
        >
          <Text style={styles.sourceAttribution}>
            Source: {item.originPlatform.charAt(0).toUpperCase() + item.originPlatform.slice(1)} →
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flex: 1,
  },
  topRowActions: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  bookmarkBtn: {
    padding: 4,
  },
  shareBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: "#EEF2FF",
  },
  shareBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.primary,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  badgeOpen: {
    backgroundColor: "#DCFCE7",
  },
  badgeClosed: {
    backgroundColor: "#F3F4F6",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  badgeTextOpen: {
    color: "#16A34A",
  },
  badgeTextClosed: {
    color: "#6B7280",
  },
  category: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: colors.textMuted,
  },
  title: {
    marginTop: spacing.md,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 24,
    color: colors.text,
  },
  description: {
    marginTop: spacing.xs,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  manifoldBlock: {
    marginTop: spacing.xs,
    gap: 4,
  },
  manifoldBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  manifoldBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#6B7280",
    letterSpacing: 0.3,
  },
  crowdLine: {
    fontSize: 11,
    fontWeight: "500",
    color: "#6B7280",
  },
  numericSection: {
    marginTop: spacing.lg,
  },
  numericLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  numericRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 4,
  },
  numericValue: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.primary,
  },
  numericGuesses: {
    fontSize: 12,
    color: colors.textMuted,
  },
  rangeTrack: {
    marginTop: spacing.sm,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: "#E0E7FF",
    position: "relative",
    overflow: "visible",
  },
  rangeFill: {
    position: "absolute",
    top: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
    marginLeft: -6,
  },
  rangeLabels: {
    marginTop: 4,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rangeLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  probabilitySection: {
    marginTop: spacing.lg,
  },
  progressTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: "#FEE2E2",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: "#16A34A",
  },
  probRow: {
    marginTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  probYes: {
    fontSize: 13,
    fontWeight: "700",
    color: "#16A34A",
  },
  probNo: {
    fontSize: 13,
    fontWeight: "700",
    color: "#DC2626",
  },
  outcomeRow: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
  },
  outcomeChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  outcomeChipYes: {
    backgroundColor: "rgba(22,163,74,0.12)",
  },
  outcomeChipNo: {
    backgroundColor: "rgba(220,38,38,0.12)",
  },
  outcomeChipText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    color: "#16A34A",
  },
  metricsRow: {
    marginTop: spacing.lg,
    flexDirection: "row",
    gap: spacing.lg,
  },
  metricItem: {
    alignItems: "center",
  },
  metricValue: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  metricLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  // S55-T5: "Hosted by [Group]" chip
  hostedByChip: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  hostedByText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#64748B",
  },
  host: {
    marginTop: spacing.md,
    fontSize: 13,
    fontWeight: "600",
    color: colors.accent,
  },
  sourceAttribution: {
    marginTop: spacing.sm,
    fontSize: 11,
    fontWeight: "500",
    color: colors.textMuted,
  },
});
