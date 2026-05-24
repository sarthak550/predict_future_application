/**
 * ExpertOpinion detail screen — dedicated view for a single ExpertOpinion,
 * independent of any Market. Reached by tapping "Today's Big Call" hero from
 * the finance feed. Renders expert header, quote, source link, and Poll A
 * (agreement). Admin resolution is shown as a badge when present.
 */

import { Feather } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type {
  ApiExpertOpinionTallies,
  ApiFinanceOpinionDetail,
  ApiImplicationChoice,
} from "@predict-future/types";

import { mobileApi } from "@/lib/api";
import { useApiQuery } from "@/hooks/useApiQuery";
import { colors, radius, spacing } from "@predict-future/ui-tokens";
import { formatRelativeTime } from "@predict-future/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const IMPLICATION_OPTIONS: { key: ApiImplicationChoice; label: string; color: string }[] = [
  { key: "STRONGLY_DISAGREE", label: "Strongly Disagree", color: "#dc2626" },
  { key: "DISAGREE", label: "Disagree", color: "#f87171" },
  { key: "NEUTRAL", label: "Neutral", color: "#6b7280" },
  { key: "AGREE", label: "Agree", color: "#4ade80" },
  { key: "STRONGLY_AGREE", label: "Strongly Agree", color: "#16a34a" },
];

const DIRECTION_STYLE: Record<
  ApiFinanceOpinionDetail["direction"],
  { label: string; bg: string; fg: string }
> = {
  BULLISH: { label: "BULLISH", bg: "#dcfce7", fg: "#15803d" },
  BEARISH: { label: "BEARISH", bg: "#fee2e2", fg: "#b91c1c" },
  NEUTRAL: { label: "NEUTRAL", bg: "#f3f4f6", fg: "#374151" },
};

