/**
 * CombinedAnalystCard
 *
 * Single-card surface combining "Call of the Week" (top: dark hero strip with the
 * editorial pick) and "Top Analysts This Week" (bottom: ranked rows) inside one
 * card chrome with a divider between the two sections.
 *
 * Edge-case rules:
 * - opinion === null → top section hidden entirely; card renders only the bottom.
 * - entries empty + not loading → empty-state copy ("Not enough resolved calls...").
 * - Divider only renders when BOTH opinion is non-null AND bottom section exists.
 */

import { Pressable, StyleSheet, Text, View } from "react-native";

import type {
  ApiFinanceBigCallOpinion,
  ApiTopExpertEntry,
} from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";
import { formatRelativeTime, freshnessColor } from "@predict-future/utils";

import { AnalystCredibilityBadge } from "@/components/analyst-credibility-badge";
import { getExpertInitials, getExpertInitialsColor } from "@/utils/expertAvatar";

// ─── Props ───────────────────────────────────────────────────────────────────

export type CombinedAnalystCardProps = {
  // Top section — Call of the Week
  opinion: ApiFinanceBigCallOpinion | null;
  windowLabel: string;
  onOpenOpinionDetail: () => void;

  // Bottom section — Top Analysts
  entries: ApiTopExpertEntry[];
  topLoading: boolean;
  onAnalystPress: (expertId: string) => void;
};

// ─── Internal sub-components ─────────────────────────────────────────────────

/** Skeleton row for a single analyst entry while top-weekly data loads. */
function RowSkeleton() {
  return (
    <View style={styles.rowSkeleton}>
      <View style={styles.skeletonRank} />
      <View style={styles.skeletonBadge} />
    </View>
  );
}

