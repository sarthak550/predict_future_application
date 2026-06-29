import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ApiMarketSummary } from "@predict-future/types";
import { formatPercent, formatPoints, formatRelativeTime } from "@predict-future/utils";
import { radius, spacing } from "@predict-future/ui-tokens";

import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";
import { mobileApi } from "@/lib/api";

type Props = {
  item: ApiMarketSummary;
  /** Called after a successful save toggle so parent can sync state. */
  onSaveToggled?: (marketId: string, saved: boolean) => void;
  /**
   * S55-T5: When true, suppresses secondary metadata in dense / compact list contexts.
   */
  compact?: boolean;
};

export function MarketSummaryCard({ item, onSaveToggled, compact = false }: Props) {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const [isSaved, setIsSaved] = useState(item.iSaved ?? false);
  const [savingInFlight, setSavingInFlight] = useState(false);
  const yesPool = item.yesPool ?? 0;
  const noPool = item.noPool ?? 0;
  const totalPool = yesPool + noPool;
  const yesProbability = totalPool > 0 ? yesPool / totalPool : 0.5;

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

  // ── BET STATS ────────────────────────────────────────────────────────────────

  const metaLine = (() => {
    const parts: string[] = [];
    if ((item.totalVolume ?? 0) > 0) parts.push(formatPoints(item.totalVolume ?? 0));
    if ((item.totalParticipants ?? 0) > 0) parts.push(`${item.totalParticipants} players`);
    if (item.closeAt) parts.push(`closes ${formatRelativeTime(item.closeAt)}`);
    return parts.join(" · ");
  })();

  const betStats = (() => {
    if (item.marketType === "NUMERIC") {
      const avgLabel =
        item.averageNumericValue != null
          ? `${Number(item.averageNumericValue).toLocaleString(undefined, { maximumFractionDigits: 2 })}${item.unit ? ` ${item.unit}` : ""}`
          : "No guesses yet";
      const guessCount =
        (item.totalParticipants ?? 0) > 0
          ? `${item.totalParticipants} ${item.totalParticipants === 1 ? "guess" : "guesses"}`
          : null;
      const numericMeta = [guessCount, item.closeAt ? `closes ${formatRelativeTime(item.closeAt)}` : null]
        .filter(Boolean)
        .join(" · ");
      return (
        <View style={styles.numericCompact}>
          <Text style={styles.numericAvg}>{avgLabel}</Text>
          {numericMeta ? <Text style={styles.metaText}>{numericMeta}</Text> : null}
        </View>
      );
    }

    if (item.status === "RESOLVED") {
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
              <Text
                style={[
                  styles.outcomeChipText,
                  { color: resolvedSide === "YES" ? "#16A34A" : "#DC2626" },
                ]}
              >{`✓ Resolved ${resolvedSide}`}</Text>
            </View>
            {metaLine ? <Text style={styles.metaText}>{metaLine}</Text> : null}
          </View>
        );
      }
      return null;
    }

    // Default: binary OPEN (or any non-numeric non-resolved)
    return (
      <View style={styles.binarySection}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.max(6, yesProbability * 100)}%` }]} />
        </View>
        <View style={styles.probRow}>
          <View style={styles.probLabels}>
            <Text style={styles.probYes}>YES {formatPercent(yesProbability)}</Text>
            <Text style={styles.probNo}> · NO {formatPercent(1 - yesProbability)}</Text>
          </View>
          {metaLine ? <Text style={styles.metaText}>{metaLine}</Text> : null}
        </View>
      </View>
    );
  })();

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => router.push(`/market/${item.id}`)}
    >
      {/* Top row: category tag (left) + bookmark (right) */}
      <View style={styles.topRow}>
        {item.category ? (
          <Text style={styles.category}>{item.category}</Text>
        ) : (
          <View />
        )}
        <Pressable
          style={styles.bookmarkBtn}
          onPress={(e) => { e.stopPropagation?.(); void handleToggleSave(); }}
          hitSlop={8}
          accessibilityLabel={isSaved ? "Remove bookmark" : "Bookmark market"}
        >
          <Feather
            name="bookmark"
            size={15}
            color={isSaved ? colors.pillarB : colors.textMuted}
          />
        </Pressable>
      </View>

      {/* Question */}
      <Text style={styles.title} numberOfLines={2}>{item.title}</Text>

      {/* Bet stats */}
      <View style={styles.statsContainer}>{betStats}</View>
    </Pressable>
  );
}

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...t.shadows.card,
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  category: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: t.colors.textMuted,
  },
  bookmarkBtn: {
    padding: 2,
  },
  title: {
    marginTop: spacing.sm,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 21,
    color: t.colors.text,
  },
  statsContainer: {
    marginTop: spacing.sm,
  },

  // ── Binary / OPEN ──────────────────────────────────────────────────────────
  binarySection: {
    gap: spacing.xs,
  },
  progressTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: t.colors.dangerSoft,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: t.colors.success,
  },
  probRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  probLabels: {
    flexDirection: "row",
    alignItems: "center",
  },
  probYes: {
    fontSize: 12,
    fontWeight: "700",
    color: t.colors.success,
  },
  probNo: {
    fontSize: 12,
    fontWeight: "700",
    color: t.colors.danger,
  },

  // ── Numeric ────────────────────────────────────────────────────────────────
  numericCompact: {
    gap: 2,
  },
  numericAvg: {
    fontSize: 14,
    fontWeight: "700",
    color: t.colors.primary,
  },

  // ── Resolved ──────────────────────────────────────────────────────────────
  outcomeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  outcomeChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
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
  },

  // ── Shared meta ───────────────────────────────────────────────────────────
  metaText: {
    fontSize: 11,
    color: t.colors.textMuted,
    flexShrink: 1,
  },
});
