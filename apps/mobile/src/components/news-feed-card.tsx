import { Link, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SnappedSlider as Slider } from "@/components/snapped-slider";

import type { AppMarketCategory, ApiExpertOpinionItem, ApiExpertOpinionTallies, ApiImplicationChoice, ApiNewsFeedItem } from "@predict-future/types";
import { formatPercent, formatRelativeTime, freshnessColor } from "@predict-future/utils";
import { radius, spacing } from "@predict-future/ui-tokens";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

import { mobileApi } from "@/lib/api";
import { useWatchlist } from "@/providers/watchlist-provider";
import { getExpertInitials, getExpertInitialsColor } from "@/utils/expertAvatar";
import { USE_POST_CARD } from "@/lib/feature-flags";
import { ExpertOpinionPostCard } from "@/components/expert-opinion-post-card";
import { AnalystCredibilityBadge } from "@/components/analyst-credibility-badge";
import { useSession } from "@/providers/session-provider";

// ── Expert opinion direction configuration ──

const DIRECTION_CONFIG = {
  BULLISH: { label: "BULLISH", prefix: "↑", color: "#06D6A0", bg: "#dcfce7", border: "#bbf7d0" },
  BEARISH: { label: "BEARISH", prefix: "↓", color: "#E84855", bg: "#fee2e2", border: "#fecaca" },
  NEUTRAL: { label: "NEUTRAL", prefix: "—", color: "#6B7280", bg: "#f3f4f6", border: "#e5e7eb" },
} as const;

/**
 * Extracts the source domain from a URL for display.
 * Returns a cleaned hostname like "moneycontrol.com".
 */
function getSourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 30);
  }
}

// ── Poll A (Implication) agreement-axis slider configuration ──

/**
 * 5-bucket ordinal scale for Poll A (IMPLICATION) — agreement spectrum.
 * Index 0 = strongest disagreement, index 4 = strongest agreement.
 */
const IMPLICATION_BUCKETS: {
  key: ApiImplicationChoice;
  label: string;
  tickLabel: string;
  color: string;
}[] = [
  { key: "STRONGLY_DISAGREE", label: "Strongly Disagree", tickLabel: "−−", color: "#dc2626" },
  { key: "DISAGREE",          label: "Disagree",          tickLabel: "−",  color: "#f87171" },
  { key: "NEUTRAL",           label: "Neutral",           tickLabel: "0",  color: "#6b7280" },
  { key: "AGREE",             label: "Agree",             tickLabel: "+",  color: "#4ade80" },
  { key: "STRONGLY_AGREE",    label: "Strongly Agree",    tickLabel: "++", color: "#16a34a" },
];

/**
 * Maps any current or legacy implication choice to its bucket index (0-4).
 *   Current (v3 agreement):    STRONGLY_DISAGREE / DISAGREE / NEUTRAL / AGREE / STRONGLY_AGREE
 *   Legacy (v2 magnitude):     STRONG_DROP / MILD_DROP / FLAT / MILD_GAIN / STRONG_GAIN
 *   Legacy (v1 direction):     BEARISH / NEUTRAL / BULLISH
 */
function implicationChoiceToIndex(choice: string): number {
  switch (choice) {
    case "STRONGLY_DISAGREE": case "STRONG_DROP": case "BEARISH": return 0;
    case "DISAGREE":          case "MILD_DROP":                   return 1;
    case "NEUTRAL":           case "FLAT":                        return 2;
    case "AGREE":             case "MILD_GAIN":                   return 3;
    case "STRONGLY_AGREE":    case "STRONG_GAIN": case "BULLISH": return 4;
    default:                                                        return 2; // fallback to NEUTRAL
  }
}

// ─── S33-T4: Live Consensus Bar ───────────────────────────────────────────────

const makeConsensusStyles = (t: ThemeContextValue) => StyleSheet.create({
  preVoteWrap: {
    marginBottom: 6,
  },
  preVoteTrack: {
    flexDirection: "row",
    height: 3,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: t.colors.border,
    marginBottom: 4,
  },
  preVoteFill: {
    backgroundColor: "#16a34a",
    height: 3,
  },
  preVoteRest: {
    backgroundColor: t.colors.border,
    height: 3,
  },
  preVoteLabel: {
    fontSize: 11,
    color: t.colors.textMuted,
    letterSpacing: 0.1,
  },
  postVoteWrap: {
    marginBottom: 6,
  },
  splitTrack: {
    flexDirection: "row",
    height: 5,
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 4,
  },
  splitSegment: {
    height: 5,
  },
  splitLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  splitLabel: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
});

/**
 * Slim social-proof bar showing live Poll A aggregate.
 *
 * Pre-vote (hasVoted=false): single thin teal/green bar + "X% of N readers agreed" text.
 * Post-vote or resolved: split bar — agree (green) / neutral (grey) / disagree (red),
 *   with the user's own side brightened.
 *
 * Only renders when tallies.implication.total > 0.
 */
