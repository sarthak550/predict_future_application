/**
 * ExpertOpinionPostCard — S34-T1
 *
 * Redesigned Finance feed card. Visual reference: LinkedIn post card structure —
 * content-anchor, credibility signals, deliberate engagement. NOT Instagram or X.
 *
 * Zone breakdown (top → bottom):
 *   Header:        avatar/initials · name · org · tier badge · Follow button
 *   Verdict badge: full-width pill — direction + optional outcome (HIT/MISS)
 *   Ticker row:    symbol + instrument name
 *   Body:          AI paraphrase, 3-line max, "more" expands inline
 *   Source strip:  single tappable line — "AI-summarized from [Pub] · [Date]"
 *   Engagement:    Poll A (PENDING) or Poll B (resolved) + Consensus Bar
 *   Footer:        SEBI disclaimer (left) · share icon (right)
 *
 * Share: captures card screenshot via react-native-view-shot, composes an
 * off-screen share-only view (wordmark + link), then triggers Share.share().
 *
 * Gate: controlled by USE_POST_CARD in src/lib/feature-flags.ts.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { captureRef } from "react-native-view-shot";

import type {
  ApiExpertOpinionItem,
  ApiExpertOpinionTallies,
  ApiImplicationChoice,
  ApiOpinionSibling,
  AppAnalystTier,
} from "@predict-future/types";
import { formatRelativeTime, freshnessColor } from "@predict-future/utils";
import { radius, spacing } from "@predict-future/ui-tokens";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";
import { SnappedSlider as Slider } from "@/components/snapped-slider";
import { trackVoteEvent } from "@/lib/analytics";
import { mobileApi } from "@/lib/api";
import { getExpertInitials, getExpertInitialsColor } from "@/utils/expertAvatar";
import { AnalystCredibilityBadge } from "@/components/analyst-credibility-badge";

// ─── Direction configuration ───────────────────────────────────────────────────

const DIRECTION_CONFIG = {
  BULLISH: {
    label: "BULLISH",
    color: "#16a34a",
    bg: "#dcfce7",
    border: "#bbf7d0",
    icon: "↑" as const,
  },
  BEARISH: {
    label: "BEARISH",
    color: "#dc2626",
    bg: "#fee2e2",
    border: "#fecaca",
    icon: "↓" as const,
  },
  NEUTRAL: {
    label: "NEUTRAL",
    color: "#6b7280",
    bg: "#f3f4f6",
    border: "#e5e7eb",
    icon: "—" as const,
  },
} as const;

type DirectionKey = keyof typeof DIRECTION_CONFIG;

// ─── Poll A bucket definitions ─────────────────────────────────────────────────

const IMPLICATION_BUCKETS: {
  key: ApiImplicationChoice;
  label: string;
  tickLabel: string;
  color: string;
}[] = [
  { key: "STRONGLY_DISAGREE", label: "Strongly Disagree", tickLabel: "−−", color: "#dc2626" },
  { key: "DISAGREE", label: "Disagree", tickLabel: "−", color: "#f87171" },
  { key: "NEUTRAL", label: "Neutral", tickLabel: "0", color: "#6b7280" },
  { key: "AGREE", label: "Agree", tickLabel: "+", color: "#4ade80" },
  { key: "STRONGLY_AGREE", label: "Strongly Agree", tickLabel: "++", color: "#16a34a" },
];

function implicationChoiceToIndex(choice: string): number {
  switch (choice) {
    case "STRONGLY_DISAGREE":
    case "STRONG_DROP":
    case "BEARISH":
      return 0;
    case "DISAGREE":
    case "MILD_DROP":
      return 1;
    case "NEUTRAL":
    case "FLAT":
      return 2;
    case "AGREE":
    case "MILD_GAIN":
      return 3;
    case "STRONGLY_AGREE":
    case "STRONG_GAIN":
    case "BULLISH":
      return 4;
    default:
      return 2;
  }
}

// ─── Utility ───────────────────────────────────────────────────────────────────

function getSourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 30);
  }
}

// ─── Sub-components ────────────────────────────────────────────────────────────

/**
 * ExpertAvatar — shows image if present, otherwise a coloured monogram circle.
 */
function ExpertAvatar({
  name,
  organization,
  avatarUrl,
  size = 40,
}: {
  name: string;
  organization: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  const initials = getExpertInitials(name, organization);
  const bg = getExpertInitialsColor(name || organization);

  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: "#fff",
          fontSize: size * 0.42,
          fontWeight: "700",
          letterSpacing: 0.5,
        }}
      >
        {initials}
      </Text>
    </View>
  );
}

const makeConsensusStyles = (t: ThemeContextValue) => StyleSheet.create({
  preVoteWrap: { marginBottom: 6 },
  preVoteTrack: {
    flexDirection: "row",
    height: 3,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: t.colors.border,
    marginBottom: 4,
  },
  preVoteFill: { backgroundColor: "#16a34a", height: 3 },
  preVoteRest: { backgroundColor: t.colors.border, height: 3 },
  preVoteLabel: { fontSize: 11, color: t.colors.textMuted, letterSpacing: 0.1 },
  postVoteWrap: { marginBottom: 6 },
  splitTrack: {
    flexDirection: "row",
    height: 5,
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 4,
  },
  splitSegment: { height: 5 },
  splitLabels: { flexDirection: "row", justifyContent: "space-between" },
  splitLabel: { fontSize: 10, fontWeight: "600", letterSpacing: 0.1 },
});

/**
 * ConsensusBar — slim social-proof bar showing live Poll A aggregate.
 * Pre-vote: single thin green bar + label.
 * Post-vote / resolved: split bar with agree/neutral/disagree segments.
 */
