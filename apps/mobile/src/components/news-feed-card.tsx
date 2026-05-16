import { Link, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SnappedSlider as Slider } from "@/components/snapped-slider";

import type { ApiExpertOpinionItem, ApiExpertOpinionTallies, ApiImplicationChoice, ApiNewsFeedItem } from "@predict-future/types";
import { formatPercent, formatRelativeTime } from "@predict-future/utils";
import { colors, radius, shadows, spacing } from "@predict-future/ui-tokens";

import { mobileApi } from "@/lib/api";
import { useWatchlist } from "@/providers/watchlist-provider";
import { getExpertInitials, getExpertInitialsColor } from "@/utils/expertAvatar";

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

// ── Poll B (Retrospective) configuration ──

const RETROSPECTIVE_CHOICES = [
  { key: "HIT", label: "Aged well", color: "#16a34a", bg: "#dcfce7", border: "#bbf7d0" },
  { key: "MISS", label: "Missed the mark", color: "#dc2626", bg: "#fee2e2", border: "#fecaca" },
] as const;

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
            maximumTrackTintColor="#E5E7EB"
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
            maximumTrackTintColor="#E5E7EB"
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

          {localChoice && (
            <Text style={pollStyles.youVotedChip}>
              You voted {IMPLICATION_BUCKETS[votedBucketIndex]?.label ?? localChoice}
              {!isPending && " · Poll closed"}
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

/** Poll B — retrospective vote: did this call age well? */
function PollB({
  opinion,
  tallies,
  onVoted,
}: {
  opinion: ApiExpertOpinionItem;
  tallies: ApiExpertOpinionTallies | null;
  onVoted: (tallies: ApiExpertOpinionTallies) => void;
}) {
  const [voting, setVoting] = useState(false);
  const [localChoice, setLocalChoice] = useState<string | null>(
    tallies?.retrospective.userChoice ?? null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tallies?.retrospective.userChoice) {
      setLocalChoice(tallies.retrospective.userChoice);
    }
  }, [tallies?.retrospective.userChoice]);

  const isLocked = tallies?.retrospective.isLocked ?? opinion.resolutionStatus === "PENDING";
  const hasVoted = localChoice !== null;
  const retroTallies = tallies?.retrospective;

  const computePercent = (count: number, total: number) =>
    total > 0 ? Math.round((count / total) * 100) : 0;

  const handleVote = async (choice: string) => {
    if (voting || isLocked) return;
    setVoting(true);
    setError(null);
    const prev = localChoice;
    setLocalChoice(choice); // optimistic
    try {
      const updated = await mobileApi.castExpertOpinionVote(opinion.id, {
        pollType: "RETROSPECTIVE",
        choice,
      });
      onVoted(updated);
    } catch {
      setLocalChoice(prev); // revert
      setError("Vote failed. Tap to retry.");
    } finally {
      setVoting(false);
    }
  };

  const resolutionLabel =
    opinion.resolutionStatus === "RESOLVED_HIT"
      ? "HIT"
      : opinion.resolutionStatus === "RESOLVED_MISS"
        ? "MISS"
        : null;

  const resolvedDateStr = opinion.resolvedAt
    ? new Date(opinion.resolvedAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <View style={[pollStyles.section, pollStyles.pollBSection]}>
      <View style={pollStyles.sectionHeaderRow}>
        <Text style={pollStyles.sectionHeader}>Did this call age well?</Text>
        {/* Poll B unlock path: triggered by POST /api/admin/expert-opinions/[id]/resolve (S16-T1) */}
      </View>

      {isLocked ? (
        <View style={pollStyles.lockedContainer}>
          <Ionicons name="lock-closed-outline" size={16} color="#9CA3AF" />
          <Text style={pollStyles.lockedText}>Re-opens when this event resolves</Text>
        </View>
      ) : (
        <>
          {resolutionLabel && resolvedDateStr && (
            <View
              style={[
                pollStyles.resolutionChip,
                { backgroundColor: resolutionLabel === "HIT" ? "#dcfce7" : "#fee2e2" },
              ]}
            >
              <Text
                style={[
                  pollStyles.resolutionChipText,
                  { color: resolutionLabel === "HIT" ? "#16a34a" : "#dc2626" },
                ]}
              >
                Resolution: {resolutionLabel} · Resolved {resolvedDateStr}
              </Text>
            </View>
          )}

          {!hasVoted ? (
            <View style={pollStyles.choiceRow}>
              {RETROSPECTIVE_CHOICES.map((c) => (
                <Pressable
                  key={c.key}
                  style={[pollStyles.choiceBtn, { borderColor: c.border, backgroundColor: c.bg }]}
                  onPress={() => void handleVote(c.key)}
                  disabled={voting}
                >
                  <Text style={[pollStyles.choiceBtnText, { color: c.color }]}>{c.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <>
              {RETROSPECTIVE_CHOICES.map((c) => {
                const count = c.key === "HIT" ? retroTallies?.hit ?? 0 : retroTallies?.miss ?? 0;
                const pct = computePercent(count, retroTallies?.total ?? 0);
                const isUserChoice = localChoice === c.key;
                return (
                  <View key={c.key} style={pollStyles.tallyRow}>
                    <Text style={[pollStyles.tallyLabel, isUserChoice && { fontWeight: "800" }]}>
                      {c.label}
                    </Text>
                    <View style={pollStyles.barTrack}>
                      <View
                        style={[pollStyles.barFill, { width: `${pct}%`, backgroundColor: c.color }]}
                      />
                    </View>
                    <Text style={[pollStyles.pctLabel, { color: c.color }]}>{pct}%</Text>
                  </View>
                );
              })}
              {localChoice && (
                <Text style={pollStyles.youVotedChip}>
                  You voted{" "}
                  {RETROSPECTIVE_CHOICES.find((c) => c.key === localChoice)?.label ?? localChoice}
                </Text>
              )}
            </>
          )}
          {error && <Text style={pollStyles.errorText}>{error}</Text>}
        </>
      )}
    </View>
  );
}

/** Single expert opinion row — renders avatar, name, quote, direction badge, footer, and polls. */
function ResolutionStrip({ opinion, articlePublishedAt }: { opinion: ApiExpertOpinionItem; articlePublishedAt?: string }) {
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
        { backgroundColor: isHit ? "#f0fdf4" : "#fef2f2", borderColor: color + "40" },
      ]}
    >
      <View style={[expertStyles.resolutionBadge, { backgroundColor: color }]}>
        <Text style={expertStyles.resolutionBadgeText}>{label}</Text>
      </View>
      <View style={{ flex: 1 }}>
        {note ? (
          <Text style={[expertStyles.resolutionNoteText, { color }]}>
            {note}
          </Text>
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
                    <View style={expertStyles.expertNameRow}>
                      <Text style={expertStyles.expertName} numberOfLines={1}>
                        {isSourceAttribution
                          ? opinion.expertOrganization
                          : (opinion.expertName || opinion.expertOrganization)}
                      </Text>
                      {(isSourceAttribution || opinion.verified) && (
                        <View style={expertStyles.verifiedBadge}>
                          <Text style={expertStyles.verifiedBadgeText}>✓</Text>
                        </View>
                      )}
                    </View>
                  </Pressable>
                  <Text style={expertStyles.expertOrg} numberOfLines={1}>
                    {isSourceAttribution ? "Trusted Source" : opinion.expertOrganization}
                  </Text>
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
      <PollB opinion={opinion} tallies={tallies} onVoted={handleTalliesUpdate} />
    </View>
  );
}

/** Expert Take section — shows on FINANCE stories with expert opinions. */
function ExpertTakeSection({ opinions }: { opinions: ApiExpertOpinionItem[] }) {
  const [expanded, setExpanded] = useState(false);

  if (opinions.length === 0) return null;

  const visibleOpinions = expanded ? opinions : [opinions[0]];
  const extraCount = opinions.length - 1;

  return (
    <View style={expertStyles.container}>
      <View style={expertStyles.header}>
        <Ionicons name="analytics-outline" size={14} color="#4338ca" />
        <Text style={expertStyles.headerText}>Expert Take</Text>
      </View>

      {visibleOpinions.map((opinion) => (
        <ExpertOpinionRow key={opinion.id} opinion={opinion} />
      ))}

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

export function NewsFeedCard({ item, viewportHeight, showHint, onVoted }: Props) {
  const router = useRouter();
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

  return (
    <View style={[styles.frame, { height: viewportHeight }]}>
      <View style={styles.card}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          {hasImage ? (
            <Image
              source={{ uri: item.imageUrl! }}
              style={styles.heroImage}
              resizeMode="cover"
            />
          ) : (
            <View
              style={[
                styles.heroPlaceholder,
                { backgroundColor: CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.GENERAL },
              ]}
            >
              <Text style={styles.placeholderEmoji}>
                {CATEGORY_EMOJI[item.category] ?? "📰"}
              </Text>
            </View>
          )}

          <View style={styles.content}>
            <Text style={styles.category}>{item.category}</Text>
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

            <Pressable
              onPress={() => Linking.openURL(item.sourceUrl)}
              style={styles.metaRow}
            >
              <Text style={styles.source}>{item.sourceName}</Text>
              <Text style={styles.readMore}>Read more →</Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.published}>{formatRelativeTime(item.publishedAt)}</Text>
            </Pressable>

            {/* Expert Take is intentionally NOT shown here —
                Feed is for news + AI polls only.
                Expert opinions live on the dedicated Finance tab. */}

            {market ? (
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
                        <Ionicons name="checkmark-circle" size={16} color="#059669" />
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
                            color={voted === "YES" ? "#059669" : "#DC2626"}
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
                          <ActivityIndicator size="small" color="#059669" />
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
                          <ActivityIndicator size="small" color="#DC2626" />
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
            ) : (
              <View style={styles.marketBlock}>
                <Text style={styles.marketTitle}>Generating prediction…</Text>
                <Text style={styles.summary}>
                  This story is live — a market will appear shortly.
                </Text>
              </View>
            )}
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

const styles = StyleSheet.create({
  frame: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...shadows.card,
  },
  scrollView: { flex: 1 },
  scrollContent: { flexGrow: 1 },

  heroImage: { width: "100%", height: 220 },
  heroPlaceholder: {
    width: "100%",
    height: 160,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.85,
  },
  placeholderEmoji: { fontSize: 52 },

  content: { flex: 1, padding: spacing.xl, justifyContent: "center" },
  category: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.accent,
    backgroundColor: "#EFF6FF",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  headline: {
    marginTop: spacing.md,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    color: colors.text,
  },
  summary: {
    marginTop: spacing.md,
    fontSize: 15,
    lineHeight: 23,
    color: colors.textMuted,
  },
  metaRow: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: spacing.sm,
  },
  source: { fontSize: 13, fontWeight: "700", color: colors.text },
  readMore: { fontSize: 13, fontWeight: "600", color: colors.accent },
  published: { fontSize: 12, color: colors.textMuted },

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
    backgroundColor: "#F8FAFF",
    borderWidth: 1,
    borderColor: "#E8EDF5",
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
    color: colors.text,
  },
  bookmarkBtn: {
    paddingTop: 2,
  },
  progressTrack: {
    marginTop: spacing.md,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: "#E2E8F0",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  poolRow: {
    marginTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  poolLabel: { fontSize: 12, fontWeight: "600", color: colors.textMuted },

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
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    alignItems: "center",
    justifyContent: "center",
  },
  noBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: "#FFF1F2",
    borderWidth: 1,
    borderColor: "#FECDD3",
    alignItems: "center",
    justifyContent: "center",
  },
  yesBtnLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5, color: "#059669" },
  noBtnLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5, color: "#DC2626" },
  btnPct: { fontSize: 20, fontWeight: "700", color: colors.text, marginTop: 2 },
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
    borderColor: "#E2E8F0",
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: "#fff",
  },
  unitLabel: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
  submitBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
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
    backgroundColor: "#FEE2E2",
    overflow: "hidden",
  },
  liveBarYes: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: "#059669",
  },
  liveLabelsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  liveLabelYes: { fontSize: 13, fontWeight: "700", color: "#059669" },
  liveLabelNo: { fontSize: 13, fontWeight: "700", color: "#DC2626" },
  liveTotalVotes: { fontSize: 12, color: colors.textMuted },
  yourVoteBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignSelf: "flex-start",
  },
  yourVoteYes: { backgroundColor: "#ECFDF5", borderWidth: 1, borderColor: "#A7F3D0" },
  yourVoteNo: { backgroundColor: "#FFF1F2", borderWidth: 1, borderColor: "#FECDD3" },
  yourVoteText: { fontSize: 13, fontWeight: "700" },
  yourVoteTextYes: { color: "#059669" },
  yourVoteTextNo: { color: "#DC2626" },

  // Numeric result
  numericResult: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    flexWrap: "wrap",
  },
  numericResultText: { fontSize: 13, fontWeight: "700", color: "#059669" },
  crowdAvg: { fontSize: 12, color: colors.textMuted, marginLeft: "auto" },

  // Closed
  closedBanner: {
    marginTop: spacing.md,
    paddingVertical: 11,
    borderRadius: radius.md,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
  },
  closedText: { fontSize: 14, fontWeight: "700", color: "#6B7280" },

  errorText: { marginTop: spacing.sm, fontSize: 12, color: "#DC2626" },
  link: { marginTop: spacing.md, fontSize: 14, fontWeight: "700", color: colors.accent },

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

