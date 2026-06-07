/**
 * TopAnalystsCard — S50-T2
 *
 * Always-visible inline 3-row card showing the top analysts this week.
 * Anchored in Finance Mode below BigCallHeroCard. Does NOT own its own
 * fetch — data is passed in as props from the Finance Mode parent.
 *
 * Replaces the TopAnalystsSheet (S49-T5) which was triggered by a tap on the
 * BigCallCard footer. That sheet has been deleted (S50-T4). The inline card
 * is always visible to Finance tab visitors without requiring any tap.
 */

import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import type { ApiTopExpertEntry } from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { AnalystCredibilityBadge } from "@/components/analyst-credibility-badge";
import { mobileApi } from "@/lib/api";

export type TopAnalystsCardProps = {
  /** Up to 3 analyst entries ranked by hit rate this week. Empty array = no qualifying data. */
  entries: ApiTopExpertEntry[];
  /** True while the initial fetch is in flight — renders 3 skeleton rows. */
  loading: boolean;
  /** Called when the "See all" footer link is tapped. */
  onLeaderboardPress: () => void;
  /** Called when an analyst row is tapped — receives the expert's ID. */
  onAnalystPress: (expertId: string) => void;
};

/**
 * Skeleton placeholder row — shown while top-weekly data is loading.
 * Matches the visual weight of RowSkeleton in the now-deleted top-analysts-sheet.tsx.
 */
function RowSkeleton() {
  return (
    <View style={cardStyles.rowSkeleton}>
      <View style={cardStyles.skeletonRank} />
      <View style={cardStyles.skeletonBadge} />
    </View>
  );
}

/**
 * A single analyst row inside the card.
 * Tappable — calls onAnalystPress with the expert's ID.
 */
function AnalystRow({
  entry,
  onPress,
}: {
  entry: ApiTopExpertEntry;
  onPress: () => void;
}) {
  const hitRatePct = Math.round(entry.hitRate * 100);
  return (
    <Pressable
      style={({ pressed }) => [cardStyles.row, pressed && cardStyles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${entry.expertName}, rank ${entry.rank}, ${hitRatePct}% accuracy`}
    >
      {/* Rank number */}
      <Text style={cardStyles.rank}>{entry.rank}.</Text>

      {/* Credibility badge — size "sm", inline layout for compact single-row display */}
      <View style={cardStyles.badgeWrap}>
        <AnalystCredibilityBadge
          name={entry.expertName}
          organization={entry.organization}
          hitRate={entry.hitRate}
          resolvedCount={entry.resolvedCount}
          size="sm"
          layout="inline"
        />
      </View>

      {/* Resolved call count */}
      <Text style={cardStyles.callCount} numberOfLines={1}>
        {entry.resolvedCount} call{entry.resolvedCount !== 1 ? "s" : ""}
      </Text>
    </Pressable>
  );
}

/**
 * TopAnalystsCard — always-visible inline card for the Finance tab.
 *
 * Loading: renders 3 skeleton rows.
 * Empty (entries is []): renders header + empty-state copy. Card still renders
 *   (header visible) so there is no layout jump when data arrives.
 * Populated: renders up to 3 rows + "See all →" footer link.
 */
export function TopAnalystsCard({
  entries,
  loading,
  onLeaderboardPress,
  onAnalystPress,
}: TopAnalystsCardProps) {
  const displayEntries = entries.slice(0, 3);

  const handleLeaderboardPress = () => {
    void mobileApi.track("analysts_leaderboard_card_tapped").catch(() => {});
    onLeaderboardPress();
  };

  return (
    <View style={cardStyles.card}>
      {/* Header */}
      <Text style={cardStyles.header}>Top analysts · this week</Text>

      {/* Rows area */}
      <View style={cardStyles.listArea}>
        {loading ? (
          <>
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </>
        ) : displayEntries.length === 0 ? (
          <Text style={cardStyles.emptyText}>
            Not enough resolved calls yet — check back soon.
          </Text>
        ) : (
          displayEntries.map((entry) => (
            <AnalystRow
              key={entry.expertId}
              entry={entry}
              onPress={() => onAnalystPress(entry.expertId)}
            />
          ))
        )}
      </View>

      {/* Footer leaderboard link — hidden when loading or empty */}
      {!loading && displayEntries.length > 0 && (
        <Pressable
          style={({ pressed }) => [cardStyles.leaderboardLink, pressed && cardStyles.leaderboardLinkPressed]}
          onPress={handleLeaderboardPress}
          accessibilityRole="link"
          accessibilityLabel="See full analyst leaderboard"
        >
          <Text style={cardStyles.leaderboardLinkText}>See all →</Text>
        </Pressable>
      )}
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    fontSize: 11,
    fontWeight: "500",
    color: colors.textMuted,
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  listArea: {
    gap: 3,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 5,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    gap: spacing.sm,
  },
  rowPressed: {
    backgroundColor: colors.background,
  },
  rank: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    minWidth: 20,
  },
  badgeWrap: {
    flex: 1,
  },
  callCount: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "500",
    minWidth: 44,
    textAlign: "right",
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: "center",
    paddingVertical: spacing.md,
    lineHeight: 18,
  },
  rowSkeleton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 5,
    paddingHorizontal: spacing.xs,
    gap: spacing.sm,
  },
  skeletonRank: {
    width: 20,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.border,
  },
  skeletonBadge: {
    flex: 1,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.border,
  },
  leaderboardLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    paddingVertical: spacing.xs,
  },
  leaderboardLinkPressed: {
    opacity: 0.6,
  },
  leaderboardLinkText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.accent,
  },
});