function ConsensusBar({
  tallies,
  hasVoted,
  userBucketIndex,
}: {
  tallies: ApiExpertOpinionTallies;
  hasVoted: boolean;
  userBucketIndex: number;
}) {
  const consensusStyles = useThemedStyles(makeConsensusStyles);
  const { colors } = useTheme();
  const impl = tallies.implication;
  if (impl.total === 0) return null;

  const agreeCount = impl.agree + impl.stronglyAgree;
  const disagreeCount = impl.stronglyDisagree + impl.disagree;
  const neutralCount = impl.neutral;
  const agreePct = Math.round((agreeCount / impl.total) * 100);

  // S38: hide engagement % below N=5 — same threshold as the Big Call hero.
  const ENGAGEMENT_MIN = 5;

  if (!hasVoted) {
    if (impl.total < ENGAGEMENT_MIN) {
      return (
        <View style={consensusStyles.preVoteWrap}>
          <Text style={consensusStyles.preVoteLabel}>Vote to see how others stand</Text>
        </View>
      );
    }
    return (
      <View style={consensusStyles.preVoteWrap}>
        <View style={consensusStyles.preVoteTrack}>
          <View style={[consensusStyles.preVoteFill, { flex: agreePct }]} />
          <View style={[consensusStyles.preVoteRest, { flex: Math.max(100 - agreePct, 0) }]} />
        </View>
        <Text style={consensusStyles.preVoteLabel}>
          {agreePct}% of {impl.total} reader{impl.total !== 1 ? "s" : ""} agreed
        </Text>
      </View>
    );
  }

  const userIsAgree = userBucketIndex >= 3;
  const userIsDisagree = userBucketIndex <= 1;
  const userIsNeutral = userBucketIndex === 2;

  const totalSafe = Math.max(impl.total, 1);
  const agreeFlex = Math.round((agreeCount / totalSafe) * 100);
  const neutralFlex = Math.round((neutralCount / totalSafe) * 100);
  const disagreeFlex = Math.max(100 - agreeFlex - neutralFlex, 0);

  return (
    <View style={consensusStyles.postVoteWrap}>
      <View style={consensusStyles.splitTrack}>
        {agreeFlex > 0 && (
          <View
            style={[
              consensusStyles.splitSegment,
              { flex: agreeFlex, backgroundColor: userIsAgree ? "#16a34a" : "#bbf7d0" },
            ]}
          />
        )}
        {neutralFlex > 0 && (
          <View
            style={[
              consensusStyles.splitSegment,
              { flex: neutralFlex, backgroundColor: userIsNeutral ? "#9ca3af" : colors.border },
            ]}
          />
        )}
        {disagreeFlex > 0 && (
          <View
            style={[
              consensusStyles.splitSegment,
              { flex: Math.max(disagreeFlex, 1), backgroundColor: userIsDisagree ? "#dc2626" : "#fecaca" },
            ]}
          />
        )}
      </View>
      <View style={consensusStyles.splitLabels}>
        <Text style={[consensusStyles.splitLabel, { color: userIsAgree ? "#16a34a" : colors.textMuted }]}>
          {agreePct}% agreed
        </Text>
        <Text style={[consensusStyles.splitLabel, { color: colors.textSubtle }]}>
          {Math.round((neutralCount / totalSafe) * 100)}% neutral
        </Text>
        <Text style={[consensusStyles.splitLabel, { color: userIsDisagree ? "#dc2626" : colors.textMuted }]}>
          {Math.round((disagreeCount / totalSafe) * 100)}% disagreed
        </Text>
      </View>
    </View>
  );
}

// ─── Poll A ────────────────────────────────────────────────────────────────────

const makePollStyles = (t: ThemeContextValue) => StyleSheet.create({
  section: {
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.border,
    marginTop: spacing.sm,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: "600",
    color: t.colors.text,
    marginBottom: 8,
    letterSpacing: 0.1,
  },
  sliderSkeletonTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: t.colors.border,
    marginVertical: 8,
  },
  sliderPositionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: t.colors.text,
    textAlign: "center",
    marginBottom: 6,
  },
  slider: { width: "100%", height: 36 },
  tickRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    marginBottom: 10,
  },
  tickLabel: {
    fontSize: 11,
    color: t.colors.textSubtle,
    fontWeight: "600",
    width: 20,
    textAlign: "center",
  },
  submitVoteBtn: {
    backgroundColor: t.colors.accent,
    borderRadius: radius.sm,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 2,
  },
  submitVoteBtnDisabled: { opacity: 0.55 },
  submitVoteBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", letterSpacing: 0.3 },
  castVoteBtn: {
    backgroundColor: "#4338ca",
    borderRadius: radius.sm,
    paddingVertical: 9,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  castVoteBtnText: { color: "#fff", fontSize: 12, fontWeight: "700", letterSpacing: 0.2 },
  castVoteHint: { fontSize: 10, color: t.colors.textMuted, marginTop: 4, textAlign: "center" },
  histogramRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-around",
    height: 34,
    marginBottom: 2,
  },
  histogramCell: { alignItems: "center", flex: 1 },
  histogramBar: { width: 14, borderRadius: 3 },
  medianFlag: { marginBottom: 1 },
  medianFlagText: { fontSize: 8, color: t.colors.textSubtle },
  youVotedChip: {
    fontSize: 11,
    color: t.colors.textMuted,
    marginTop: 6,
    textAlign: "center",
    fontStyle: "italic",
  },
  errorText: { fontSize: 11, color: "#dc2626", marginTop: 4, textAlign: "center" },
});