const expertStyles = StyleSheet.create({
  container: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#C7D2FE",
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
    color: "#4338CA",
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
    borderColor: colors.accent,
    minWidth: 66,
    alignItems: "center",
    justifyContent: "center",
  },
  followPillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  followPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.accent,
  },
  followPillTextActive: {
    color: "#fff",
  },
  sourceAttributionBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#F0F9FF",
    borderWidth: 1,
    borderColor: "#BAE6FD",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 6,
  },
  sourceAttributionLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#0369A1",
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
    color: colors.text ?? "#1e1b4b",
    flexShrink: 1,
  },
  expertOrg: {
    fontSize: 12,
    color: colors.textMuted ?? "#6b7280",
  },
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
    color: "#1a1a1a",
  },
  footer: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 14,
    color: "#6B7280",
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
  resolutionNoteText: {
    fontSize: 11,
    lineHeight: 15,
    fontStyle: "italic" as const,
  },
  resolutionDates: {
    fontSize: 10,
    color: "#6b7280",
    marginTop: 3,
  },
  expandBtn: {
    marginTop: spacing.xs,
    paddingVertical: 4,
  },
  expandText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#4338CA",
  },
});

// ── Poll styles (Poll A + Poll B) ──

const pollStyles = StyleSheet.create({
  section: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#C7D2FE",
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
    color: "#374151",
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
    color: "#374151",
    width: 72,
  },
  barTrack: {
    flex: 1,
    height: 6,
    backgroundColor: "#E5E7EB",
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
    color: "#4338CA",
    fontWeight: "700",
  },
  crowdSummary: {
    marginTop: 4,
    fontSize: 10,
    color: "#6B7280",
    lineHeight: 14,
  },
  errorText: {
    marginTop: 4,
    fontSize: 10,
    color: "#dc2626",
  },
  skeletonRow: {
    flexDirection: "row",
    gap: 6,
  },
  skeletonBtn: {
    flex: 1,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: "#E5E7EB",
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
    color: "#6B7280",
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
    color: "#374151",
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
    color: "#9CA3AF",
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
    color: "#6B7280",
    lineHeight: 10,
  },
  // Loading skeleton for slider
  sliderSkeletonTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#E5E7EB",
    marginVertical: 14,
    width: "100%",
  },
  sliderSkeletonTick: {
    flex: 1,
    height: 16,
    borderRadius: 2,
    backgroundColor: "#E5E7EB",
    marginHorizontal: 3,
  },
});