/** One analyst row: rank · AnalystCredibilityBadge · resolved call count. */
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
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${entry.expertName}, rank ${entry.rank}, ${hitRatePct}% accuracy`}
    >
      <Text style={styles.rank}>{entry.rank}.</Text>
      <View style={styles.badgeWrap}>
        <AnalystCredibilityBadge
          name={entry.expertName}
          organization={entry.organization}
          hitRate={entry.hitRate}
          resolvedCount={entry.resolvedCount}
          size="sm"
          layout="inline"
        />
      </View>
      <Text style={styles.callCount} numberOfLines={1}>
        {entry.resolvedCount} call{entry.resolvedCount !== 1 ? "s" : ""}
      </Text>
    </Pressable>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * CombinedAnalystCard
 *
 * Renders a single card with:
 *   - Top: "This Week's Big Call" dark hero strip (tappable → opinion detail)
 *   - Divider (only when top section is visible)
 *   - Bottom: ranked top-3 analysts (rows tappable → expert profile)
 *
 * If `opinion` is null, only the bottom section is rendered inside the card.
 */
export function CombinedAnalystCard({
  opinion,
  windowLabel,
  onOpenOpinionDetail,
  entries,
  topLoading,
  onAnalystPress,
}: CombinedAnalystCardProps) {
  const displayEntries = entries.slice(0, 3);

  // Derive hero section display values when opinion is present.
  const hero = opinion
    ? (() => {
        const dirConfig = {
          BULLISH: { label: "BULLISH", color: "#16a34a", bg: "#dcfce7" },
          BEARISH: { label: "BEARISH", color: "#dc2626", bg: "#fee2e2" },
          NEUTRAL: { label: "NEUTRAL", color: "#6b7280", bg: "#f3f4f6" },
        }[opinion.direction];

        const avatarBg = getExpertInitialsColor(
          opinion.expertName || opinion.expertOrganization
        );
        const initials = getExpertInitials(
          opinion.expertName,
          opinion.expertOrganization
        );
        const verdictLabel = opinion.isPostResolution
          ? "CALLED IT ✓"
          : dirConfig.label;
        const verdictColor = opinion.isPostResolution ? "#6366f1" : dirConfig.color;
        const verdictBg = opinion.isPostResolution ? "#ede9fe" : dirConfig.bg;

        return { dirConfig, avatarBg, initials, verdictLabel, verdictColor, verdictBg };
      })()
    : null;

  return (
    <View style={styles.card}>
      {/* ── Top section: Call of the Week ───────────────────────────────── */}
      {opinion !== null && hero !== null && (
        <Pressable
          style={({ pressed }) => [
            styles.heroSection,
            pressed && styles.heroSectionPressed,
          ]}
          onPress={onOpenOpinionDetail}
          accessibilityRole="button"
          accessibilityLabel={`${windowLabel}: ${opinion.expertName || opinion.expertOrganization}, ${hero.verdictLabel} on ${opinion.instrument ?? "market"}`}
        >
          {/* Label row */}
          <View style={styles.heroLabelRow}>
            <Text style={styles.heroLabel}>
              {"🔥"} {windowLabel.toUpperCase()}
            </Text>
            <Text style={styles.heroVoteHint}>Vote {"→"}</Text>
          </View>

          {/* Content row: avatar + name + verdict */}
          <View style={styles.heroContent}>
            <View style={[styles.heroAvatar, { backgroundColor: hero.avatarBg }]}>
              <Text style={styles.heroAvatarText}>{hero.initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.heroNameRow}>
                <Text style={styles.heroExpertName} numberOfLines={1}>
                  {opinion.expertName || opinion.expertOrganization}
                </Text>
                <Text
                  style={[
                    styles.heroCalledAt,
                    { color: freshnessColor(opinion.publishedAt) },
                  ]}
                >
                  {"·"} {formatRelativeTime(opinion.publishedAt)}
                </Text>
              </View>
              <View style={styles.heroVerdictRow}>
                <View
                  style={[
                    styles.heroVerdictPill,
                    { backgroundColor: hero.verdictBg },
                  ]}
                >
                  <Text
                    style={[
                      styles.heroVerdictText,
                      { color: hero.verdictColor },
                    ]}
                  >
                    {hero.verdictLabel}
                  </Text>
                </View>
                {opinion.instrument ? (
                  <Text style={styles.heroInstrument} numberOfLines={1}>
                    on {opinion.instrument}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        </Pressable>
      )}

      {/* Divider — only when both sections are present */}
      {opinion !== null && <View style={styles.divider} />}

      {/* ── Bottom section: Top Analysts ────────────────────────────────── */}
      <View style={styles.bottomSection}>
        <Text style={styles.bottomHeader}>Top analysts {"·"} this week</Text>

        <View style={styles.listArea}>
          {topLoading ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : displayEntries.length === 0 ? (
            <Text style={styles.emptyText}>
              Not enough resolved calls yet {"—"} check back soon.
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

      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },

  // ── Hero (top) section ──────────────────────────────────────────────────
  heroSection: {
    backgroundColor: "#0f172a",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  heroSectionPressed: {
    backgroundColor: "#1e293b",
  },
  heroLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  heroLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    color: "#a5b4fc",
  },
  heroVoteHint: {
    fontSize: 12,
    fontWeight: "800",
    color: "#fff",
    backgroundColor: "#4338ca",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  heroContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  heroAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  heroAvatarText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.4,
  },
  heroNameRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  heroExpertName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
    flexShrink: 1,
  },
  heroCalledAt: {
    fontSize: 11,
    fontWeight: "600",
    // color applied inline via freshnessColor()
  },
  heroVerdictRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
    flexWrap: "wrap",
  },
  heroVerdictPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  heroVerdictText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  heroInstrument: {
    fontSize: 12,
    fontWeight: "600",
    color: "#cbd5e1",
    flexShrink: 1,
  },

  // ── Divider ─────────────────────────────────────────────────────────────
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },

  // ── Bottom section ───────────────────────────────────────────────────────
  bottomSection: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bottomHeader: {
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
});