function PollA({
  opinion,
  tallies,
  loadingTallies,
  onVoted,
}: {
  opinion: ApiExpertOpinionItem;
  tallies: ApiExpertOpinionTallies | null;
  loadingTallies: boolean;
  onVoted: (tallies: ApiExpertOpinionTallies) => void;
}) {
  const pollStyles = useThemedStyles(makePollStyles);
  const { colors } = useTheme();
  const [voting, setVoting] = useState(false);
  const [pendingBucket, setPendingBucket] = useState<number>(2);
  const [localChoice, setLocalChoice] = useState<ApiImplicationChoice | null>(
    tallies?.implication.userChoice ?? null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tallies?.implication.userChoice) {
      setLocalChoice(tallies.implication.userChoice);
    }
  }, [tallies?.implication.userChoice]);

  const isPending = opinion.resolutionStatus === "PENDING";
  const hasVoted = localChoice !== null;
  const impTallies = tallies?.implication;
  const isLocked = Boolean(impTallies?.userLockedAt);
  const isDraftEditable = hasVoted && !isLocked && isPending;

  // When a draft vote becomes editable (or its server-side bucket changes),
  // align the slider position so the user can drag from where they currently sit.
  useEffect(() => {
    if (isDraftEditable && localChoice) {
      setPendingBucket(implicationChoiceToIndex(localChoice));
    }
  }, [isDraftEditable, localChoice]);

  const handleSubmit = async () => {
    if (voting) return;
    const choice = IMPLICATION_BUCKETS[pendingBucket]?.key;
    if (!choice) return;
    if (!isPending) {
      trackVoteEvent("opinion_vote_blocked", {
        opinionId: opinion.id,
        expertId: opinion.expertId,
        expertOrganization: opinion.expertOrganization,
        direction: opinion.direction as "BULLISH" | "BEARISH" | "NEUTRAL",
        resolutionStatus: opinion.resolutionStatus as "RESOLVED_HIT" | "RESOLVED_MISS",
      });
      return;
    }
    setVoting(true);
    setError(null);
    const prev = localChoice;
    setLocalChoice(choice);
    try {
      const updated = await mobileApi.castExpertOpinionVote(opinion.id, {
        pollType: "IMPLICATION",
        choice,
      });
      onVoted(updated);
      trackVoteEvent(prev === null ? "opinion_vote_cast" : "opinion_vote_changed", {
        opinionId: opinion.id,
        expertId: opinion.expertId,
        expertOrganization: opinion.expertOrganization,
        direction: opinion.direction as "BULLISH" | "BEARISH" | "NEUTRAL",
        choice,
        previousChoice: prev,
      });
    } catch (err) {
      setLocalChoice(prev);
      setError("Vote failed. Tap to retry.");
      console.error("[poll-a] castExpertOpinionVote failed:", err);
    } finally {
      setVoting(false);
    }
  };

  const handleLock = async () => {
    if (voting || isLocked) return;
    if (!isPending) {
      trackVoteEvent("opinion_vote_blocked", {
        opinionId: opinion.id,
        expertId: opinion.expertId,
        expertOrganization: opinion.expertOrganization,
        direction: opinion.direction as "BULLISH" | "BEARISH" | "NEUTRAL",
        resolutionStatus: opinion.resolutionStatus as "RESOLVED_HIT" | "RESOLVED_MISS",
      });
      return;
    }
    setVoting(true);
    setError(null);
    try {
      const updated = await mobileApi.lockExpertOpinionVote(opinion.id);
      onVoted(updated);
      trackVoteEvent("opinion_vote_locked", {
        opinionId: opinion.id,
        expertId: opinion.expertId,
        expertOrganization: opinion.expertOrganization,
        direction: opinion.direction as "BULLISH" | "BEARISH" | "NEUTRAL",
        choice: localChoice ?? undefined,
      });
    } catch (err) {
      setError("Couldn't cast vote. Tap to retry.");
      console.error("[poll-a] lockExpertOpinionVote failed:", err);
    } finally {
      setVoting(false);
    }
  };

  // UX2: atomic re-cast + lock for the "user changed their draft bucket" case.
  // Without this, switching from drafted-A to locked-B is a 2-tap flow:
  // "Update draft to B" → "Cast my vote: B". One tap is more direct.
  const handleSubmitAndLock = async () => {
    if (voting || isLocked || !isPending) return;
    const choice = IMPLICATION_BUCKETS[pendingBucket]?.key;
    if (!choice) return;
    setVoting(true);
    setError(null);
    const prev = localChoice;
    setLocalChoice(choice);
    try {
      // 1. Re-cast with new bucket
      await mobileApi.castExpertOpinionVote(opinion.id, { pollType: "IMPLICATION", choice });
      trackVoteEvent(prev === null ? "opinion_vote_cast" : "opinion_vote_changed", {
        opinionId: opinion.id,
        expertId: opinion.expertId,
        expertOrganization: opinion.expertOrganization,
        direction: opinion.direction as "BULLISH" | "BEARISH" | "NEUTRAL",
        choice,
        previousChoice: prev,
      });
      // 2. Lock immediately so user gets a single-tap commit
      const updated = await mobileApi.lockExpertOpinionVote(opinion.id);
      onVoted(updated);
      trackVoteEvent("opinion_vote_locked", {
        opinionId: opinion.id,
        expertId: opinion.expertId,
        expertOrganization: opinion.expertOrganization,
        direction: opinion.direction as "BULLISH" | "BEARISH" | "NEUTRAL",
        choice,
      });
    } catch (err) {
      setLocalChoice(prev);
      setError("Couldn't cast vote. Tap to retry.");
      console.error("[poll-a] submit+lock failed:", err);
    } finally {
      setVoting(false);
    }
  };

  const votedBucketIndex = localChoice != null ? implicationChoiceToIndex(localChoice) : 2;

  const bucketCounts = impTallies
    ? [
        impTallies.stronglyDisagree,
        impTallies.disagree,
        impTallies.neutral,
        impTallies.agree,
        impTallies.stronglyAgree,
      ]
    : [0, 0, 0, 0, 0];
  const maxCount = Math.max(...bucketCounts, 1);

  if (loadingTallies && !hasVoted) {
    return (
      <View style={pollStyles.section}>
        <Text style={pollStyles.sectionHeader}>Where do you stand on this analyst's view?</Text>
        <View style={pollStyles.sliderSkeletonTrack} />
      </View>
    );
  }

  return (
    <View style={pollStyles.section}>
      <Text style={pollStyles.sectionHeader}>Where do you stand on this analyst's view?</Text>

      {tallies !== null && (
        <ConsensusBar
          tallies={tallies}
          hasVoted={hasVoted}
          userBucketIndex={hasVoted ? votedBucketIndex : -1}
        />
      )}

      {!hasVoted && isPending ? (
        <>
          <Text style={pollStyles.sliderPositionLabel}>
            {IMPLICATION_BUCKETS[pendingBucket]?.label ?? ""}
          </Text>

          <Slider
            style={pollStyles.slider}
            minimumValue={0}
            maximumValue={4}
            step={1}
            value={pendingBucket}
            onValueChange={(val) => setPendingBucket(Math.round(val))}
            minimumTrackTintColor={IMPLICATION_BUCKETS[pendingBucket]?.color ?? "#6b7280"}
            maximumTrackTintColor={colors.border}
            thumbTintColor={IMPLICATION_BUCKETS[pendingBucket]?.color ?? "#6b7280"}
            disabled={voting}
          />

          <View style={pollStyles.tickRow}>
            {IMPLICATION_BUCKETS.map((b, i) => (
              <Text
                key={b.key}
                style={[
                  pollStyles.tickLabel,
                  pendingBucket === i && { color: b.color, fontWeight: "800" },
                ]}
              >
                {b.tickLabel}
              </Text>
            ))}
          </View>

          <Pressable
            style={[pollStyles.submitVoteBtn, voting && pollStyles.submitVoteBtnDisabled]}
            onPress={() => void handleSubmit()}
            disabled={voting}
          >
            {voting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={pollStyles.submitVoteBtnText}>Submit Vote</Text>
            )}
          </Pressable>
        </>
      ) : (
        <>
          <View style={pollStyles.histogramRow}>
            {bucketCounts.map((count, i) => {
              const barH = Math.max(2, Math.round((count / maxCount) * 28));
              const isMedian = impTallies?.medianBucket === i;
              const isVoted = hasVoted && votedBucketIndex === i;
              return (
                <View key={i} style={pollStyles.histogramCell}>
                  {isMedian && (
                    <View style={pollStyles.medianFlag}>
                      <Text style={pollStyles.medianFlagText}>▼</Text>
                    </View>
                  )}
                  <View
                    style={[
                      pollStyles.histogramBar,
                      {
                        height: barH,
                        backgroundColor: isVoted
                          ? (IMPLICATION_BUCKETS[i]?.color ?? "#6b7280")
                          : (IMPLICATION_BUCKETS[i]?.color ?? "#6b7280") + "55",
                      },
                    ]}
                  />
                </View>
              );
            })}
          </View>

          <Slider
            style={pollStyles.slider}
            minimumValue={0}
            maximumValue={4}
            step={1}
            value={isDraftEditable ? pendingBucket : votedBucketIndex}
            onValueChange={isDraftEditable ? (val) => setPendingBucket(Math.round(val)) : undefined}
            minimumTrackTintColor={
              IMPLICATION_BUCKETS[isDraftEditable ? pendingBucket : votedBucketIndex]?.color ?? "#6b7280"
            }
            maximumTrackTintColor={colors.border}
            thumbTintColor={
              IMPLICATION_BUCKETS[isDraftEditable ? pendingBucket : votedBucketIndex]?.color ?? "#6b7280"
            }
            disabled={!isDraftEditable || voting}
          />

          <View style={pollStyles.tickRow}>
            {IMPLICATION_BUCKETS.map((b, i) => {
              const activeIdx = isDraftEditable ? pendingBucket : votedBucketIndex;
              return (
                <Text
                  key={b.key}
                  style={[
                    pollStyles.tickLabel,
                    activeIdx === i && { color: b.color, fontWeight: "800" },
                  ]}
                >
                  {b.tickLabel}
                </Text>
              );
            })}
          </View>

          {localChoice && isLocked && impTallies?.userLockedAt && (
            <Text style={pollStyles.youVotedChip}>
              ✓ Voted {IMPLICATION_BUCKETS[votedBucketIndex]?.label ?? localChoice}
              {" · "}
              {new Date(impTallies.userLockedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              {!isPending && " · Poll closed"}
            </Text>
          )}

          {isDraftEditable && (() => {
            const draftChanged = pendingBucket !== votedBucketIndex;
            // Button label always shows the bucket being committed (pendingBucket
            // when changed, votedBucketIndex when not). Handler is atomic when
            // changed — single tap re-casts AND locks.
            const committingBucket = draftChanged ? pendingBucket : votedBucketIndex;
            return (
              <>
                <Pressable
                  style={[pollStyles.castVoteBtn, voting && pollStyles.submitVoteBtnDisabled]}
                  onPress={() => void (draftChanged ? handleSubmitAndLock() : handleLock())}
                  disabled={voting}
                >
                  {voting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={pollStyles.castVoteBtnText}>
                      Cast my vote: {IMPLICATION_BUCKETS[committingBucket]?.label ?? localChoice}
                    </Text>
                  )}
                </Pressable>
                <Text style={pollStyles.castVoteHint}>
                  {draftChanged
                    ? "Drag to change · One tap locks in your updated vote."
                    : "Draft only — only cast votes count toward your accuracy."}
                </Text>
              </>
            );
          })()}

          {localChoice && !isLocked && !isPending && (
            <Text style={pollStyles.youVotedChip}>
              Your draft of {IMPLICATION_BUCKETS[votedBucketIndex]?.label ?? localChoice} didn't count · Poll closed
            </Text>
          )}
        </>
      )}

      {error && (
        <Pressable onPress={() => void handleSubmit()}>
          <Text style={pollStyles.errorText}>{error} Tap to retry.</Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── Share-only composed view (off-screen) ─────────────────────────────────────

/**
 * ShareView — rendered off-screen and captured as a PNG before sharing.
 * Contains the card content + app wordmark + store link at the bottom.
 * We forward the ref so the parent can call captureRef() on it.
 */
const ShareView = ({
  opinion,
  dirConfig,
  shareViewRef,
}: {
  opinion: ApiExpertOpinionItem;
  dirConfig: (typeof DIRECTION_CONFIG)[DirectionKey];
  shareViewRef: React.RefObject<View | null>;
}) => {
  const initials = getExpertInitials(opinion.expertName, opinion.expertOrganization);
  const initialsColor = getExpertInitialsColor(opinion.expertName || opinion.expertOrganization);

  return (
    <View
      ref={shareViewRef}
      style={shareStyles.root}
      collapsable={false}
    >
      {/* Card content */}
      <View style={shareStyles.card}>
        {/* Header */}
        <View style={shareStyles.header}>
          {opinion.avatarUrl ? (
            <Image source={{ uri: opinion.avatarUrl }} style={shareStyles.avatar} />
          ) : (
            <View style={[shareStyles.avatarFallback, { backgroundColor: initialsColor }]}>
              <Text style={shareStyles.avatarInitials}>{initials}</Text>
            </View>
          )}
          <View style={shareStyles.headerText}>
            <Text style={shareStyles.expertName} numberOfLines={1}>
              {opinion.expertName || opinion.expertOrganization}
            </Text>
            <Text style={shareStyles.expertOrg} numberOfLines={1}>
              {opinion.expertOrganization}
            </Text>
          </View>
        </View>

        {/* Verdict badge */}
        <View style={[shareStyles.verdictBadge, { backgroundColor: dirConfig.bg, borderColor: dirConfig.border }]}>
          <Text style={[shareStyles.verdictText, { color: dirConfig.color }]}>
            {dirConfig.icon}  {dirConfig.label}
          </Text>
        </View>

        {/* Ticker */}
        {(opinion.instrumentTicker || opinion.instrument) && (
          <View style={shareStyles.tickerRow}>
            {opinion.instrumentTicker && (
              <Text style={shareStyles.ticker}>{opinion.instrumentTicker}</Text>
            )}
            {opinion.instrument && (
              <Text style={shareStyles.instrumentName}>{opinion.instrument}</Text>
            )}
          </View>
        )}

        {/* Quote */}
        <Text style={shareStyles.quote} numberOfLines={4}>{opinion.quote}</Text>

        {/* Source */}
        <Text style={shareStyles.source}>
          AI-summarized from {getSourceDomain(opinion.sourceUrl)}
        </Text>
      </View>

      {/* Wordmark + link strip */}
      <View style={shareStyles.brandStrip}>
        <Text style={shareStyles.brandLink}>predictfuture.app</Text>
        <Text style={shareStyles.brandWordmark}>Predict Future</Text>
      </View>
    </View>
  );
};

const shareStyles = StyleSheet.create({
  root: {
    position: "absolute",
    top: -9999,
    left: -9999,
    width: 360,
    backgroundColor: "#fff",
    borderRadius: 16,
    overflow: "hidden",
  },
  card: {
    padding: 20,
  },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  avatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: { color: "#fff", fontSize: 18, fontWeight: "700" },
  headerText: { flex: 1 },
  expertName: { fontSize: 15, fontWeight: "700", color: "#111827" },
  expertOrg: { fontSize: 12, color: "#6b7280", marginTop: 1 },
  verdictBadge: {
    borderWidth: 1.5,
    borderRadius: 100,
    paddingVertical: 8,
    paddingHorizontal: 20,
    alignItems: "center",
    marginBottom: 12,
  },
  verdictText: { fontSize: 16, fontWeight: "800", letterSpacing: 1.5 },
  tickerRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 10 },
  ticker: { fontSize: 13, fontWeight: "800", color: "#111827", letterSpacing: 0.5 },
  instrumentName: { fontSize: 12, color: "#6b7280" },
  quote: { fontSize: 14, color: "#374151", lineHeight: 20, marginBottom: 10 },
  source: { fontSize: 11, color: "#9ca3af" },
  brandStrip: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f9fafb",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  brandLink: { fontSize: 11, color: "#6b7280" },
  brandWordmark: { fontSize: 12, fontWeight: "800", color: "#4338ca", letterSpacing: 0.5 },
});

// ─── Main card props ────────────────────────────────────────────────────────────

export type ExpertOpinionPostCardProps = {
  opinion: ApiExpertOpinionItem;
  /** ISO string of the originating article publish date */
  articlePublishedAt?: string;
  /** Tier of the analyst — from the expert profile or feed item */
  analystTier?: AppAnalystTier;
  /**
   * Weekly hit rate as a fraction 0.0–1.0 — used by AnalystCredibilityBadge.
   * When provided alongside weeklyResolvedCount >= 3, the accuracy stat renders.
   */
  weeklyHitRate?: number | null;
  /** Weekly resolved call count — required alongside weeklyHitRate. */
  weeklyResolvedCount?: number | null;
  /** Whether the current user follows this expert */
  isFollowed?: boolean;
  /** Called when user taps Follow/Following button */
  onFollowToggle?: (expertId: string, currentlyFollowing: boolean) => void;
};

// ─── ExpertOpinionPostCard ─────────────────────────────────────────────────────

/**
 * Redesigned Finance feed card. See module docblock for full zone breakdown.
 *
 * Gate: USE_POST_CARD in src/lib/feature-flags.ts.
 */
export function ExpertOpinionPostCard({
  opinion,
  articlePublishedAt,
  analystTier,
  weeklyHitRate,
  weeklyResolvedCount,
  isFollowed,
  onFollowToggle,
}: ExpertOpinionPostCardProps) {
  const router = useRouter();
  const styles = useThemedStyles(makeCardStyles);
  const { colors } = useTheme();

  // ── Tallies state ──
  const [tallies, setTallies] = useState<ApiExpertOpinionTallies | null>(null);
  const [loadingTallies, setLoadingTallies] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);

  // ── Follow state ──
  const [followPending, setFollowPending] = useState(false);

  // ── Body expansion ──
  const [bodyExpanded, setBodyExpanded] = useState(false);

  // ── Sibling opinions (chip links to /story/[id] for full grouped view) ──
  const siblings: ApiOpinionSibling[] = opinion.siblings ?? [];
  const siblingBullish = siblings.filter((s) => s.direction === "BULLISH").length;
  const siblingBearish = siblings.filter((s) => s.direction === "BEARISH").length;
  const siblingNeutral = siblings.filter((s) => s.direction === "NEUTRAL").length;

  // ── Share ──
  const [sharing, setSharing] = useState(false);
  const cardRef = useRef<View>(null);
  const shareViewRef = useRef<View>(null);

  const dirConfig =
    DIRECTION_CONFIG[opinion.direction as DirectionKey] ?? DIRECTION_CONFIG.NEUTRAL;

  const isResolved =
    opinion.resolutionStatus === "RESOLVED_HIT" ||
    opinion.resolutionStatus === "RESOLVED_MISS";
  const isHit = opinion.resolutionStatus === "RESOLVED_HIT";
  const isMiss = opinion.resolutionStatus === "RESOLVED_MISS";

  // ── Load tallies on mount ──
  useEffect(() => {
    let cancelled = false;
    const skeletonTimer = setTimeout(() => {
      if (!cancelled) setShowSkeleton(true);
    }, 150);

    setLoadingTallies(true);
    mobileApi
      .getExpertOpinionTallies(opinion.id)
      .then((t) => {
        if (!cancelled) setTallies(t);
      })
      .catch(() => {
        // non-blocking — polls degrade silently
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingTallies(false);
          setShowSkeleton(false);
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(skeletonTimer);
    };
  }, [opinion.id]);

  const handleTalliesUpdate = useCallback((updated: ApiExpertOpinionTallies) => {
    setTallies(updated);
  }, []);

  // ── Follow handler ──
  // followPending is set to true before the API call and cleared in finally —
  // no setTimeout needed; the button is disabled until the request settles.
  const handleFollowPress = useCallback(() => {
    if (!onFollowToggle || followPending) return;
    setFollowPending(true);
    Promise.resolve(onFollowToggle(opinion.expertId, isFollowed ?? false)).finally(() => {
      setFollowPending(false);
    });
  }, [onFollowToggle, followPending, opinion.expertId, isFollowed]);

  // ── Share handler ──
  const handleShare = useCallback(async () => {
    if (sharing || !shareViewRef.current) return;
    setSharing(true);
    const currentRef = shareViewRef.current;
    try {
      const uri = await captureRef(currentRef, {
        format: "png",
        quality: 0.95,
        result: "tmpfile",
      });
      await Share.share({
        url: uri,
        message: `${opinion.expertName} is ${dirConfig.label} on ${opinion.instrument ?? opinion.instrumentTicker ?? "the market"}. Check it out on Predict Future.`,
      });
    } catch {
      // user dismissed share sheet — no-op
    } finally {
      setSharing(false);
    }
  }, [sharing, opinion, dirConfig]);

  // ── Verdict badge label (appends outcome when resolved) ──
  const verdictLabel = isResolved
    ? `${dirConfig.label}  ·  ${isHit ? "HIT" : "MISS"}`
    : dirConfig.label;

  // Verdict badge colors shift on resolution
  const verdictBg = isResolved
    ? isHit
      ? "#f0fdf4"
      : "#fef2f2"
    : dirConfig.bg;
  const verdictBorder = isResolved
    ? isHit
      ? "#bbf7d0"
      : "#fecaca"
    : dirConfig.border;
  const verdictColor = isResolved
    ? isHit
      ? "#16a34a"
      : "#dc2626"
    : dirConfig.color;

  const sourceDomain = getSourceDomain(opinion.sourceUrl);
  const sourceDateLabel = articlePublishedAt
    ? formatRelativeTime(articlePublishedAt)
    : null;

  return (
    <View ref={cardRef} style={styles.card} collapsable={false}>

      {/* S38 fix: RESOLVED stamp moved INLINE — used to be absolute top-right
          and collided with the Follow button. Now lives inside the org row. */}

      {/* ── HEADER ── */}
      <View style={styles.header}>
        <Pressable
          onPress={() =>
            router.push(`/expert/${opinion.expertId}` as Parameters<typeof router.push>[0])
          }
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <ExpertAvatar
            name={opinion.expertName}
            organization={opinion.expertOrganization}
            avatarUrl={opinion.avatarUrl}
            size={42}
          />
        </Pressable>

        <View style={styles.headerMeta}>
          {opinion.isSourceAttribution ? (
            <Pressable
              onPress={() =>
                router.push(`/expert/${opinion.expertId}` as Parameters<typeof router.push>[0])
              }
              hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
            >
              <View style={styles.nameRow}>
                <Text style={styles.expertName} numberOfLines={1}>
                  {opinion.expertOrganization}
                </Text>
                <View style={styles.verifiedBadge}>
                  <Text style={styles.verifiedBadgeText}>✓</Text>
                </View>
              </View>
              <View style={styles.orgBadgeRow}>
                <Text style={styles.expertOrg} numberOfLines={1}>Trusted Source</Text>
                {isResolved && (
                  <View style={styles.resolvedStampInline}>
                    <Text style={styles.resolvedStampText}>RESOLVED</Text>
                  </View>
                )}
              </View>
            </Pressable>
          ) : (
            <Pressable
              onPress={() =>
                router.push(`/expert/${opinion.expertId}` as Parameters<typeof router.push>[0])
              }
              hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
            >
              <AnalystCredibilityBadge
                name={opinion.expertName || opinion.expertOrganization}
                organization={opinion.expertOrganization}
                tier={analystTier ?? null}
                hitRate={weeklyHitRate ?? null}
                resolvedCount={weeklyResolvedCount ?? null}
                size="sm"
              />
              {isResolved && (
                <View style={[styles.orgBadgeRow, { marginTop: 2 }]}>
                  <View style={styles.resolvedStampInline}>
                    <Text style={styles.resolvedStampText}>RESOLVED</Text>
                  </View>
                </View>
              )}
            </Pressable>
          )}
          {/* When the analyst made the call — prefers analystCallAt when the
              extractor surfaced it, falls back to article publishedAt otherwise.
              Color is tuned to recency. */}
          {(() => {
            const callTime = opinion.analystCallAt ?? opinion.publishedAt;
            return callTime ? (
              <Text style={[styles.calledAt, { color: freshnessColor(callTime) }]}>
                Called {formatRelativeTime(callTime)}
              </Text>
            ) : null;
          })()}
        </View>

        {/* Follow button */}
        {onFollowToggle !== undefined && !opinion.isSourceAttribution && (
          <Pressable
            style={[styles.followPill, isFollowed && styles.followPillActive]}
            onPress={handleFollowPress}
            disabled={followPending}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {followPending ? (
              <ActivityIndicator size={10} color={isFollowed ? "#fff" : colors.accent} />
            ) : (
              <Text style={[styles.followPillText, isFollowed && styles.followPillTextActive]}>
                {isFollowed ? "Following" : "Follow"}
              </Text>
            )}
          </Pressable>
        )}
      </View>

      {/* ── VERDICT BADGE (direction + asset name) ── */}
      <View
        style={[
          styles.verdictBadge,
          { backgroundColor: verdictBg, borderColor: verdictBorder },
        ]}
      >
        <Text style={[styles.verdictText, { color: verdictColor }]} numberOfLines={1}>
          {dirConfig.icon}{"  "}{verdictLabel}
          {opinion.instrument ? (
            <Text style={[styles.verdictAssetText, { color: verdictColor }]}>
              {" on "}{opinion.instrument}
            </Text>
          ) : null}
        </Text>
      </View>

      {/* ── TICKER CHIP (the actual symbol — for users who track by ticker) ── */}
      {opinion.instrumentTicker && (
        <View style={styles.tickerRow}>
          <View style={[styles.tickerChip, { borderColor: verdictBorder }]}>
            <Text style={[styles.tickerSymbol, { color: verdictColor }]}>
              {opinion.instrumentTicker}
            </Text>
          </View>
        </View>
      )}

      {/* ── BODY ── */}
      <Pressable onPress={() => setBodyExpanded((x) => !x)}>
        <Text
          style={styles.body}
          numberOfLines={bodyExpanded ? undefined : 3}
        >
          {opinion.quote}
        </Text>
        {!bodyExpanded && opinion.quote.length > 140 && (
          <Text style={styles.moreLink}>more</Text>
        )}
      </Pressable>

      {/* ── SOURCE STRIP ── */}
      <Pressable
        onPress={() => void Linking.openURL(opinion.sourceUrl)}
        style={styles.sourceStrip}
      >
        <Ionicons name="open-outline" size={11} color={colors.textMuted} style={{ marginRight: 4 }} />
        <Text style={styles.sourceText} numberOfLines={1}>
          AI-summarized from{" "}
          <Text style={styles.sourceLink}>{sourceDomain}</Text>
          {sourceDateLabel ? `  ·  ${sourceDateLabel}` : ""}
        </Text>
      </Pressable>

      {/* ── SIBLINGS CHIP — links to story detail which renders all takes
            stacked together with the article hero on top. */}
      {siblings.length > 0 && opinion.storyId && (
        <Pressable
          onPress={() =>
            router.push(`/story/${opinion.storyId}` as Parameters<typeof router.push>[0])
          }
          style={styles.siblingsChip}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={styles.siblingsChipText} numberOfLines={1} ellipsizeMode="tail">
            +{siblings.length} other take{siblings.length === 1 ? "" : "s"} on this story
            {(siblingBullish > 0 || siblingBearish > 0 || siblingNeutral > 0) && " · "}
            {siblingBullish > 0 && (
              <Text style={styles.siblingsChipBullish}>{siblingBullish} bullish</Text>
            )}
            {siblingBullish > 0 && siblingBearish > 0 && <Text style={styles.siblingsChipText}> · </Text>}
            {siblingBearish > 0 && (
              <Text style={styles.siblingsChipBearish}>{siblingBearish} bearish</Text>
            )}
            {(siblingBullish > 0 || siblingBearish > 0) && siblingNeutral > 0 && (
              <Text style={styles.siblingsChipText}> · </Text>
            )}
            {siblingNeutral > 0 && (
              <Text style={styles.siblingsChipNeutral}>{siblingNeutral} neutral</Text>
            )}
          </Text>
          <Text style={styles.siblingsChipChevron}>›</Text>
        </Pressable>
      )}

      {/* ── RESOLUTION REASON ── */}
      {isResolved && opinion.resolutionNote && (
        <View
          style={[
            styles.resolutionBanner,
            { backgroundColor: isHit ? "#f0fdf4" : "#fef2f2", borderLeftColor: isHit ? "#16a34a" : "#dc2626" },
          ]}
        >
          <Text style={[styles.resolutionBannerLabel, { color: isHit ? "#16a34a" : "#dc2626" }]}>
            Why {isHit ? "HIT" : "MISS"}
          </Text>
          <Text style={styles.resolutionBannerText}>{opinion.resolutionNote}</Text>
        </View>
      )}

      {/* ── M6: NARRATIVE STRIP (resolved-only) ── */}
      {isResolved && (() => {
        const callTime = opinion.analystCallAt ?? opinion.publishedAt;
        const daysToResolve = opinion.resolvedAt && callTime
          ? Math.max(1, Math.round((new Date(opinion.resolvedAt).getTime() - new Date(callTime).getTime()) / 86_400_000))
          : null;
        const resolvedDateLabel = opinion.resolvedAt
          ? new Date(opinion.resolvedAt).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : null;
        const impl = tallies?.implication;
        const scoreable = impl ? impl.agree + impl.stronglyAgree + impl.disagree + impl.stronglyDisagree : 0;
        const crowdRight = impl
          ? isHit
            ? impl.agree + impl.stronglyAgree
            : impl.disagree + impl.stronglyDisagree
          : 0;
        const crowdPct = scoreable > 0 ? Math.round((crowdRight / scoreable) * 100) : null;
        const accentColor = isHit ? "#16a34a" : "#dc2626";

        if (!resolvedDateLabel && !daysToResolve && crowdPct === null) return null;
        return (
          <View style={styles.narrativeStrip}>
            {resolvedDateLabel && (
              <View style={styles.narrativeChip}>
                <Text style={styles.narrativeChipText}>
                  📅 Resolved {resolvedDateLabel}
                  {daysToResolve !== null && (
                    <Text style={styles.narrativeChipSubtle}>
                      {"  ·  in "}{daysToResolve} day{daysToResolve === 1 ? "" : "s"}
                    </Text>
                  )}
                </Text>
              </View>
            )}
            {crowdPct !== null && scoreable >= 5 && (
              <View style={[styles.narrativeChip, { backgroundColor: isHit ? "#dcfce7" : "#fee2e2" }]}>
                <Text style={[styles.narrativeChipText, { color: accentColor, fontWeight: "700" }]}>
                  {crowdRight}/{scoreable} voters got this right ({crowdPct}%)
                </Text>
              </View>
            )}
          </View>
        );
      })()}

      {/* ── ENGAGEMENT ZONE ── */}
      <PollA
        opinion={opinion}
        tallies={tallies}
        loadingTallies={loadingTallies && showSkeleton}
        onVoted={handleTalliesUpdate}
      />

      {/* ── FOOTER ── */}
      <View style={styles.footer}>
        <Text style={styles.disclaimer}>
          AI-summarized · Not investment advice · SEBI registered
        </Text>
        <Pressable
          onPress={() => void handleShare()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          disabled={sharing}
          style={styles.shareBtn}
        >
          {sharing ? (
            <ActivityIndicator size={13} color={colors.textSubtle} />
          ) : (
            <Ionicons name="share-outline" size={16} color={colors.textSubtle} />
          )}
        </Pressable>
      </View>

      {/* ── SHARE-ONLY VIEW (off-screen, captured for sharing) ── */}
      <ShareView
        opinion={opinion}
        dirConfig={dirConfig}
        shareViewRef={shareViewRef}
      />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const makeCardStyles = (t: ThemeContextValue) => StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    // Subtle card shadow — Robinhood / fintech premium feel
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    overflow: "visible",
  },

  // Resolved stamp
  resolvedStamp: {
    position: "absolute",
    top: 10,
    right: 10,
    backgroundColor: t.colors.surfaceMuted,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: t.colors.border,
    zIndex: 10,
  },
  resolvedStampText: {
    fontSize: 9,
    fontWeight: "800",
    color: t.colors.textMuted,
    letterSpacing: 1.2,
  },
  resolvedStampInline: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: t.colors.surfaceMuted,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: t.colors.border,
  },

  // Resolution-reason inline banner
  resolutionBanner: {
    marginTop: spacing.sm,
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  resolutionBannerLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  resolutionBannerText: {
    fontSize: 12,
    color: t.colors.text,
    lineHeight: 17,
  },

  // M6: Narrative strip below resolution banner
  narrativeStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: spacing.sm,
  },
  narrativeChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: t.colors.surfaceMuted,
  },
  narrativeChipText: {
    fontSize: 11,
    fontWeight: "600",
    color: t.colors.textMuted,
  },
  narrativeChipSubtle: {
    fontSize: 11,
    fontWeight: "500",
    color: t.colors.textSubtle,
  },

  // Header zone
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: spacing.md,
  },
  headerMeta: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
    gap: 5,
    marginBottom: 2,
  },
  expertName: {
    fontSize: 15,
    fontWeight: "700",
    color: t.colors.text,
    flexShrink: 1,
  },
  verifiedBadge: {
    backgroundColor: "#1D4ED8",
    borderRadius: 10,
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  verifiedBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
  },
  orgBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  expertOrg: {
    fontSize: 12,
    color: t.colors.textMuted,
  },
  calledAt: { fontSize: 11, color: t.colors.textSubtle, marginTop: 2, fontWeight: "500" as const },
  hitRateLabel: {
    fontSize: 11,
    color: "#16a34a",
    fontWeight: "600",
  },

  // Follow pill
  followPill: {
    borderWidth: 1.5,
    borderColor: t.colors.accent,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 72,
  },
  followPillActive: {
    backgroundColor: t.colors.accent,
    borderColor: t.colors.accent,
  },
  followPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: t.colors.accent,
  },
  followPillTextActive: {
    color: "#fff",
  },

  // Verdict badge
  verdictBadge: {
    borderWidth: 1.5,
    borderRadius: 100,
    paddingVertical: 9,
    paddingHorizontal: 24,
    alignItems: "center",
    marginBottom: 10,
  },
  verdictText: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  verdictAssetText: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "none" as const,
  },

  // Ticker chip — small monospace-style badge of the actual Yahoo ticker
  tickerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  tickerChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    backgroundColor: t.colors.surface,
  },
  tickerSymbol: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    fontVariant: ["tabular-nums" as const],
  },

  // Body
  body: {
    fontSize: 14,
    color: t.colors.text,
    lineHeight: 21,
    letterSpacing: 0.1,
    marginBottom: 4,
  },
  moreLink: {
    fontSize: 13,
    color: t.colors.accent,
    fontWeight: "600",
    marginBottom: 6,
  },

  // Source strip
  sourceStrip: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
    marginTop: 2,
  },
  sourceText: {
    fontSize: 12,
    color: t.colors.textMuted,
    flex: 1,
  },
  sourceLink: {
    color: t.colors.accent,
    fontWeight: "600",
  },

  // Siblings chip + sheet
  siblingsChip: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: t.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  siblingsChipText: { fontSize: 12, fontWeight: "600", color: t.colors.textMuted, flex: 1 },
  siblingsChipBullish: { color: "#16a34a", fontWeight: "700" },
  siblingsChipBearish: { color: "#dc2626", fontWeight: "700" },
  siblingsChipNeutral: { color: "#6b7280", fontWeight: "700" },
  siblingsChipChevron: { fontSize: 16, color: t.colors.textSubtle, marginLeft: 6 },

  // Footer
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.border,
  },
  disclaimer: {
    fontSize: 10,
    color: t.colors.textSubtle,
    flex: 1,
    letterSpacing: 0.1,
  },
  shareBtn: {
    paddingLeft: 10,
  },
});