function implCount(tallies: ApiExpertOpinionTallies, choice: ApiImplicationChoice): number {
  switch (choice) {
    case "STRONGLY_DISAGREE":
      return tallies.implication.stronglyDisagree;
    case "DISAGREE":
      return tallies.implication.disagree;
    case "NEUTRAL":
      return tallies.implication.neutral;
    case "AGREE":
      return tallies.implication.agree;
    case "STRONGLY_AGREE":
      return tallies.implication.stronglyAgree;
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function OpinionDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const opinionId = typeof id === "string" ? id : "";
  const insets = useSafeAreaInsets();

  const opinionFetcher = useCallback(() => mobileApi.getFinanceOpinion(opinionId), [opinionId]);
  const opinionQuery = useApiQuery<ApiFinanceOpinionDetail>(opinionFetcher, [opinionId], {
    enabled: Boolean(opinionId),
  });

  const [tallies, setTallies] = useState<ApiExpertOpinionTallies | null>(null);
  const [tallyError, setTallyError] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);

  const loadTallies = useCallback(() => {
    if (!opinionId) return;
    setTallyError(null);
    mobileApi
      .getExpertOpinionTallies(opinionId)
      .then(setTallies)
      .catch((err) => setTallyError(err?.message ?? "Couldn't load votes."));
  }, [opinionId]);

  useEffect(() => {
    loadTallies();
  }, [loadTallies]);

  const castImplication = useCallback(
    async (choice: ApiImplicationChoice) => {
      if (voting) return;
      setVoting(true);
      try {
        const updated = await mobileApi.castExpertOpinionVote(opinionId, {
          pollType: "IMPLICATION",
          choice,
        });
        setTallies(updated);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Vote failed.";
        setTallyError(msg);
      } finally {
        setVoting(false);
      }
    },
    [opinionId, voting]
  );

  const lockVote = useCallback(async () => {
    if (voting) return;
    setVoting(true);
    setTallyError(null);
    try {
      const updated = await mobileApi.lockExpertOpinionVote(opinionId);
      setTallies(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't lock vote.";
      setTallyError(msg);
    } finally {
      setVoting(false);
    }
  }, [opinionId, voting]);

  const refetchAll = useCallback(() => {
    opinionQuery.refetch();
    loadTallies();
  }, [opinionQuery, loadTallies]);

  if (!opinionId || opinionQuery.status === "loading") {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Opinion" }} />
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (opinionQuery.status === "error" || !opinionQuery.data) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Opinion" }} />
        <Text style={styles.errorText}>{opinionQuery.error ?? "Couldn't load opinion."}</Text>
        <Pressable onPress={opinionQuery.refetch} style={styles.retryBtn}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const opinion = opinionQuery.data;
  const dirStyle = DIRECTION_STYLE[opinion.direction];
  const isResolved = opinion.resolutionStatus !== "PENDING";
  const initial = opinion.expertName?.[0]?.toUpperCase() ?? "?";

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={refetchAll} />}
    >
      <Stack.Screen options={{ title: "Expert Opinion" }} />

      {/* Expert header — tappable, opens expert profile */}
      <Pressable
        style={styles.header}
        onPress={() =>
          router.push(`/expert/${opinion.expertId}` as Parameters<typeof router.push>[0])
        }
        hitSlop={4}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.expertName} numberOfLines={1}>
            {opinion.expertName}
          </Text>
          <Text style={styles.expertOrg} numberOfLines={1}>
            {opinion.expertOrganization}
          </Text>
          <Text style={styles.metaLine}>
            {opinion.analystTier === "CHIEF_ANALYST" ? "Verified Analyst · " : ""}
            {formatRelativeTime(opinion.publishedAt)}
            {"  ·  View profile →"}
          </Text>
        </View>
        <View style={[styles.dirBadge, { backgroundColor: dirStyle.bg }]}>
          <Text style={[styles.dirBadgeText, { color: dirStyle.fg }]}>{dirStyle.label}</Text>
        </View>
      </Pressable>

      {/* Headline + instrument */}
      {opinion.headline && <Text style={styles.headline}>{opinion.headline}</Text>}
      {opinion.instrument && (
        <View style={styles.instrumentRow}>
          <Feather name="bar-chart-2" size={14} color={colors.textMuted} />
          <Text style={styles.instrumentText}>
            {opinion.instrument}
            {opinion.instrumentTicker ? ` · ${opinion.instrumentTicker}` : ""}
          </Text>
        </View>
      )}

      {/* Quote */}
      <View style={styles.quoteCard}>
        <Text style={styles.quoteText}>{opinion.quote}</Text>
      </View>

      {/* Resolution badge */}
      {isResolved && (
        <View
          style={[
            styles.resolutionCard,
            {
              backgroundColor:
                opinion.resolutionStatus === "RESOLVED_HIT" ? "#dcfce7" : "#fee2e2",
            },
          ]}
        >
          <Text
            style={[
              styles.resolutionLabel,
              {
                color: opinion.resolutionStatus === "RESOLVED_HIT" ? "#15803d" : "#b91c1c",
              },
            ]}
          >
            {opinion.resolutionStatus === "RESOLVED_HIT" ? "CALLED IT ✓" : "MISSED ✗"}
          </Text>
          {opinion.resolutionNote && (
            <>
              <Text style={styles.resolutionWhyLabel}>
                Why {opinion.resolutionStatus === "RESOLVED_HIT" ? "HIT" : "MISS"}
              </Text>
              <Text style={styles.resolutionNote}>{opinion.resolutionNote}</Text>
            </>
          )}
        </View>
      )}

      {/* Source link */}
      <Pressable
        style={styles.sourceBtn}
        onPress={() => Linking.openURL(opinion.sourceUrl).catch(() => undefined)}
      >
        <Feather name="external-link" size={14} color={colors.accent} />
        <Text style={styles.sourceBtnText}>Read source article</Text>
      </Pressable>

      {/* Cluster chip — tappable, deep-links back to finance feed pre-filtered */}
      {opinion.eventCluster && (
        <Pressable
          style={styles.clusterChip}
          onPress={() =>
            router.push({
              pathname: "/(tabs)/finance",
              params: { clusterId: opinion.eventCluster!.id },
            } as Parameters<typeof router.push>[0])
          }
        >
          <Text style={styles.clusterChipText}>📅 {opinion.eventCluster.name} →</Text>
        </Pressable>
      )}

      {/* Poll A — agreement */}
      <View style={styles.pollSection}>
        <Text style={styles.pollTitle}>Do you agree with this call?</Text>
        {isResolved && opinion.resolvedAt && (
          <View style={styles.votingClosedBanner}>
            <Feather name="lock" size={12} color="#64748b" />
            <Text style={styles.votingClosedText}>
              Voting closed on{" "}
              {new Date(opinion.resolvedAt).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
              {tallies?.implication.userLockedAt
                ? ` · You voted ${tallies.implication.userChoice?.replace("_", " ").toLowerCase() ?? ""}`
                : tallies?.implication.userChoice
                  ? " · Your draft didn't count"
                  : ""}
            </Text>
          </View>
        )}
        <Text style={styles.pollSubtitle}>
          {tallies
            ? `${tallies.implication.total} ${tallies.implication.total === 1 ? "vote" : "votes"}${
                tallies.implication.draftTotal > 0 && !isResolved
                  ? ` · ${tallies.implication.draftTotal} deciding`
                  : ""
              }`
            : "Loading…"}
        </Text>
        <View style={styles.optionsCol}>
          {IMPLICATION_OPTIONS.map((opt) => {
            const isSelected = tallies?.implication.userChoice === opt.key;
            const isLocked = Boolean(tallies?.implication.userLockedAt);
            const isResolvedOpinion = opinion.resolutionStatus !== "PENDING";
            const count = tallies ? implCount(tallies, opt.key) : 0;
            const total = tallies?.implication.total ?? 0;
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            const disabled = voting || isLocked || isResolvedOpinion;
            return (
              <Pressable
                key={opt.key}
                onPress={() => castImplication(opt.key)}
                disabled={disabled}
                style={[
                  styles.optionBtn,
                  isSelected && { borderColor: opt.color, borderWidth: 2 },
                  disabled && !isSelected && { opacity: 0.55 },
                ]}
              >
                <View
                  style={[
                    styles.optionFill,
                    { backgroundColor: opt.color + "22", width: `${pct}%` },
                  ]}
                />
                <Text style={[styles.optionLabel, isSelected && { color: opt.color, fontWeight: "700" }]}>
                  {opt.label}
                </Text>
                <Text style={styles.optionPct}>{tallies ? `${pct}%` : ""}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Vote CTA / voted pill */}
        {tallies?.implication.userChoice && opinion.resolutionStatus === "PENDING" && (
          tallies.implication.userLockedAt ? (
            <View style={styles.lockedPill}>
              <Feather name="check-circle" size={12} color="#4338ca" />
              <Text style={styles.lockedPillText}>
                {(() => {
                  const userChoice = tallies.implication.userChoice;
                  const label = userChoice
                    ? IMPLICATION_OPTIONS.find((o) => o.key === userChoice)?.label ?? userChoice
                    : "";
                  const dateStr = new Date(tallies.implication.userLockedAt!).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                  });
                  return label ? `Voted ${label} · ${dateStr}` : `Voted ${dateStr}`;
                })()}
              </Text>
            </View>
          ) : (
            <Pressable
              onPress={lockVote}
              disabled={voting}
              style={[styles.lockBtn, voting && { opacity: 0.6 }]}
            >
              <Feather name="check-circle" size={14} color="#fff" />
              <Text style={styles.lockBtnText}>Cast my vote</Text>
            </Pressable>
          )
        )}
        {tallies?.implication.userChoice && !tallies.implication.userLockedAt && opinion.resolutionStatus === "PENDING" && (
          <Text style={styles.lockHint}>
            You can still change your pick until you cast your vote. Only cast votes count toward your accuracy.
          </Text>
        )}
      </View>

      {tallyError && <Text style={styles.errorInline}>{tallyError}</Text>}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  errorText: { color: colors.textMuted, marginBottom: spacing.md, textAlign: "center" },
  retryBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
  },
  retryBtnText: { color: "#fff", fontWeight: "600" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.lg,
    gap: spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#4b5563", fontSize: 18, fontWeight: "700" },
  expertName: { fontSize: 16, fontWeight: "700", color: colors.text },
  expertOrg: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  metaLine: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  dirBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  dirBadgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },

  headline: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.text,
    paddingHorizontal: spacing.lg,
    lineHeight: 28,
  },
  instrumentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  instrumentText: { fontSize: 13, color: colors.textMuted },

  quoteCard: {
    margin: spacing.lg,
    padding: spacing.lg,
    backgroundColor: "#f9fafb",
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  quoteText: { fontSize: 15, color: colors.text, lineHeight: 22 },

  resolutionCard: {
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  resolutionLabel: { fontSize: 14, fontWeight: "700", letterSpacing: 0.5 },
  resolutionWhyLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    marginTop: spacing.sm,
    color: "#4b5563",
  },
  resolutionNote: { fontSize: 13, color: colors.text, marginTop: 2, lineHeight: 18 },

  sourceBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  sourceBtnText: { color: colors.accent, fontSize: 13, fontWeight: "600" },

  clusterChip: {
    alignSelf: "flex-start",
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: "#eef2ff",
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  clusterChipText: { fontSize: 12, color: "#4338ca", fontWeight: "600" },

  pollSection: {
    margin: spacing.lg,
    marginTop: spacing.xl,
    padding: spacing.lg,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  pollTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  pollSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2, marginBottom: spacing.md },
  votingClosedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
    marginBottom: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    backgroundColor: "#f1f5f9",
    borderRadius: radius.sm,
    alignSelf: "flex-start",
  },
  votingClosedText: {
    fontSize: 11,
    color: "#475569",
    fontWeight: "600",
  },
  optionsCol: { gap: spacing.sm },
  optionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#fff",
    overflow: "hidden",
    position: "relative",
  },
  optionFill: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
  },
  optionLabel: { fontSize: 14, color: colors.text, zIndex: 1 },
  optionPct: { fontSize: 13, color: colors.textMuted, fontWeight: "600", zIndex: 1 },

  // Lock CTA + locked pill
  lockBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: spacing.md,
    paddingVertical: spacing.sm + 2,
    backgroundColor: "#4338ca",
    borderRadius: radius.md,
  },
  lockBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  lockedPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: "#eef2ff",
    borderRadius: radius.pill,
  },
  lockedPillText: { color: "#4338ca", fontSize: 12, fontWeight: "700" },
  lockHint: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 8,
    lineHeight: 15,
  },

  errorInline: {
    color: "#b91c1c",
    fontSize: 13,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
});