function ConsensusBar({
  tallies,
  hasVoted,
  userBucketIndex,
}: {
  tallies: ApiExpertOpinionTallies;
  hasVoted: boolean;
  /** 0-4 bucket index for the user's current choice; -1 if no vote */
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

  // S38: hide engagement signal below N=5 — small-N percentages mislead.
  const ENGAGEMENT_MIN = 5;

  if (!hasVoted) {
    // Pre-vote: only show consensus bar when sample is meaningful
    if (impl.total < ENGAGEMENT_MIN) {
      return (
        <View style={consensusStyles.preVoteWrap}>
          <Text style={consensusStyles.preVoteLabel}>
            Vote to see how others stand
          </Text>
        </View>
      );
    }
    return (
      <View style={consensusStyles.preVoteWrap}>
        <View style={consensusStyles.preVoteTrack}>
          <View style={[consensusStyles.preVoteFill, { flex: agreePct }]} />
          <View style={[consensusStyles.preVoteRest, { flex: 100 - agreePct }]} />
        </View>
        <Text style={consensusStyles.preVoteLabel}>
          {agreePct}% of {impl.total} reader{impl.total !== 1 ? "s" : ""} agreed
        </Text>
      </View>
    );
  }

  // Post-vote: split bar — agree / neutral / disagree with user's side highlighted
  const userIsAgree = userBucketIndex >= 3; // AGREE or STRONGLY_AGREE
  const userIsDisagree = userBucketIndex <= 1; // DISAGREE or STRONGLY_DISAGREE
  const userIsNeutral = userBucketIndex === 2;

  const totalSafe = Math.max(impl.total, 1);
  const agreeFlex = Math.round((agreeCount / totalSafe) * 100);
  const neutralFlex = Math.round((neutralCount / totalSafe) * 100);
  const disagreeFlex = 100 - agreeFlex - neutralFlex;

  return (
    <View style={consensusStyles.postVoteWrap}>
      <View style={consensusStyles.splitTrack}>
        {agreeFlex > 0 && (
          <View
            style={[
              consensusStyles.splitSegment,
              {
                flex: agreeFlex,
                backgroundColor: userIsAgree ? "#16a34a" : "#bbf7d0",
              },
            ]}
          />
        )}
        {neutralFlex > 0 && (
          <View
            style={[
              consensusStyles.splitSegment,
              {
                flex: neutralFlex,
                backgroundColor: userIsNeutral ? "#9ca3af" : colors.border,
              },
            ]}
          />
        )}
        {disagreeFlex > 0 && (
          <View
            style={[
              consensusStyles.splitSegment,
              {
                flex: Math.max(disagreeFlex, 1),
                backgroundColor: userIsDisagree ? "#dc2626" : "#fecaca",
              },
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

// ── Poll styles (Poll A + Poll B) ──

const makePollStyles = (t: ThemeContextValue) => StyleSheet.create({
  section: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.border,
  },
  pollBSection: {
    marginTop: spacing.sm,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    color: t.colors.text,
    marginBottom: 6,
  },
  choiceRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  choiceBtn: {
    flex: 1,
    minWidth: 80,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: "center",
  },
  choiceBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },
  tallyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  tallyLabel: {
    fontSize: 11,
    color: t.colors.text,
    width: 72,
  },
  barTrack: {
    flex: 1,
    height: 6,
    backgroundColor: t.colors.border,
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: {
    height: 6,
    borderRadius: 3,
  },
  pctLabel: {
    fontSize: 11,
    fontWeight: "700",
    width: 30,
    textAlign: "right",
  },
  youVotedChip: {
    marginTop: 4,
    fontSize: 10,
    color: t.colors.accent,
    fontWeight: "700",
  },
  crowdSummary: {
    marginTop: 4,
    fontSize: 10,
    color: t.colors.textMuted,
    lineHeight: 14,
  },
  errorText: {
    marginTop: 4,
    fontSize: 10,
    color: t.colors.danger,
  },
  skeletonRow: {
    flexDirection: "row",
    gap: 6,
  },
  skeletonBtn: {
    flex: 1,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: t.colors.border,
  },
  lockedContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    opacity: 0.5,
    paddingVertical: 6,
  },
  lockedText: {
    fontSize: 11,
    color: t.colors.textMuted,
    fontStyle: "italic",
  },
  resolutionChip: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginBottom: 8,
  },
  resolutionChipText: {
    fontSize: 10,
    fontWeight: "700",
  },

  // ── Poll A slider styles ──
  slider: {
    width: "100%",
    height: 36,
    marginVertical: 2,
  },
  sliderPositionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: t.colors.text,
    textAlign: "center",
    marginBottom: 2,
  },
  tickRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    marginTop: 2,
  },
  tickLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: t.colors.textSubtle,
    width: 20,
    textAlign: "center",
  },
  submitVoteBtn: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: "#4338CA",
    alignItems: "center",
    justifyContent: "center",
  },
  submitVoteBtnDisabled: {
    opacity: 0.5,
  },
  submitVoteBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },
  castVoteBtn: {
    backgroundColor: "#4338CA",
    borderRadius: radius.md,
    paddingVertical: 9,
    alignItems: "center",
    marginTop: 8,
  },
  castVoteBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  castVoteHint: {
    fontSize: 10,
    color: t.colors.textMuted,
    marginTop: 4,
    textAlign: "center",
  },
  // Histogram overlay (post-vote)
  histogramRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingHorizontal: 8,
    height: 44,
    marginBottom: 2,
  },
  histogramCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  histogramBar: {
    width: 12,
    borderRadius: 3,
    minHeight: 2,
  },
  medianFlag: {
    marginBottom: 2,
  },
  medianFlagText: {
    fontSize: 9,
    color: t.colors.textMuted,
    lineHeight: 10,
  },
  // Loading skeleton for slider
  sliderSkeletonTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: t.colors.border,
    marginVertical: 14,
    width: "100%",
  },
  sliderSkeletonTick: {
    flex: 1,
    height: 16,
    borderRadius: 2,
    backgroundColor: t.colors.border,
    marginHorizontal: 3,
  },
});

