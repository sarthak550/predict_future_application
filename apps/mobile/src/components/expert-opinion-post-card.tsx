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

import type {
  ApiExpertOpinionItem,
  ApiOpinionSibling,
  AppAnalystTier,
} from "@predict-future/types";
import { formatRelativeTime, freshnessColor } from "@predict-future/utils";
import { radius, spacing } from "@predict-future/ui-tokens";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";
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

  // ── Consensus tally (read-only; voting happens on detail screen) ──
  const [consensus, setConsensus] = useState<{
    agree: number;
    neutral: number;
    disagree: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await mobileApi.getExpertOpinionTallies(opinion.id);
        if (cancelled) return;
        const impl = result.implication;
        setConsensus({
          agree: impl.agree + impl.stronglyAgree,
          neutral: impl.neutral,
          disagree: impl.disagree + impl.stronglyDisagree,
          total: impl.total,
        });
      } catch {
        // Leave consensus null — bar simply won't render
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opinion.id]);

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
  // Shares the opinion as text + the source article link. (The old screenshot
  // approach used Share.share({url}), which is iOS-only — on Android the url was
  // silently dropped, so nothing useful was shared. Text + link works on both.)
  const handleShare = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const instrument = opinion.instrument ?? opinion.instrumentTicker ?? "the market";
      const message = [
        `${opinion.expertName || opinion.expertOrganization} is ${dirConfig.label} on ${instrument}.`,
        opinion.quote ? `\n\n"${opinion.quote}"` : "",
        `\n\nvia Predict Future`,
        opinion.sourceUrl ? `\n${opinion.sourceUrl}` : "",
      ].join("");
      await Share.share({ message });
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

      {/* ── HEADER ── LinkedIn-style: avatar · name stack · follow ── */}
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
            size={48}
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
              {/* Called-at subtitle — same slot as LinkedIn's "time" line */}
              {(() => {
                const callTime = opinion.analystCallAt ?? opinion.publishedAt;
                return callTime ? (
                  <Text style={[styles.calledAt, { color: freshnessColor(callTime) }]}>
                    Called {formatRelativeTime(callTime)}
                  </Text>
                ) : null;
              })()}
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
              {/* Called-at subtitle — same slot as LinkedIn's "time" line */}
              {(() => {
                const callTime = opinion.analystCallAt ?? opinion.publishedAt;
                return callTime ? (
                  <Text style={[styles.calledAt, { color: freshnessColor(callTime) }]}>
                    Called {formatRelativeTime(callTime)}
                  </Text>
                ) : null;
              })()}
            </Pressable>
          )}
        </View>

        {/* Follow button — LinkedIn-style outlined "+ Follow" / muted filled "Following" */}
        {onFollowToggle !== undefined && !opinion.isSourceAttribution && (
          <Pressable
            style={[styles.followPill, isFollowed && styles.followPillActive]}
            onPress={handleFollowPress}
            disabled={followPending}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {followPending ? (
              <ActivityIndicator size={10} color={isFollowed ? colors.textMuted : colors.accent} />
            ) : (
              <Text style={[styles.followPillText, isFollowed && styles.followPillTextActive]}>
                {isFollowed ? "Following" : "+ Follow"}
              </Text>
            )}
          </Pressable>
        )}
      </View>

      {/* ── CALL LINE — restrained single line replacing the heavy verdict badge ── */}
      {/* Format: ● BULLISH on Reliance Industries · RELIANCE.NS */}
      <View style={styles.callLine}>
        {/* Colored dot */}
        <View style={[styles.callDot, { backgroundColor: verdictColor }]} />
        {/* Direction word */}
        <Text style={[styles.callDirection, { color: verdictColor }]}>
          {isResolved ? `${dirConfig.label}  ·  ${isHit ? "HIT" : "MISS"}` : dirConfig.label}
        </Text>
        {/* "on {instrument}" */}
        {opinion.instrument ? (
          <Text style={styles.callInstrument}> on {opinion.instrument}</Text>
        ) : null}
        {/* " · TICKER" suffix */}
        {opinion.instrumentTicker ? (
          <Text style={styles.callTicker}> · {opinion.instrumentTicker}</Text>
        ) : null}
      </View>

      {/* ── BODY — hero content, generous breathing room ── */}
      <Pressable onPress={() => setBodyExpanded((x) => !x)} style={styles.bodyWrap}>
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

      {/* ── SOURCE — "via {domain}{ · date}", small + muted ── */}
      <Pressable
        onPress={() => void Linking.openURL(opinion.sourceUrl)}
        style={styles.sourceStrip}
      >
        <Ionicons name="open-outline" size={11} color={colors.textMuted} style={{ marginRight: 4 }} />
        <Text style={styles.sourceText} numberOfLines={1}>
          via <Text style={styles.sourceLink}>{sourceDomain}</Text>
          {sourceDateLabel ? ` · ${sourceDateLabel}` : ""}
        </Text>
      </Pressable>

      {/* ── SIBLINGS — quiet muted text link ── */}
      {siblings.length > 0 && opinion.storyId && (
        <Pressable
          onPress={() =>
            router.push(`/story/${opinion.storyId}` as Parameters<typeof router.push>[0])
          }
          style={styles.siblingsLink}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={styles.siblingsLinkText} numberOfLines={1} ellipsizeMode="tail">
            +{siblings.length} other take{siblings.length === 1 ? "" : "s"} on this story
            {(siblingBullish > 0 || siblingBearish > 0 || siblingNeutral > 0) && " · "}
            {siblingBullish > 0 && (
              <Text style={styles.siblingsChipBullish}>{siblingBullish} bullish</Text>
            )}
            {siblingBullish > 0 && siblingBearish > 0 && <Text style={styles.siblingsLinkText}> · </Text>}
            {siblingBearish > 0 && (
              <Text style={styles.siblingsChipBearish}>{siblingBearish} bearish</Text>
            )}
            {(siblingBullish > 0 || siblingBearish > 0) && siblingNeutral > 0 && (
              <Text style={styles.siblingsLinkText}> · </Text>
            )}
            {siblingNeutral > 0 && (
              <Text style={styles.siblingsChipNeutral}>{siblingNeutral} neutral</Text>
            )}
          </Text>
          <Text style={styles.siblingsLinkChevron}>›</Text>
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

        if (!resolvedDateLabel && !daysToResolve) return null;
        return (
          <View style={styles.narrativeStrip}>
            {resolvedDateLabel && (
              <View style={styles.narrativeChip}>
                <Text style={styles.narrativeChipText}>
                  Resolved {resolvedDateLabel}
                  {daysToResolve !== null && (
                    <Text style={styles.narrativeChipSubtle}>
                      {"  ·  in "}{daysToResolve} day{daysToResolve === 1 ? "" : "s"}
                    </Text>
                  )}
                </Text>
              </View>
            )}
          </View>
        );
      })()}

      {/* ── CONSENSUS BAR — read-only stacked agreement tally ── */}
      {consensus && consensus.total > 0 && (() => {
        const { agree, neutral, disagree, total } = consensus;
        const agreePct = Math.round((agree / total) * 100);
        const disagreePct = Math.round((disagree / total) * 100);
        return (
          <View style={styles.consensusWrap}>
            <View style={styles.consensusTrack}>
              {agree > 0 && (
                <View style={[styles.consensusSegment, { flex: agree, backgroundColor: "#16a34a" }]} />
              )}
              {neutral > 0 && (
                <View style={[styles.consensusSegment, { flex: neutral, backgroundColor: colors.border }]} />
              )}
              {disagree > 0 && (
                <View style={[styles.consensusSegment, { flex: disagree, backgroundColor: "#dc2626" }]} />
              )}
            </View>
            <Text style={styles.consensusCaption}>
              {agreePct}% agree · {disagreePct}% disagree · {total} {total === 1 ? "view" : "views"}
            </Text>
          </View>
        );
      })()}

      {/* ── ENGAGEMENT BAR — LinkedIn-style 3-action row ── */}
      <Text style={styles.engagementDisclaimer}>Not investment advice</Text>
      <View style={styles.engagementDivider} />
      <View style={styles.engagementBar}>
        {/* Opine — primary CTA, accent-coloured (agree/neutral/disagree on the detail screen) */}
        <Pressable
          style={styles.engagementAction}
          onPress={() =>
            router.push(`/finance/opinion/${opinion.id}` as Parameters<typeof router.push>[0])
          }
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="create-outline" size={18} color={colors.accent} />
          <Text style={[styles.engagementLabel, { color: colors.accent }]}>Opine</Text>
        </Pressable>

        {/* Discuss — navigates to detail screen (comments live there) */}
        <Pressable
          style={styles.engagementAction}
          onPress={() =>
            router.push(`/finance/opinion/${opinion.id}` as Parameters<typeof router.push>[0])
          }
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chatbubble-outline" size={18} color={colors.textMuted} />
          <Text style={[styles.engagementLabel, { color: colors.textMuted }]}>Discuss</Text>
        </Pressable>

        {/* Share — existing handleShare logic */}
        <Pressable
          style={styles.engagementAction}
          onPress={() => void handleShare()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          disabled={sharing}
        >
          {sharing ? (
            <ActivityIndicator size={16} color={colors.textMuted} />
          ) : (
            <Ionicons name="share-outline" size={18} color={colors.textMuted} />
          )}
          <Text style={[styles.engagementLabel, { color: colors.textMuted }]}>Share</Text>
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
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    // Soft card lift — t.shadows.card spread
    ...t.shadows.card,
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
    marginTop: spacing.md,
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
    marginTop: spacing.md,
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
    marginLeft: 12,
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
  // "Called X" — sits directly below the credibility badge like LinkedIn's time/title subtitle
  calledAt: { fontSize: 11, color: t.colors.textSubtle, marginTop: 3, fontWeight: "500" as const },
  hitRateLabel: {
    fontSize: 11,
    color: "#16a34a",
    fontWeight: "600",
  },

  // Follow button — LinkedIn-style: transparent pill with accent border (unfollowed)
  // / muted filled pill (following). NOT a heavy filled accent pill.
  followPill: {
    borderWidth: 1,
    borderColor: t.colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    minWidth: 76,
  },
  followPillActive: {
    backgroundColor: t.colors.surfaceMuted,
    borderColor: t.colors.border,
  },
  followPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: t.colors.accent,
  },
  followPillTextActive: {
    color: t.colors.textMuted,
    fontWeight: "600",
  },

  // Call line — replaces the heavy filled verdict badge + ticker chip
  // One restrained line: ● DIRECTION on Instrument · TICKER
  callLine: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
    flexWrap: "wrap",
  },
  callDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 7,
  },
  callDirection: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  callInstrument: {
    fontSize: 13,
    fontWeight: "400",
    color: t.colors.text,
  },
  callTicker: {
    fontSize: 13,
    fontWeight: "400",
    color: t.colors.textMuted,
  },

  // Body — hero content, generous margins
  bodyWrap: {
    marginTop: 2,
    marginBottom: spacing.md,
  },
  body: {
    fontSize: 15,
    color: t.colors.text,
    lineHeight: 22,
    letterSpacing: 0.1,
  },
  moreLink: {
    fontSize: 13,
    color: t.colors.accent,
    fontWeight: "600",
    marginTop: 4,
  },

  // Source strip — "via {domain}{ · date}"
  sourceStrip: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  sourceText: {
    fontSize: 12,
    color: t.colors.textMuted,
    flex: 1,
  },
  sourceLink: {
    color: t.colors.textMuted,
    fontWeight: "600",
  },

  // Siblings — quiet text link (no chip background/border)
  siblingsLink: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  siblingsLinkText: { fontSize: 12, fontWeight: "500", color: t.colors.textMuted, flex: 1 },
  siblingsChipBullish: { color: "#16a34a", fontWeight: "700" },
  siblingsChipBearish: { color: "#dc2626", fontWeight: "700" },
  siblingsChipNeutral: { color: "#6b7280", fontWeight: "700" },
  siblingsLinkChevron: { fontSize: 15, color: t.colors.textSubtle, marginLeft: 4 },

  // Consensus bar — read-only stacked agreement tally above the engagement bar
  consensusWrap: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  consensusTrack: {
    flexDirection: "row",
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  consensusSegment: {
    // flex is set inline per segment
  },
  consensusCaption: {
    fontSize: 11.5,
    color: t.colors.textMuted,
    marginTop: 5,
  },

  // Engagement bar — LinkedIn-style 3-action row replacing the old poll + icon-only footer
  engagementDisclaimer: {
    fontSize: 10,
    color: t.colors.textSubtle,
    textAlign: "center",
    marginTop: spacing.md,
    letterSpacing: 0.1,
  },
  engagementDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: t.colors.border,
    marginTop: spacing.sm,
  },
  engagementBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: spacing.sm,
    paddingBottom: 2,
  },
  engagementAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 6,
  },
  engagementLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
});