/** Poll A — crowd implication magnitude vote via snapped 5-position slider. */
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
  // Tracks the slider thumb position before the user commits (default: 2 = FLAT)
  const [pendingBucket, setPendingBucket] = useState<number>(2);
  const [localChoice, setLocalChoice] = useState<ApiImplicationChoice | null>(
    tallies?.implication.userChoice ?? null
  );
  const [error, setError] = useState<string | null>(null);

  // Sync from server tallies when they arrive
  useEffect(() => {
    if (tallies?.implication.userChoice) {
      setLocalChoice(tallies.implication.userChoice);
    }
  }, [tallies?.implication.userChoice]);

  const isPending = opinion.resolutionStatus === "PENDING";
  const hasVoted = localChoice !== null;
  const impTallies = tallies?.implication;
  const isLocked = Boolean(impTallies?.userLockedAt);

  const handleSubmit = async () => {
    if (voting) return;
    const choice = IMPLICATION_BUCKETS[pendingBucket]?.key;
    if (!choice) return;
    setVoting(true);
    setError(null);
    const prev = localChoice;
    setLocalChoice(choice); // optimistic
    try {
      const updated = await mobileApi.castExpertOpinionVote(opinion.id, {
        pollType: "IMPLICATION",
        choice,
      });
      onVoted(updated);
    } catch {
      setLocalChoice(prev); // revert
      setError("Vote failed. Try again.");
    } finally {
      setVoting(false);
    }
  };

  const handleLock = async () => {
    if (voting || isLocked) return;
    setVoting(true);
    setError(null);
    try {
      const updated = await mobileApi.lockExpertOpinionVote(opinion.id);
      onVoted(updated);
    } catch {
      setError("Couldn't cast vote. Try again.");
    } finally {
      setVoting(false);
    }
  };

  // Voted thumb position in bucket index
  const votedBucketIndex = localChoice != null
    ? implicationChoiceToIndex(localChoice)
    : 2;

  // Histogram bar heights (normalised 0-1)
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

  // Agreement summary — what % of the crowd agrees with this take
  const crowdSummary = (() => {
    if (!impTallies || impTallies.total === 0) return null;
    const agreeCount = impTallies.agree + impTallies.stronglyAgree;
    const disagreeCount = impTallies.stronglyDisagree + impTallies.disagree;
    const neutralCount = impTallies.neutral;
    const agreePct = Math.round((agreeCount / impTallies.total) * 100);
    return `${agreePct}% of users agree with this take · ${disagreeCount} disagree · ${neutralCount} neutral · ${agreeCount} agree`;
  })();

  // ── Loading skeleton ──
  if (loadingTallies && !hasVoted) {
    return (
      <View style={pollStyles.section}>
        <Text style={pollStyles.sectionHeader}>Where do you stand on this analyst's view?</Text>
        <View style={pollStyles.sliderSkeletonTrack} />
        <View style={pollStyles.skeletonRow}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={pollStyles.sliderSkeletonTick} />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={pollStyles.section}>
      <Text style={pollStyles.sectionHeader}>Where do you stand on this analyst's view?</Text>

      {/* S33-T4: Live consensus bar — pre-vote: thin line; post-vote: split bar */}
      {tallies !== null && (
        <ConsensusBar
          tallies={tallies}
          hasVoted={hasVoted}
          userBucketIndex={hasVoted ? votedBucketIndex : -1}
        />
      )}

      {!hasVoted && isPending ? (
        // ── Pre-vote: interactive slider ──
        <>
          {/* Active position label */}
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

          {/* Tick labels */}
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

          {/* Submit button */}
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
        // ── Post-vote: read-only slider + histogram overlay ──
        <>
          {/* Histogram bars + median flag overlay */}
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
                          ? IMPLICATION_BUCKETS[i]?.color ?? "#6b7280"
                          : (IMPLICATION_BUCKETS[i]?.color ?? "#6b7280") + "55",
                      },
                    ]}
                  />
                </View>
              );
            })}
          </View>

          {/* Read-only slider at voted position */}
          <Slider
            style={pollStyles.slider}
            minimumValue={0}
            maximumValue={4}
            step={1}
            value={votedBucketIndex}
            minimumTrackTintColor={IMPLICATION_BUCKETS[votedBucketIndex]?.color ?? "#6b7280"}
            maximumTrackTintColor={colors.border}
            thumbTintColor={IMPLICATION_BUCKETS[votedBucketIndex]?.color ?? "#6b7280"}
            disabled={true}
          />

          {/* Tick labels */}
          <View style={pollStyles.tickRow}>
            {IMPLICATION_BUCKETS.map((b, i) => (
              <Text
                key={b.key}
                style={[
                  pollStyles.tickLabel,
                  votedBucketIndex === i && { color: b.color, fontWeight: "800" },
                ]}
              >
                {b.tickLabel}
              </Text>
            ))}
          </View>

          {localChoice && isLocked && impTallies?.userLockedAt && (
            <Text style={pollStyles.youVotedChip}>
              ✓ Voted {IMPLICATION_BUCKETS[votedBucketIndex]?.label ?? localChoice}
              {" · "}
              {new Date(impTallies.userLockedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              {!isPending && " · Poll closed"}
            </Text>
          )}

          {localChoice && !isLocked && isPending && (
            <>
              <Pressable
                style={[pollStyles.castVoteBtn, voting && pollStyles.submitVoteBtnDisabled]}
                onPress={() => void handleLock()}
                disabled={voting}
              >
                {voting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={pollStyles.castVoteBtnText}>
                    Cast my vote: {IMPLICATION_BUCKETS[votedBucketIndex]?.label ?? localChoice}
                  </Text>
                )}
              </Pressable>
              <Text style={pollStyles.castVoteHint}>
                Draft only — only cast votes count toward your accuracy.
              </Text>
            </>
          )}

          {localChoice && !isLocked && !isPending && (
            <Text style={pollStyles.youVotedChip}>
              Your draft of {IMPLICATION_BUCKETS[votedBucketIndex]?.label ?? localChoice} didn't count · Poll closed
            </Text>
          )}

          {crowdSummary && (
            <Text style={pollStyles.crowdSummary}>{crowdSummary}</Text>
          )}
        </>
      )}

      {error && (
        <Pressable onPress={() => void handleSubmit()}>
          <Text style={pollStyles.errorText}>{error}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Single expert opinion row — renders avatar, name, quote, direction badge, footer, and polls. */
function ResolutionStrip({ opinion, articlePublishedAt }: { opinion: ApiExpertOpinionItem; articlePublishedAt?: string }) {
  const { colors } = useTheme();
  const expertStyles = useThemedStyles(makeExpertStyles);
  const status = opinion?.resolutionStatus;
  if (status !== "RESOLVED_HIT" && status !== "RESOLVED_MISS") return null;

  const isHit = status === "RESOLVED_HIT";
  const color = isHit ? "#16a34a" : "#dc2626";
  const label = isHit ? "HIT ✓" : "MISS ✗";
  const note = opinion.resolutionNote ?? null;

  const fmt = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null;
  const calledDate = fmt(articlePublishedAt);
  const resolvedDate = fmt(opinion.resolvedAt);

  return (
    <View
      style={[
        expertStyles.resolutionStrip,
        { backgroundColor: isHit ? colors.successSoft : colors.dangerSoft, borderColor: color + "40" },
      ]}
    >
      <View style={[expertStyles.resolutionBadge, { backgroundColor: color }]}>
        <Text style={expertStyles.resolutionBadgeText}>{label}</Text>
      </View>
      <View style={{ flex: 1 }}>
        {note ? (
          <>
            <Text style={[expertStyles.resolutionWhyLabel, { color }]}>
              Why {isHit ? "HIT" : "MISS"}
            </Text>
            <Text style={[expertStyles.resolutionNoteText, { color }]}>
              {note}
            </Text>
          </>
        ) : null}
        {(calledDate || resolvedDate) ? (
          <Text style={expertStyles.resolutionDates}>
            {calledDate ? `Called ${calledDate}` : ""}
            {calledDate && resolvedDate ? "  ·  " : ""}
            {resolvedDate ? `Resolved ${resolvedDate}` : ""}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function ExpertOpinionRow({
  opinion,
  hideByline,
  isFollowed,
  onFollowToggle,
  articlePublishedAt,
}: {
  opinion: ApiExpertOpinionItem;
  hideByline?: boolean;
  /** Whether the current user follows this expert. Undefined = unauthenticated / not loaded */
  isFollowed?: boolean;
  /** Called when user taps Follow/Following. Parent handles optimistic state. */
  onFollowToggle?: (expertId: string, currentlyFollowing: boolean) => void;
  articlePublishedAt?: string;
}) {
  const { colors } = useTheme();
  const expertStyles = useThemedStyles(makeExpertStyles);
  const router = useRouter();
  const dirConfig = DIRECTION_CONFIG[opinion.direction] ?? DIRECTION_CONFIG.NEUTRAL;
  const initials = getExpertInitials(opinion.expertName, opinion.expertOrganization);
  const initialsColor = getExpertInitialsColor(opinion.expertName || opinion.expertOrganization);
  const sourceDomain = getSourceDomain(opinion.sourceUrl);

  // Tallies state — fetched on mount, updated on vote
  const [tallies, setTallies] = useState<ApiExpertOpinionTallies | null>(null);
  const [loadingTallies, setLoadingTallies] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);

  // Optimistic follow state — syncs with parent via isFollowed prop
  const [followPending, setFollowPending] = useState(false);

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
        // silently fail — polls are non-blocking
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

  const handleFollowPress = useCallback(() => {
    if (!onFollowToggle || followPending) return;
    setFollowPending(true);
    onFollowToggle(opinion.expertId, isFollowed ?? false);
    // Clear pending after brief delay — parent updates isFollowed
    setTimeout(() => setFollowPending(false), 600);
  }, [onFollowToggle, followPending, opinion.expertId, isFollowed]);

  const isSourceAttribution = opinion.isSourceAttribution === true;
  const showFollowBtn = !isSourceAttribution && !hideByline && onFollowToggle !== undefined;

  return (
    <View>
      {/* Full analyst byline — hidden for subsequent takes in a grouped card */}
      {!hideByline && (
        <>
          {isSourceAttribution && (
            <View style={expertStyles.sourceAttributionBadge}>
              <Text style={expertStyles.sourceAttributionLabel}>MARKET ANALYSIS</Text>
            </View>
          )}
          <View style={expertStyles.opinionRow}>
            <Pressable
              onPress={() => router.push(`/expert/${opinion.expertId}` as Parameters<typeof router.push>[0])}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              {opinion.avatarUrl ? (
                <Image source={{ uri: opinion.avatarUrl }} style={expertStyles.avatar} />
              ) : (
                <View style={[expertStyles.avatarFallback, { backgroundColor: initialsColor }]}>
                  <Text style={expertStyles.avatarInitials}>{initials}</Text>
                </View>
              )}
            </Pressable>

            <View style={expertStyles.opinionBody}>
              <View style={expertStyles.bylineRow}>
                <View style={expertStyles.bylineInfo}>
                  <Pressable
                    onPress={() => router.push(`/expert/${opinion.expertId}` as Parameters<typeof router.push>[0])}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  >
                    <AnalystCredibilityBadge
                      name={
                        isSourceAttribution
                          ? opinion.expertOrganization
                          : (opinion.expertName || opinion.expertOrganization)
                      }
                      organization={isSourceAttribution ? "Trusted Source" : opinion.expertOrganization}
                      size="sm"
                    />
                  </Pressable>
                  {opinion.publishedAt && (
                    <Text
                      style={[
                        expertStyles.calledAt,
                        { color: freshnessColor(opinion.publishedAt) },
                      ]}
                    >
                      Called {formatRelativeTime(opinion.publishedAt)}
                    </Text>
                  )}
                </View>

                <View style={expertStyles.bylineRight}>
                  {showFollowBtn && (
                    <Pressable
                      style={[
                        expertStyles.followPill,
                        isFollowed && expertStyles.followPillActive,
                      ]}
                      onPress={handleFollowPress}
                      disabled={followPending}
                    >
                      {followPending ? (
                        <ActivityIndicator size={10} color={isFollowed ? "#fff" : colors.accent} />
                      ) : (
                        <Text
                          style={[
                            expertStyles.followPillText,
                            isFollowed && expertStyles.followPillTextActive,
                          ]}
                        >
                          {isFollowed ? "Following" : "Follow"}
                        </Text>
                      )}
                    </Pressable>
                  )}

                  <View
                    style={[
                      expertStyles.directionBadge,
                      { backgroundColor: dirConfig.color, borderColor: dirConfig.color },
                    ]}
                  >
                    <Text style={expertStyles.directionLabel}>
                      {dirConfig.prefix} {dirConfig.label}
                    </Text>
                  </View>
                </View>
              </View>

              <View
                style={[
                  expertStyles.quoteBlock,
                  { borderLeftColor: dirConfig.color, backgroundColor: dirConfig.color + "08" },
                ]}
              >
                <Text style={expertStyles.quoteText}>{opinion.quote}</Text>
              </View>

              <ResolutionStrip opinion={opinion} articlePublishedAt={articlePublishedAt} />

              <Pressable onPress={() => void Linking.openURL(opinion.sourceUrl)}>
                <Text style={expertStyles.footer}>
                  AI-summarized from {sourceDomain}. For educational discussion only. Not investment advice.
                </Text>
              </Pressable>
            </View>
          </View>
        </>
      )}

      {/* Subsequent-take body — direction chip + quote, no avatar/byline */}
      {hideByline && (
        <View style={expertStyles.opinionBody}>
          <View
            style={[
              expertStyles.directionBadge,
              { backgroundColor: dirConfig.color, borderColor: dirConfig.color, alignSelf: "flex-start", marginBottom: 6 },
            ]}
          >
            <Text style={expertStyles.directionLabel}>
              {dirConfig.prefix} {dirConfig.label}
            </Text>
          </View>
          <View
            style={[
              expertStyles.quoteBlock,
              { borderLeftColor: dirConfig.color, backgroundColor: dirConfig.color + "08" },
            ]}
          >
            <Text style={expertStyles.quoteText}>{opinion.quote}</Text>
          </View>

          <ResolutionStrip opinion={opinion} />

          <Pressable onPress={() => void Linking.openURL(opinion.sourceUrl)}>
            <Text style={expertStyles.footer}>
              AI-summarized from {sourceDomain}. For educational discussion only. Not investment advice.
            </Text>
          </Pressable>
        </View>
      )}

      <PollA
        opinion={opinion}
        tallies={tallies}
        loadingTallies={loadingTallies && showSkeleton}
        onVoted={handleTalliesUpdate}
      />
    </View>
  );
}

/** Expert Take section — shows on FINANCE stories with expert opinions. */
function ExpertTakeSection({ opinions }: { opinions: ApiExpertOpinionItem[] }) {
  const { colors } = useTheme();
  const expertStyles = useThemedStyles(makeExpertStyles);
  const [expanded, setExpanded] = useState(false);

  if (opinions.length === 0) return null;

  const visibleOpinions = expanded ? opinions : [opinions[0]];
  const extraCount = opinions.length - 1;

  return (
    <View style={expertStyles.container}>
      <View style={expertStyles.header}>
        <Ionicons name="analytics-outline" size={14} color={colors.accent} />
        <Text style={expertStyles.headerText}>Expert Take</Text>
      </View>

      {visibleOpinions.map((opinion) =>
        USE_POST_CARD ? (
          <ExpertOpinionPostCard key={opinion.id} opinion={opinion} />
        ) : (
          <ExpertOpinionRow key={opinion.id} opinion={opinion} />
        )
      )}

      {extraCount > 0 && !expanded && (
        <Pressable onPress={() => setExpanded(true)} style={expertStyles.expandBtn}>
          <Text style={expertStyles.expandText}>+{extraCount} more take{extraCount > 1 ? "s" : ""}</Text>
        </Pressable>
      )}

      {expanded && extraCount > 0 && (
        <Pressable onPress={() => setExpanded(false)} style={expertStyles.expandBtn}>
          <Text style={expertStyles.expandText}>Show less</Text>
        </Pressable>
      )}
    </View>
  );
}

type Props = {
  item: ApiNewsFeedItem;
  viewportHeight: number;
  showHint?: boolean;
  onVoted?: () => void;
};

// Disabled 2026-06-30: AI news-poll generation cut (quality + belonging).
// Flip to true to restore the market/poll voting block on news cards.
const AI_NEWS_POLL_ENABLED = false;

export function NewsFeedCard({ item, viewportHeight, showHint, onVoted }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { status: authStatus } = useSession();
  const market = item.market;
  const poll = item.poll;

  const existingVote = poll?.userVote;
  const [voted, setVoted] = useState<string | null>(() => {
    if (!existingVote) return null;
    if (existingVote.side) return existingVote.side;
    if (existingVote.numericValue != null) return String(existingVote.numericValue);
    return null;
  });
  const [voting, setVoting] = useState(false);
  const [numericInput, setNumericInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Optimistic vote counts (updated immediately on tap, reverted on API failure)
  const [optimisticYesCount, setOptimisticYesCount] = useState<number | null>(null);
  const [optimisticNoCount, setOptimisticNoCount] = useState<number | null>(null);
  const [optimisticTotal, setOptimisticTotal] = useState<number | null>(null);

  // Animated bar for post-vote live results
  const barAnim = useRef(new Animated.Value(existingVote ? 1 : 0)).current;

  const pollClosed =
    poll?.status === "CLOSED" ||
    poll?.status === "RESOLVED" ||
    (poll?.closeAt && new Date(poll.closeAt) <= new Date());

  // Use optimistic counts when available, otherwise fall back to server counts
  const yesCount = optimisticYesCount ?? poll?.yesCount ?? 0;
  const noCount = optimisticNoCount ?? poll?.noCount ?? 0;
  const totalVotesDisplay = optimisticTotal ?? (poll?.totalVotes ?? 0);
  const yesPctDisplay =
    totalVotesDisplay > 0 ? (yesCount / totalVotesDisplay) * 100 : 50;

  const barYesWidth = barAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", `${Math.max(4, Math.min(96, yesPctDisplay))}%`],
  });

  // Watchlist
  const watchlist = useWatchlist();
  const isBookmarked = market ? watchlist.has(market.id) : false;
  function toggleBookmark() {
    if (!market) return;
    if (isBookmarked) {
      watchlist.remove(market.id);
    } else {
      watchlist.add({ id: market.id, title: market.title, status: market.status ?? "OPEN" });
    }
  }

  async function handleVote(side?: string, numericValue?: number) {
    if (!poll || voting) return;
    setVoting(true);
    setError(null);

    // Snapshot current counts for potential revert
    const prevVoted = voted;
    const prevYesCount = optimisticYesCount ?? poll.yesCount;
    const prevNoCount = optimisticNoCount ?? poll.noCount;
    const prevTotal = optimisticTotal ?? poll.totalVotes;

    // Apply optimistic update immediately
    const newVote = side ?? String(numericValue);
    setVoted(newVote);
    if (side) {
      const newTotal = prevTotal + 1;
      const newYes = side === "YES" ? prevYesCount + 1 : prevYesCount;
      const newNo = side === "NO" ? prevNoCount + 1 : prevNoCount;
      setOptimisticYesCount(newYes);
      setOptimisticNoCount(newNo);
      setOptimisticTotal(newTotal);
    }

    // Animate bar to new percentages
    Animated.spring(barAnim, {
      toValue: 1,
      tension: 40,
      friction: 8,
      useNativeDriver: false,
    }).start();

    try {
      await mobileApi.castVote(poll.id, { side, numericValue });
      // Vote confirmed — trigger feed refresh so insight cards update
      onVoted?.();
    } catch (err: unknown) {
      // Revert optimistic update on failure
      setVoted(prevVoted);
      setOptimisticYesCount(prevYesCount !== (poll.yesCount) ? prevYesCount : null);
      setOptimisticNoCount(prevNoCount !== (poll.noCount) ? prevNoCount : null);
      setOptimisticTotal(prevTotal !== (poll.totalVotes) ? prevTotal : null);
      barAnim.setValue(prevVoted ? 1 : 0);
      const message = err instanceof Error ? err.message : "Vote failed. Please try again.";
      setError(message);
    } finally {
      setVoting(false);
    }
  }

  const hasImage = !!item.imageUrl;
  const heroHeight = Math.round(viewportHeight * 0.42);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);

  const categoryColor = CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.GENERAL;

  // Share text + an app-deep-link (https App Link on our domain) so tapping opens
  // the story inside the app. (Share.share's `url` field is iOS-only; the link goes
  // in the message so it works on Android, where we ship.)
  const handleShare = () =>
    void Share.share({
      message: `${item.headline}\n\nvia Predict Future\nhttps://predictfuture-api.duckdns.org/story/${item.id}`,
    });

  /** Overlays rendered on top of both the image and placeholder. */
  const heroOverlays = (
    <>
      {/* Category pill — top-left */}
      <View style={[styles.categoryOverlay, { backgroundColor: categoryColor }]}>
        <Text style={styles.categoryOverlayText}>{item.category}</Text>
      </View>

      {/* Source + Share row — bottom */}
      <View style={styles.imageOverlayBottom}>
        <View style={styles.sourceOverlayPill}>
          <Text style={styles.sourceOverlayText} numberOfLines={1}>{item.sourceName}</Text>
        </View>
        <Pressable
          style={styles.shareOverlayBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={handleShare}
        >
          <Ionicons name="share-outline" size={16} color="#111" />
        </Pressable>
      </View>
    </>
  );

  return (
    <View style={[styles.frame, { height: viewportHeight }]}>
      {/* Full-screen image viewer modal */}
      {hasImage && (
        <Modal
          visible={imageViewerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setImageViewerOpen(false)}
        >
          <Pressable
            style={styles.imageModalBackdrop}
            onPress={() => setImageViewerOpen(false)}
          >
            <Image
              source={{ uri: item.imageUrl! }}
              style={styles.imageModalFull}
              resizeMode="contain"
            />
            <Pressable
              style={styles.imageModalClose}
              onPress={() => setImageViewerOpen(false)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.imageModalCloseText}>✕</Text>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      <View style={styles.card}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          {hasImage ? (
            <Pressable
              onPress={() => setImageViewerOpen(true)}
              style={[styles.heroWrapper, { height: heroHeight }]}
            >
              <Image
                source={{ uri: item.imageUrl! }}
                style={styles.heroImage}
                resizeMode="cover"
              />
              {heroOverlays}
            </Pressable>
          ) : (
            <View
              style={[
                styles.heroWrapper,
                styles.heroPlaceholder,
                { backgroundColor: categoryColor, height: heroHeight },
              ]}
            >
              <Text style={styles.placeholderEmoji}>
                {CATEGORY_EMOJI[item.category] ?? "📰"}
              </Text>
              {heroOverlays}
            </View>
          )}

          <View style={styles.content}>
            <Text style={styles.headline}>{item.headline}</Text>
            <Text style={styles.summary}>{item.summary}</Text>

            {/* Finance discovery chip — shown only for FINANCE stories with expert opinions */}
            {item.category === "FINANCE" && item.expertOpinions && item.expertOpinions.length > 0 && (
              <Pressable
                style={styles.financeChip}
                onPress={() =>
                  router.push(`/story/${item.id}` as Parameters<typeof router.push>[0])
                }
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              >
                <Text style={styles.financeChipText}>
                  {"📊 "}
                  {item.expertOpinions.length}{" "}
                  {item.expertOpinions.length === 1 ? "expert take" : "expert takes"}
                  {" — view on Finance →"}
                </Text>
              </Pressable>
            )}

            {/* Inshorts-style footer: time · Read more */}
            <View style={styles.footer}>
              <View style={styles.footerLeft}>
                <Text style={styles.footerMeta}>
                  {formatRelativeTime(item.publishedAt)}
                </Text>
                {authStatus === "authenticated" && (
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/(tabs)/create",
                        params: {
                          initialDescription: `Context: ${item.headline}\nhttps://predictfuture.app/story/${item.id}`,
                          initialCategory: mapNewsCategory(item.category),
                        },
                      })
                    }
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    style={styles.createBetCta}
                  >
                    <Ionicons name="add-circle-outline" size={12} color={colors.textMuted} style={styles.createBetIcon} />
                    <Text style={styles.createBetLabel}>Create a bet</Text>
                  </Pressable>
                )}
              </View>
              <Pressable onPress={() => void Linking.openURL(item.sourceUrl)}>
                <Text style={styles.readMoreLink}>Read more →</Text>
              </Pressable>
            </View>

            {/* Expert Take is intentionally NOT shown here —
                Feed is for news + AI polls only.
                Expert opinions live on the dedicated Finance tab. */}

            {/* Disabled 2026-06-30: AI news-poll cut — market/poll block hidden.
                PollA (analyst Opine vote) on ExpertOpinionRow is unaffected.
                Re-enable by flipping AI_NEWS_POLL_ENABLED to true below. */}
            {AI_NEWS_POLL_ENABLED && market ? (
              <View style={styles.marketBlock}>
                {/* Market title row with bookmark */}
                <View style={styles.marketTitleRow}>
                  <Text style={styles.marketTitle}>
                    {market.title}
                  </Text>
                  <Pressable onPress={toggleBookmark} hitSlop={8} style={styles.bookmarkBtn}>
                    <Ionicons
                      name={isBookmarked ? "bookmark" : "bookmark-outline"}
                      size={18}
                      color={isBookmarked ? colors.accent : colors.textMuted}
                    />
                  </Pressable>
                </View>

                {/* Progress bar — crowd probability (hidden once user has voted; live results bar takes over) */}
                {!voted && poll && poll.totalVotes > 0 ? (
                  <>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${Math.max(8, (poll.yesCount / poll.totalVotes) * 100)}%` },
                        ]}
                      />
                    </View>
                    <View style={styles.poolRow}>
                      <Text style={styles.poolLabel}>
                        YES {formatPercent(poll.yesCount / poll.totalVotes)}
                      </Text>
                      <Text style={styles.poolLabel}>{poll.totalVotes} votes</Text>
                    </View>
                  </>
                ) : null}

                {/* Vote / results area */}
                {pollClosed ? (
                  <View style={styles.closedBanner}>
                    <Text style={styles.closedText}>Poll closed</Text>
                  </View>
                ) : voted ? (
                  // ── Live results (animated, optimistic) ──
                  <View style={styles.liveResults}>
                    {poll?.marketType === "NUMERIC" ? (
                      <View style={styles.numericResult}>
                        <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                        <Text style={styles.numericResultText}>
                          Your guess: {voted}
                          {poll?.unit ? ` ${poll.unit}` : ""}
                        </Text>
                        {poll?.averageNumericValue != null && (
                          <Text style={styles.crowdAvg}>
                            Crowd avg:{" "}
                            {poll.averageNumericValue.toFixed(1)}
                            {poll.unit ? ` ${poll.unit}` : ""}
                          </Text>
                        )}
                      </View>
                    ) : (
                      <>
                        <View style={styles.liveBarTrack}>
                          <Animated.View
                            style={[styles.liveBarYes, { width: barYesWidth }]}
                          />
                        </View>
                        <View style={styles.liveLabelsRow}>
                          <Text style={styles.liveLabelYes}>
                            YES {Math.round(yesPctDisplay)}%
                          </Text>
                          <Text style={styles.liveTotalVotes}>
                            {totalVotesDisplay} votes
                          </Text>
                          <Text style={styles.liveLabelNo}>
                            NO {Math.round(100 - yesPctDisplay)}%
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.yourVoteBadge,
                            voted === "YES" ? styles.yourVoteYes : styles.yourVoteNo,
                          ]}
                        >
                          <Ionicons
                            name="checkmark-circle"
                            size={14}
                            color={voted === "YES" ? colors.success : colors.danger}
                          />
                          <Text
                            style={[
                              styles.yourVoteText,
                              voted === "YES" ? styles.yourVoteTextYes : styles.yourVoteTextNo,
                            ]}
                          >
                            You voted {voted}
                          </Text>
                        </View>
                      </>
                    )}
                  </View>
                ) : poll && poll.status === "OPEN" ? (
                  poll.marketType === "NUMERIC" ? (
                    <View style={styles.numericVoteRow}>
                      <TextInput
                        style={styles.numericInput}
                        placeholder={
                          poll.minValue != null && poll.maxValue != null
                            ? `${poll.minValue} – ${poll.maxValue}`
                            : "Your guess"
                        }
                        placeholderTextColor={colors.textMuted}
                        keyboardType="numeric"
                        value={numericInput}
                        onChangeText={setNumericInput}
                        editable={!voting}
                      />
                      {poll.unit ? (
                        <Text style={styles.unitLabel}>{poll.unit}</Text>
                      ) : null}
                      <Pressable
                        style={[
                          styles.submitBtn,
                          (!numericInput || voting) && styles.btnDisabled,
                        ]}
                        onPress={() => {
                          const val = parseFloat(numericInput);
                          if (!isNaN(val)) void handleVote(undefined, val);
                        }}
                        disabled={!numericInput || voting}
                      >
                        {voting ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.submitBtnText}>Submit</Text>
                        )}
                      </Pressable>
                    </View>
                  ) : (
                    <View style={styles.binaryVoteRow}>
                      <Pressable
                        style={[styles.yesBtn, voting && styles.btnDisabled]}
                        onPress={() => void handleVote("YES")}
                        disabled={voting}
                      >
                        {voting ? (
                          <ActivityIndicator size="small" color={colors.success} />
                        ) : (
                          <>
                            <Text style={styles.yesBtnLabel}>YES</Text>
                            {poll.totalVotes > 0 && (
                              <Text style={styles.btnPct}>
                                {Math.round((poll.yesCount / poll.totalVotes) * 100)}%
                              </Text>
                            )}
                          </>
                        )}
                      </Pressable>
                      <Pressable
                        style={[styles.noBtn, voting && styles.btnDisabled]}
                        onPress={() => void handleVote("NO")}
                        disabled={voting}
                      >
                        {voting ? (
                          <ActivityIndicator size="small" color={colors.danger} />
                        ) : (
                          <>
                            <Text style={styles.noBtnLabel}>NO</Text>
                            {poll.totalVotes > 0 && (
                              <Text style={styles.btnPct}>
                                {Math.round((poll.noCount / poll.totalVotes) * 100)}%
                              </Text>
                            )}
                          </>
                        )}
                      </Pressable>
                    </View>
                  )
                ) : (
                  <Link href={`/market/${market.id}`} style={styles.link}>
                    Predict →
                  </Link>
                )}

                {error ? <Text style={styles.errorText}>{error}</Text> : null}
              </View>
            ) : AI_NEWS_POLL_ENABLED ? (
              <View style={styles.marketBlock}>
                <Text style={styles.marketTitle}>Generating prediction…</Text>
                <Text style={styles.summary}>
                  This story is live — a market will appear shortly.
                </Text>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </View>

      {/* Swipe hint */}
      {showHint && (
        <View style={styles.swipeHint} pointerEvents="none">
          <Ionicons name="chevron-up" size={20} color="rgba(255,255,255,0.8)" />
          <Text style={styles.swipeHintText}>Swipe up for next story</Text>
        </View>
      )}
    </View>
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  TECH: "#7C3AED",
  BUSINESS: "#0369A1",
  SPORTS: "#DC2626",
  ENTERTAINMENT: "#D97706",
  WEATHER: "#0EA5E9",
  GENERAL: "#64748B",
  PRODUCT: "#059669",
  COMPANY: "#4338CA",
  FINANCE: "#4338CA",
};

const NEWS_TO_MARKET_CATEGORY: Record<string, AppMarketCategory> = {
  FINANCE: "FINANCE",
  BUSINESS: "BUSINESS",
  TECH: "TECH",
  SPORTS: "SPORTS",
  ENTERTAINMENT: "ENTERTAINMENT",
  WEATHER: "WEATHER",
  COMPANY: "BUSINESS",
  PRODUCT: "TECH",
  GENERAL: "GENERAL",
};

function mapNewsCategory(c: string): AppMarketCategory {
  return NEWS_TO_MARKET_CATEGORY[c] ?? "GENERAL";
}

const CATEGORY_EMOJI: Record<string, string> = {
  TECH: "💻",
  BUSINESS: "📈",
  SPORTS: "⚽",
  ENTERTAINMENT: "🎬",
  WEATHER: "🌤️",
  GENERAL: "📰",
  PRODUCT: "🚀",
  COMPANY: "🏢",
  FINANCE: "📊",
};

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  frame: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    justifyContent: "center",
    backgroundColor: t.colors.background,
  },
  card: {
    flex: 1,
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...t.shadows.card,
  },
  scrollView: { flex: 1 },
  scrollContent: { flexGrow: 1 },

  // Hero wrapper — relative container for image + absolute overlays
  heroWrapper: {
    width: "100%",
    position: "relative",
    overflow: "hidden",
  },
  // Hero image fills the wrapper (height comes from wrapper)
  heroImage: {
    width: "100%",
    height: "100%",
  },
  heroPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.85,
  },
  placeholderEmoji: { fontSize: 52 },

  // Category pill overlay — top-left corner of hero
  categoryOverlay: {
    position: "absolute",
    top: 10,
    left: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  categoryOverlayText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#fff",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  // Source + Share overlay row — pinned to bottom of hero
  imageOverlayBottom: {
    position: "absolute",
    bottom: 10,
    left: 10,
    right: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sourceOverlayPill: {
    backgroundColor: "#fff",
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    flexShrink: 1,
    maxWidth: "80%",
  },
  sourceOverlayText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#111",
    letterSpacing: 0.2,
  },
  shareOverlayBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  // Full-screen image viewer modal
  imageModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    alignItems: "center",
    justifyContent: "center",
  },
  imageModalFull: {
    width: "100%",
    height: "100%",
  },
  imageModalClose: {
    position: "absolute",
    top: 52,
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  imageModalCloseText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
    lineHeight: 20,
  },

  // Content flows top-down (flex-start kills the centered white gap)
  content: { flex: 1, padding: spacing.lg, justifyContent: "flex-start" },
  headline: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    color: t.colors.text,
  },
  summary: {
    marginTop: spacing.md,
    fontSize: 14,
    lineHeight: 20,
    color: t.colors.text,
  },

  // Inshorts-style footer: muted time · source + Read more link
  footer: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.border,
  },
  footerMeta: {
    fontSize: 12,
    color: t.colors.textMuted,
    flexShrink: 1,
    marginRight: spacing.sm,
  },
  readMoreLink: {
    fontSize: 13,
    fontWeight: "600",
    color: t.colors.accent,
    flexShrink: 0,
  },

  // Left column of footer — stacks time and optional "Create a bet" CTA
  footerLeft: {
    flexShrink: 1,
    flexDirection: "column",
    gap: 4,
  },
  createBetCta: {
    flexDirection: "row",
    alignItems: "center",
  },
  createBetIcon: {
    marginRight: 3,
  },
  createBetLabel: {
    fontSize: 11,
    color: t.colors.textMuted,
  },

  financeChip: {
    alignSelf: "flex-start",
    marginTop: spacing.sm,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(58, 134, 255, 0.10)",
    borderWidth: 1,
    borderColor: "#3A86FF",
  },
  financeChipText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#3A86FF",
  },
  marketBlock: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: t.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: t.colors.border,
    // Prevent the poll panel from growing unbounded on small viewports
    maxHeight: 260,
    overflow: "hidden",
  },
  marketTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  marketTitle: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "700",
    color: t.colors.text,
  },
  bookmarkBtn: {
    paddingTop: 2,
  },
  progressTrack: {
    marginTop: spacing.md,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: t.colors.border,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: t.colors.accent,
  },
  poolRow: {
    marginTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  poolLabel: { fontSize: 12, fontWeight: "600", color: t.colors.textMuted },

  // Binary vote buttons
  binaryVoteRow: {
    marginTop: spacing.md,
    flexDirection: "row",
    gap: spacing.sm,
  },
  yesBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: t.colors.successSoft,
    borderWidth: 1,
    borderColor: t.colors.success,
    alignItems: "center",
    justifyContent: "center",
  },
  noBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: t.colors.dangerSoft,
    borderWidth: 1,
    borderColor: t.colors.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  yesBtnLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5, color: t.colors.success },
  noBtnLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5, color: t.colors.danger },
  btnPct: { fontSize: 20, fontWeight: "700", color: t.colors.text, marginTop: 2 },
  btnDisabled: { opacity: 0.5 },

  // Numeric vote
  numericVoteRow: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  numericInput: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: t.colors.text,
    backgroundColor: t.colors.surface,
  },
  unitLabel: { fontSize: 13, fontWeight: "600", color: t.colors.textMuted },
  submitBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
    borderRadius: radius.md,
    backgroundColor: t.colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  submitBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },

  // ── Live results (post-vote) ──
  liveResults: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  liveBarTrack: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: t.colors.dangerSoft,
    overflow: "hidden",
  },
  liveBarYes: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: t.colors.success,
  },
  liveLabelsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  liveLabelYes: { fontSize: 13, fontWeight: "700", color: t.colors.success },
  liveLabelNo: { fontSize: 13, fontWeight: "700", color: t.colors.danger },
  liveTotalVotes: { fontSize: 12, color: t.colors.textMuted },
  yourVoteBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignSelf: "flex-start",
  },
  yourVoteYes: { backgroundColor: t.colors.successSoft, borderWidth: 1, borderColor: t.colors.success },
  yourVoteNo: { backgroundColor: t.colors.dangerSoft, borderWidth: 1, borderColor: t.colors.danger },
  yourVoteText: { fontSize: 13, fontWeight: "700" },
  yourVoteTextYes: { color: t.colors.success },
  yourVoteTextNo: { color: t.colors.danger },

  // Numeric result
  numericResult: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: t.colors.successSoft,
    borderWidth: 1,
    borderColor: t.colors.success,
    flexWrap: "wrap",
  },
  numericResultText: { fontSize: 13, fontWeight: "700", color: t.colors.success },
  crowdAvg: { fontSize: 12, color: t.colors.textMuted, marginLeft: "auto" },

  // Closed
  closedBanner: {
    marginTop: spacing.md,
    paddingVertical: 11,
    borderRadius: radius.md,
    backgroundColor: t.colors.surfaceMuted,
    alignItems: "center",
  },
  closedText: { fontSize: 14, fontWeight: "700", color: t.colors.textMuted },

  errorText: { marginTop: spacing.sm, fontSize: 12, color: t.colors.danger },
  link: { marginTop: spacing.md, fontSize: 14, fontWeight: "700", color: t.colors.accent },

  // Swipe hint
  swipeHint: {
    position: "absolute",
    bottom: spacing.xl,
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 4,
  },
  swipeHintText: {
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255,255,255,0.8)",
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});

// ── Expert Take styles ──

const makeExpertStyles = (t: ThemeContextValue) => StyleSheet.create({
  container: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: t.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: spacing.sm,
  },
  headerText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: t.colors.accent,
  },
  opinionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    flexShrink: 0,
  },
  avatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarInitials: {
    fontSize: 11,
    fontWeight: "800",
    color: "#fff",
  },
  opinionBody: {
    flex: 1,
    gap: 6,
  },
  bylineRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  bylineInfo: {
    flex: 1,
    gap: 2,
  },
  bylineRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  followPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: t.colors.accent,
    minWidth: 66,
    alignItems: "center",
    justifyContent: "center",
  },
  followPillActive: {
    backgroundColor: t.colors.accent,
    borderColor: t.colors.accent,
  },
  followPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: t.colors.accent,
  },
  followPillTextActive: {
    color: "#fff",
  },
  sourceAttributionBadge: {
    alignSelf: "flex-start",
    backgroundColor: t.colors.accentSoft,
    borderWidth: 1,
    borderColor: t.colors.accent,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 6,
  },
  sourceAttributionLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: t.colors.accent,
    letterSpacing: 0.5,
  },
  expertNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  expertName: {
    fontSize: 15,
    fontWeight: "600",
    color: t.colors.text,
    flexShrink: 1,
  },
  expertOrg: {
    fontSize: 12,
    color: t.colors.textMuted,
  },
  calledAt: { fontSize: 11, color: t.colors.textSubtle, marginTop: 2, fontWeight: "500" as const },
  verifiedBadge: {
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  verifiedBadgeText: {
    fontSize: 7,
    fontWeight: "800",
    color: "#fff",
    lineHeight: 11,
  },
  directionBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexShrink: 0,
  },
  directionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.2,
  },
  quoteBlock: {
    borderLeftWidth: 3,
    paddingLeft: spacing.sm,
    paddingVertical: 4,
    borderRadius: 2,
  },
  quoteText: {
    fontSize: 14,
    lineHeight: 20,
    color: t.colors.text,
  },
  footer: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 14,
    color: t.colors.textMuted,
    textDecorationLine: "underline",
  },
  resolutionStrip: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 6,
    borderWidth: 1,
    padding: 8,
    marginTop: 6,
    marginBottom: 2,
  },
  resolutionBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexShrink: 0,
  },
  resolutionBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#fff",
  },
  resolutionWhyLabel: {
    fontSize: 9,
    fontWeight: "800" as const,
    letterSpacing: 0.6,
    marginBottom: 1,
  },
  resolutionNoteText: {
    fontSize: 11,
    lineHeight: 15,
    fontStyle: "italic" as const,
  },
  resolutionDates: {
    fontSize: 10,
    color: t.colors.textMuted,
    marginTop: 3,
  },
  expandBtn: {
    marginTop: spacing.xs,
    paddingVertical: 4,
  },
  expandText: {
    fontSize: 12,
    fontWeight: "700",
    color: t.colors.accent,
  },
});
