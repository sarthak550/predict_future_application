import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type {
  ApiFlagshipEvent,
  ApiFinanceBigCallOpinion,
  ApiFinanceExpertSentiment,
  ApiFinanceMacroResponse,
  ApiFinanceMarketsResponse,
  ApiInstrumentCatalogItem,
  ApiMyCallsDigest,
  ApiNewsFeedItem,
  ApiPoll,
  ApiTopExpertEntry,
  ApiUserProfile,
  ApiVerifiedCall,
} from "@predict-future/types";
import { radius, spacing } from "@predict-future/ui-tokens";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";
import { formatRelativeTime, freshnessColor } from "@predict-future/utils";

import { ApiClientError } from "@predict-future/api-client";

import { ExpertOpinionCard } from "@/components/expert-opinion-card";
import { CombinedAnalystCard } from "@/components/combined-analyst-card";
import { SectionHelp } from "@/components/section-help";
import { mobileApi } from "@/lib/api";
import { withRetry } from "@/lib/retry";
import { isNSEHoliday } from "@/constants/nse-holidays-2026";

const FOLLOWED_ANALYSTS_KEY = "finance:followedAnalysts";
const FEED_DEFAULT_CACHE_KEY = "finance:feed:default";

/**
 * Feature flag — set to true to re-enable the Overnight Big Call hero spotlight
 * at the top of the Finance feed. Requires active-user data to be meaningful;
 * hidden for initial release so the CombinedAnalystCard shows only Top Analysts.
 */
const SHOW_OVERNIGHT_BIG_CALL = false;
// Initial release: hide the whole analyst card (Big Call hero + Top Analysts list).
// Both need active-user / resolved-call data to be meaningful. Flip to re-enable
// (SHOW_OVERNIGHT_BIG_CALL then controls whether the Big Call hero shows too).
const SHOW_TOP_ANALYSTS = false;

/**
 * Persisted shape of the default-filter news feed (no filters active).
 * Hydrated on mount so users see instant content during a slow / failed
 * refresh instead of a blank loading spinner or error screen.
 */
type FeedCache = {
  items: ApiNewsFeedItem[];
  nextCursor: string | null;
  hasMore: boolean;
  savedAt: number;
};

type DirectionFilter = "BULLISH" | "BEARISH" | "NEUTRAL" | "VERIFIED" | null;

// ─── IST time utilities (S35-T3) ──────────────────────────────────────────────

function getISTHourMinute(): { hours: number; minutes: number; dayOfWeek: number; dateKey: string } {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const now = new Date(Date.now() + IST_OFFSET_MS);
  return {
    hours: now.getUTCHours(),
    minutes: now.getUTCMinutes(),
    dayOfWeek: now.getUTCDay(), // 0=Sun, 6=Sat
    dateKey: now.toISOString().slice(0, 10),
  };
}

type MarketWindow =
  | "pre-market"
  | "live"
  | "closing-wrap"
  | "after-hours"
  | "weekend"
  | "holiday";

function getMarketWindow(): MarketWindow {
  const { hours, minutes, dayOfWeek, dateKey } = getISTHourMinute();
  if (isNSEHoliday(dateKey)) return "holiday";
  if (dayOfWeek === 0 || dayOfWeek === 6) return "weekend";
  const totalMinutes = hours * 60 + minutes;
  if (totalMinutes < 8 * 60) return "after-hours"; // before 08:00
  if (totalMinutes < 9 * 60 + 15) return "pre-market"; // 08:00–09:15
  if (totalMinutes < 15 * 60 + 30) return "live"; // 09:15–15:30
  if (totalMinutes < 20 * 60) return "closing-wrap"; // 15:30–20:00
  return "after-hours"; // 20:00+
}

// ─── Flagship Events Carousel (S32-T2) ────────────────────────────────────────

const EVENT_TYPE_COLORS: Record<string, string> = {
  RBI: "#DC2626",
  BUDGET: "#D97706",
  GST: "#7C3AED",
  GLOBAL: "#0284C7",
  FED: "#065F46",
  OTHER: "#4B5563",
};

function getCountdownLabel(flagshipEventAt: string): string {
  const now = Date.now();
  const target = new Date(flagshipEventAt).getTime();
  const diffMs = target - now;
  if (diffMs <= 0) return "Today";
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 1) return "Tomorrow";
  if (diffDays <= 7) return `in ${diffDays} days`;
  const diffWeeks = Math.round(diffDays / 7);
  return `in ${diffWeeks}w`;
}

// ─── RBI MPC Poll-Pack Hero Card (S62-T7) ────────────────────────────────────
// Renders when the Poll API returns an open RBI MPC pack (two ApiPoll entries
// sharing a packId). Data comes from getPollPacks({ status: "open" }), NOT
// from the Market/flagship API. Voting routes through votePoll().

const MPC_RBI_COLOR = "#DC2626"; // same as EVENT_TYPE_COLORS["RBI"]

/**
 * MpcOptionChips — renders vote options for an RBI MPC poll card.
 *
 * T3 (lock): when `poll.userVote` is set, all chips become non-tappable;
 *   the chosen option shows a checkmark + blue fill; others are 45% opacity.
 *   A "Prediction locked" label appears below the chips.
 *
 * T4 (always-visible breakdown): regardless of vote state, show a bar + %
 *   row under each option so the crowd distribution is always visible.
 *   When totalVotes===0, bars are empty and the voter-count line is hidden.
 */
function MpcOptionChips({
  poll,
  onPickOption,
}: {
  poll: ApiPoll;
  onPickOption: (pollId: string, optionId: string) => void;
}) {
  const mpcStyles = useThemedStyles(makeMpcStyles);
  const { colors } = useTheme();
  const options = poll.options ?? [];
  if (options.length === 0) return null;

  const totalVotes = poll.totalVotes > 0 ? poll.totalVotes : options.reduce((s, o) => s + o.voteCount, 0);
  const userVote = poll.userVote ?? null;
  const isLocked = userVote !== null;

  return (
    <View>
      {/* ── Option chips (tappable when not locked) ── */}
      <View style={mpcStyles.chipsWrap}>
        {options.map((opt) => {
          const pct = totalVotes > 0 ? Math.round((opt.voteCount / totalVotes) * 100) : 0;
          const isChosen = isLocked && userVote.optionId === opt.id;

          if (isLocked) {
            // Non-tappable locked state
            return (
              <View
                key={opt.id}
                style={[
                  mpcStyles.chip,
                  isChosen ? mpcStyles.chipChosen : mpcStyles.chipUnchosen,
                ]}
                accessibilityLabel={`${opt.label}${pct > 0 ? `, ${pct}% crowd` : ""}${isChosen ? ", your prediction" : ""}`}
              >
                <Text
                  style={[
                    mpcStyles.chipText,
                    isChosen ? mpcStyles.chipTextChosen : mpcStyles.chipTextUnchosen,
                  ]}
                  numberOfLines={1}
                >
                  {opt.label}
                </Text>
                {isChosen ? (
                  <Text style={mpcStyles.chipCheckmark}>✓</Text>
                ) : totalVotes > 0 ? (
                  <Text style={mpcStyles.chipPctUnchosen}>{pct}%</Text>
                ) : null}
              </View>
            );
          }

          // Tappable — normal leading-highlight behaviour
          const maxPct = totalVotes > 0
            ? Math.max(...options.map((o) => Math.round((o.voteCount / totalVotes) * 100)))
            : 0;
          const isLeading = totalVotes > 0 && pct === maxPct;
          return (
            <Pressable
              key={opt.id}
              style={({ pressed }) => [
                mpcStyles.chip,
                isLeading && mpcStyles.chipLeading,
                pressed && { opacity: 0.75 },
              ]}
              onPress={() => onPickOption(poll.id, opt.id)}
              accessibilityRole="button"
              accessibilityLabel={`Predict ${opt.label}${pct > 0 ? `, ${pct}% crowd` : ""}`}
            >
              <Text style={[mpcStyles.chipText, isLeading && mpcStyles.chipTextLeading]} numberOfLines={1}>
                {opt.label}
              </Text>
              {totalVotes > 0 && (
                <Text style={[mpcStyles.chipPct, isLeading && mpcStyles.chipPctLeading]}>
                  {pct}%
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* ── T4: Always-visible vote breakdown bar rows ── */}
      <View style={mpcStyles.breakdownWrap}>
        {options.map((opt) => {
          const pct = totalVotes > 0 ? Math.round((opt.voteCount / totalVotes) * 100) : 0;
          const fillPct = totalVotes > 0 ? (opt.voteCount / totalVotes) * 100 : 0;
          const isChosen = isLocked && userVote?.optionId === opt.id;
          return (
            <View key={opt.id} style={mpcStyles.breakdownRow}>
              <Text
                style={[mpcStyles.breakdownLabel, isChosen && mpcStyles.breakdownLabelChosen]}
                numberOfLines={1}
              >
                {opt.label}
              </Text>
              <View style={mpcStyles.breakdownBarTrack}>
                <View
                  style={[
                    mpcStyles.breakdownBarFill,
                    isChosen && mpcStyles.breakdownBarFillChosen,
                    { width: `${fillPct}%` as `${number}%` },
                  ]}
                />
              </View>
              <Text style={[mpcStyles.breakdownPct, isChosen && mpcStyles.breakdownPctChosen]}>
                {pct}%
              </Text>
            </View>
          );
        })}
        {totalVotes > 0 && (
          <Text style={mpcStyles.voterCount}>
            {totalVotes.toLocaleString("en-IN")} {totalVotes === 1 ? "person" : "people"} voted
          </Text>
        )}
      </View>

      {/* ── T3: Prediction locked label ── */}
      {isLocked && (
        <Text style={[mpcStyles.lockedLabel, { color: colors.textMuted }]}>
          Prediction locked
        </Text>
      )}
    </View>
  );
}

// Q-badge accent colors rotate through the first 3 questions (Repo / CRR / SLR).
const Q_BADGE_COLORS: Array<{ bg: string; border: string; text: string }> = [
  { bg: "#FEF2F2", border: "#FECACA", text: "#991B1B" }, // red  — Repo
  { bg: "#EFF6FF", border: "#BFDBFE", text: "#1E40AF" }, // blue — CRR
  { bg: "#F0FDF4", border: "#BBF7D0", text: "#166534" }, // green — SLR
];

/**
 * S70-T4: RBI MPC pack — ONE shared section header + ONE card per poll.
 * The shared header (chip, countdown, date, title, subtitle) renders once above
 * the cards so it's scannable without repeating context on every card.
 * Each poll gets its own card with Q badge, question, description, option chips,
 * and its own full-width CTA button.
 */
function MpcPollPackCard({ polls }: { polls: ApiPoll[] }) {
  const mpcStyles = useThemedStyles(makeMpcStyles);
  const router = useRouter();

  // Use the first poll's eventAt as the canonical meeting date.
  const firstPoll = polls[0];
  const meetingIso = firstPoll.eventAt ?? firstPoll.closeAt;
  const countdown = getCountdownLabel(meetingIso);
  const meetingDate = new Date(meetingIso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const packId = firstPoll.packId ?? "";

  const navigateToPoll = (pollId: string, optionId?: string) => {
    // Pass all other poll ids as sisterPollId (using the first non-matching one for compat).
    const sisterPollId = polls.find((p) => p.id !== pollId)?.id ?? "";
    const path = `/finance/poll/${pollId}?source=poll-api&packId=${packId}&sisterPollId=${sisterPollId}${optionId ? `&preselect=${optionId}` : ""}`;
    router.push(path as Parameters<typeof router.push>[0]);
  };

  const totalParticipants = Math.max(...polls.map((p) => p.totalVotes));

  return (
    <>
      {/* One card per poll — each has its own full-width CTA.
          The shared header (RBI chip, countdown, date, title, subtitle) is
          JOINED INTO the first card only; cards 2+ are standalone poll cards. */}
      {polls.map((poll, idx) => {
        const accent = Q_BADGE_COLORS[idx % Q_BADGE_COLORS.length];
        const isFirst = idx === 0;
        return (
          <View key={poll.id} style={mpcStyles.card}>
            {/* Header block — rendered only on the first card */}
            {isFirst && (
              <>
                <View style={mpcStyles.headerRow}>
                  <View style={mpcStyles.rbiChip}>
                    <Text style={mpcStyles.rbiChipText}>RBI MPC</Text>
                  </View>
                  <View style={mpcStyles.countdownChip}>
                    <Text style={mpcStyles.countdownText}>{countdown}</Text>
                  </View>
                  <Text style={mpcStyles.meetingDate}>{meetingDate}</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={mpcStyles.heroTitle}>Predict the RBI Decision</Text>
                  <SectionHelp helpKey="finance-rbi-mpc-poll" />
                </View>
                <Text style={mpcStyles.heroSub}>
                  {totalParticipants > 0
                    ? `${totalParticipants.toLocaleString()} predictions so far — cast yours free`
                    : "Be among the first to predict — free, no strings attached"}
                </Text>
                <View style={mpcStyles.divider} />
              </>
            )}

            {/* Q badge + question title */}
            <View style={mpcStyles.questionHeader}>
              <View style={[mpcStyles.qBadge, { backgroundColor: accent.bg, borderColor: accent.border }]}>
                <Text style={[mpcStyles.qBadgeText, { color: accent.text }]}>Q{idx + 1}</Text>
              </View>
              <Text style={mpcStyles.questionTitle} numberOfLines={2}>{poll.question}</Text>
            </View>

            {/* Optional description */}
            {poll.description ? (
              <Text style={mpcStyles.questionDescription}>{poll.description}</Text>
            ) : null}

            {/* Option chips */}
            <MpcOptionChips
              poll={poll}
              onPickOption={(pId, oId) => navigateToPoll(pId, oId)}
            />

            {/* Per-card full-width CTA */}
            <Pressable
              style={mpcStyles.ctaBtn}
              onPress={() => navigateToPoll(poll.id)}
            >
              <Text style={mpcStyles.ctaBtnText}>Predict now — it&apos;s free</Text>
            </Pressable>
          </View>
        );
      })}
    </>
  );
}

const makeMpcStyles = (t: ThemeContextValue) => StyleSheet.create({
  // ── Poll card — used for all polls including the first (which embeds the header) ──
  card: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: "#FECACA",
    padding: spacing.md,
    gap: 8,
    shadowColor: MPC_RBI_COLOR,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  rbiChip: {
    backgroundColor: MPC_RBI_COLOR,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  rbiChipText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.6,
  },
  countdownChip: {
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  countdownText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#991B1B",
  },
  meetingDate: {
    fontSize: 11,
    color: t.colors.textMuted,
    marginLeft: "auto",
  },
  collapseChevron: {
    fontSize: 13,
    color: t.colors.textSubtle,
    marginLeft: spacing.xs,
  },
  collapsibleHeader: {
    // No extra padding — card already has spacing.md padding
  },
  collapsedTeaser: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 3,
    lineHeight: 17,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: t.colors.text,
    lineHeight: 24,
  },
  heroSub: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 4,
    lineHeight: 17,
  },
  divider: {
    height: 1,
    backgroundColor: t.colors.surfaceMuted,
    marginVertical: spacing.sm,
  },
  questionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  qBadge: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 1,
    flexShrink: 0,
  },
  qBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  questionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: t.colors.text,
    flex: 1,
    lineHeight: 18,
  },
  questionDescription: {
    fontSize: 11,
    color: t.colors.textMuted,
    lineHeight: 16,
    fontStyle: "italic",
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: t.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  chipLeading: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
  },
  // T3: Locked states
  chipChosen: {
    backgroundColor: "#2563EB",
    borderColor: "#2563EB",
  },
  chipUnchosen: {
    backgroundColor: t.colors.surfaceMuted,
    borderColor: t.colors.border,
    opacity: 0.45,
  },
  chipText: {
    fontSize: 12,
    fontWeight: "600",
    color: t.colors.text,
  },
  chipTextLeading: {
    color: "#991B1B",
    fontWeight: "700",
  },
  chipTextChosen: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  chipTextUnchosen: {
    color: t.colors.text,
  },
  chipCheckmark: {
    fontSize: 11,
    fontWeight: "800",
    color: "#FFFFFF",
    marginLeft: 2,
  },
  chipPct: {
    fontSize: 10,
    fontWeight: "700",
    color: t.colors.textSubtle,
  },
  chipPctLeading: {
    color: "#DC2626",
  },
  chipPctUnchosen: {
    fontSize: 10,
    fontWeight: "700",
    color: t.colors.textSubtle,
  },
  // T3: Locked label
  lockedLabel: {
    fontSize: 11,
    fontWeight: "600",
    fontStyle: "italic",
    marginTop: 6,
    textAlign: "center",
  },
  // T4: Always-visible vote breakdown
  breakdownWrap: {
    marginTop: 10,
    gap: 6,
  },
  breakdownRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  breakdownLabel: {
    fontSize: 11,
    color: t.colors.textMuted,
    width: 80,
    flexShrink: 0,
  },
  breakdownLabelChosen: {
    color: "#2563EB",
    fontWeight: "700",
  },
  breakdownBarTrack: {
    flex: 1,
    height: 4,
    backgroundColor: t.colors.surfaceMuted,
    borderRadius: 2,
    overflow: "hidden",
  },
  breakdownBarFill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: t.colors.textSubtle,
  },
  breakdownBarFillChosen: {
    backgroundColor: "#2563EB",
  },
  breakdownPct: {
    fontSize: 11,
    fontWeight: "700",
    color: t.colors.textMuted,
    width: 32,
    textAlign: "right",
    flexShrink: 0,
  },
  breakdownPctChosen: {
    color: "#2563EB",
  },
  voterCount: {
    fontSize: 10,
    color: t.colors.textSubtle,
    marginTop: 4,
    textAlign: "right",
  },
  ctaBtn: {
    marginTop: spacing.md,
    backgroundColor: MPC_RBI_COLOR,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: "center",
  },
  ctaBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.2,
  },

});

// ─── END MPC Poll-Pack Hero Card ──────────────────────────────────────────────

function FlagshipProbabilityBar({
  market,
  crowdProbability,
}: {
  market: ApiFlagshipEvent;
  crowdProbability: Record<string, number> | null;
}) {
  const flagshipStyles = useThemedStyles(makeFlagshipStyles);
  if (!crowdProbability) {
    return (
      <Text style={flagshipStyles.noDataText}>No predictions yet</Text>
    );
  }

  if (market.marketType === "BINARY") {
    const yesP = crowdProbability["YES"] ?? 0;
    const noP = crowdProbability["NO"] ?? 0;
    return (
      <View>
        <View style={flagshipStyles.barTrack}>
          <View style={[flagshipStyles.barSegment, { flex: yesP, backgroundColor: "#16a34a" }]} />
          <View style={[flagshipStyles.barSegment, { flex: noP, backgroundColor: "#dc2626" }]} />
        </View>
        <View style={flagshipStyles.barLabels}>
          <Text style={[flagshipStyles.barLabel, { color: "#16a34a" }]}>YES {Math.round(yesP * 100)}%</Text>
          <Text style={[flagshipStyles.barLabel, { color: "#dc2626" }]}>NO {Math.round(noP * 100)}%</Text>
        </View>
      </View>
    );
  }

  // MULTIPLE_CHOICE — show top 3-4 segments with option labels
  if (market.marketType === "MULTIPLE_CHOICE" && market.options?.length) {
    const sorted = market.options
      .filter((o) => crowdProbability[o.id] !== undefined)
      .map((o) => ({ label: o.label, pct: crowdProbability[o.id] ?? 0 }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 4);
    const segColors = ["#0284C7", "#7C3AED", "#D97706", "#64748B"];
    return (
      <View>
        <View style={flagshipStyles.barTrack}>
          {sorted.map((seg, i) => (
            <View
              key={i}
              style={[flagshipStyles.barSegment, { flex: seg.pct, backgroundColor: segColors[i % segColors.length] }]}
            />
          ))}
        </View>
        <View style={flagshipStyles.barLabelsWrap}>
          {sorted.map((seg, i) => (
            <Text key={i} style={[flagshipStyles.barLabelSmall, { color: segColors[i % segColors.length] }]}>
              {seg.label.length > 10 ? seg.label.slice(0, 9) + "…" : seg.label} {Math.round(seg.pct * 100)}%
            </Text>
          ))}
        </View>
      </View>
    );
  }

  return null;
}

function ExpertConsensusLine({
  expertProbability,
  expertCount,
  market,
}: {
  expertProbability: Record<string, number> | null;
  expertCount?: number;
  market: ApiFlagshipEvent;
}) {
  const flagshipStyles = useThemedStyles(makeFlagshipStyles);
  if (expertProbability === null) {
    return (
      <Text style={flagshipStyles.expertLineNull}>Experts: not enough data yet</Text>
    );
  }

  const count = expertCount ?? 0;

  if (market.marketType === "BINARY") {
    const yesP = expertProbability["YES"] ?? 0;
    const noP = expertProbability["NO"] ?? 0;
    return (
      <Text style={flagshipStyles.expertLine}>
        {`Experts (${count}): ${Math.round(yesP * 100)}% YES · ${Math.round(noP * 100)}% NO`}
      </Text>
    );
  }

  if (market.marketType === "MULTIPLE_CHOICE" && market.options?.length) {
    const parts = market.options
      .filter((o) => expertProbability[o.id] !== undefined)
      .sort((a, b) => (expertProbability[b.id] ?? 0) - (expertProbability[a.id] ?? 0))
      .slice(0, 3)
      .map((o) => `${Math.round((expertProbability[o.id] ?? 0) * 100)}% ${o.label.split(" ")[0]}`);
    return (
      <Text style={flagshipStyles.expertLine}>
        {`Experts (${count}): ${parts.join(" · ")}`}
      </Text>
    );
  }

  return null;
}

function FlagshipHeroCard({ event }: { event: ApiFlagshipEvent }) {
  const flagshipStyles = useThemedStyles(makeFlagshipStyles);
  const router = useRouter();
  const accentColor = EVENT_TYPE_COLORS[event.flagshipEventType] ?? EVENT_TYPE_COLORS["OTHER"];
  const countdown = getCountdownLabel(event.flagshipEventAt);

  return (
    <Pressable
      style={[flagshipStyles.card, { borderLeftColor: accentColor }]}
      onPress={() => router.push(`/finance/poll/${event.id}` as Parameters<typeof router.push>[0])}
    >
      {/* Top row: type chip + countdown */}
      <View style={flagshipStyles.cardTopRow}>
        <View style={[flagshipStyles.typeChip, { backgroundColor: accentColor + "20", borderColor: accentColor + "60" }]}>
          <Text style={[flagshipStyles.typeChipText, { color: accentColor }]}>{event.flagshipEventType}</Text>
        </View>
        <View style={flagshipStyles.countdownBadge}>
          <Text style={flagshipStyles.countdownText}>{countdown}</Text>
        </View>
      </View>

      {/* Market title */}
      <Text style={flagshipStyles.cardTitle} numberOfLines={2}>{event.title}</Text>

      {/* Probability bar */}
      <View style={flagshipStyles.probSection}>
        <Text style={flagshipStyles.crowdLabel}>Crowd</Text>
        <FlagshipProbabilityBar market={event} crowdProbability={event.crowdProbability} />
      </View>

      {/* Expert consensus */}
      <ExpertConsensusLine
        expertProbability={event.expertProbability}
        expertCount={event.expertCount}
        market={event}
      />

      {/* CTA */}
      <View style={flagshipStyles.cardFooter}>
        <Text style={[flagshipStyles.predictBtn, { color: accentColor }]}>Predict</Text>
      </View>
    </Pressable>
  );
}

function FlagshipEventsCarousel({ events }: { events: ApiFlagshipEvent[] }) {
  const flagshipStyles = useThemedStyles(makeFlagshipStyles);
  return (
    <View style={flagshipStyles.section}>
      <View style={flagshipStyles.headerRow}>
        <Text style={flagshipStyles.sectionHeader}>{"🔥 Policy & Big Events"}</Text>
        <SectionHelp helpKey="finance-flagship-events-carousel" />
      </View>
      {events.length === 0 ? (
        <View style={flagshipStyles.emptyCard}>
          <Text style={flagshipStyles.emptyTitle}>No live event polls yet</Text>
          <Text style={flagshipStyles.emptyHint}>
            Curated RBI meetings, Budget, and global events appear here as admins schedule them.
          </Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={flagshipStyles.scroll}
        >
          {events.map((event) => (
            <FlagshipHeroCard key={event.id} event={event} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function formatDateRange(startsAt: string, endsAt: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return `${fmt(startsAt)} – ${fmt(endsAt)}`;
}

// PulseKind drives which PulseSheet is currently open. Sentiment was merged
// into the Weekly Calls card via a toggle (S38) — no sentiment pill / sheet.
type PulseKind = "events" | "calendar";

type PulsePill = {
  kind: PulseKind;
  icon: string;
  label: string;
  value: string;
  enabled: boolean;
};

// Shape of RBI current-rates data passed into PulseRibbon.
type RbiCurrentRates = {
  policyRepoRate?: number | null;
  standingDepositFacilityRate?: number | null;
  marginalStandingFacilityRate?: number | null;
  bankRate?: number | null;
  cashReserveRatio?: number | null;
  statutoryLiquidityRatio?: number | null;
};

// ─── Rates & Events ribbon — RBI rates + Next Event + Policy Calendar ────────
// S52: Redesigned from horizontal scroll of single-line pills to vertical
// stacked 2-3 line pill cards that surface crowd consensus data already fetched.
function PulseRibbon({
  flagshipEvents,
  clusters,
  onPress,
  rbiRates,
  defaultExpanded = false,
}: {
  flagshipEvents: ApiFlagshipEvent[];
  clusters: { name: string }[];
  onPress: (kind: PulseKind) => void;
  rbiRates?: RbiCurrentRates | null;
  /** When true, the ribbon initialises expanded instead of collapsed.
   *  Used when PulseRibbon is the primary content of a tab (Rates & Events). */
  defaultExpanded?: boolean;
}) {
  const router = useRouter();
  const pulseStyles = useThemedStyles(makePulseStyles);
  const { colors: pulseColors } = useTheme();

  // S51-T2: Collapsed by default unless defaultExpanded is set; state persisted per-device.
  const [collapsed, setCollapsed] = useState(!defaultExpanded);

  useEffect(() => {
    // Only restore persisted state when not in defaultExpanded mode.
    // In defaultExpanded mode the caller wants the ribbon open; honour that intent.
    if (defaultExpanded) return;
    void AsyncStorage.getItem("finance_section_collapsed_pulse").then((v) => {
      // null = first launch → stay collapsed (default true)
      // "true" → collapsed, "false" → expanded
      if (v === "false") setCollapsed(false);
    });
  // defaultExpanded is a prop that won't change at runtime — safe to list once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    void AsyncStorage.setItem("finance_section_collapsed_pulse", String(next));
  }, [collapsed]);

  const nextEvent = flagshipEvents[0];
  const clustersCount = clusters.length;

  const cdLabel = nextEvent
    ? (() => {
        const ms = new Date(nextEvent.flagshipEventAt ?? Date.now()).getTime() - Date.now();
        const days = Math.floor(ms / (24 * 60 * 60 * 1000));
        if (days >= 2) return `in ${days}d`;
        if (days === 1) return "tomorrow";
        return "today";
      })()
    : "";

  // Visibility logic: Pill A needs a nextEvent, Pill B needs clustersCount > 0
  const showEventPill = nextEvent != null;
  const showCalendarPill = clustersCount > 0;

  // Keep the pill label array for collapsed-state preview text (S51-T4 compat)
  const pills: PulsePill[] = [
    {
      kind: "events",
      icon: "🔥",
      label: nextEvent ? "Next event" : "Big events",
      value: nextEvent
        ? `${nextEvent.flagshipEventType ?? "Event"} ${cdLabel}`
        : flagshipEvents.length > 0
          ? `${flagshipEvents.length} upcoming`
          : "",
      enabled: true,
    },
    {
      kind: "calendar",
      icon: "💼",
      label: "Policy calendar",
      value: clustersCount > 0 ? `${clustersCount} this week` : "",
      enabled: clustersCount > 0,
    },
  ];

  const visiblePills = pills.filter((p) => showEventPill && p.kind === "events" || showCalendarPill && p.kind === "calendar");
  if (visiblePills.length === 0) return null;

  // Collapsed-state preview: first 2 visible pill labels joined by ·
  const previewText = visiblePills
    .slice(0, 2)
    .map((p) => p.label)
    .join(" · ");

  const a11yLabel = collapsed
    ? `Rates & Events: ${previewText}. Tap to expand.`
    : "Rates & Events, expanded. Tap to collapse.";

  // Pill A urgency tint
  const eventPillBg =
    cdLabel === "today" ? "#fef2f2" :
    cdLabel === "tomorrow" ? "#fffbeb" :
    pulseColors.surfaceMuted;
  const eventPillBorder =
    cdLabel === "today" ? "#fecaca" :
    cdLabel === "tomorrow" ? "#fde68a" :
    pulseColors.border;

  // Pill B cluster preview: first 2 names + "N more"
  const clusterPreview = (() => {
    if (clustersCount === 0) return "";
    const first2 = clusters.slice(0, 2).map((c) => c.name).join(" · ");
    if (clustersCount <= 2) return first2;
    return `${first2} · ${clustersCount - 2} more`;
  })();

  // Crowd consensus for Pill A
  const crowdYesPercent = nextEvent?.crowdProbability?.["YES"] != null
    ? Math.round((nextEvent.crowdProbability["YES"] as number) * 100)
    : null;
  const totalVotes =
    ((nextEvent?.yesCount ?? 0) + (nextEvent?.noCount ?? 0)) ||
    (nextEvent?.totalVotes ?? 0);

  return (
    <View style={pulseStyles.card}>
      {/* S51-T4: Tappable header — wraps both the label row and the preview row
          so the entire collapsed card is one big tap target. */}
      <Pressable
        onPress={toggleCollapsed}
        style={pulseStyles.headingRow}
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        accessibilityLabel={a11yLabel}
      >
        {/* Row 1: label + chevron */}
        <View style={pulseStyles.headingInner}>
          <Text style={pulseStyles.heading}>Rates &amp; Events</Text>
          <Text style={pulseStyles.collapseChevron}>{collapsed ? "▼" : "▲"}</Text>
        </View>

        {/* Row 2 (collapsed only): preview of first 2 pill labels */}
        {collapsed && (
          <Text style={pulseStyles.previewLine} numberOfLines={1}>
            {previewText}
          </Text>
        )}
      </Pressable>

      {/* Pills only visible when expanded */}
      {!collapsed && (
        <View style={pulseStyles.pillStack}>
          {/* Pill A — Next Event */}
          {showEventPill && nextEvent && (
            <Pressable
              onPress={() =>
                router.push(`/market/${nextEvent.id}` as Parameters<typeof router.push>[0])
              }
              style={({ pressed }) => [
                pulseStyles.pill,
                { backgroundColor: eventPillBg, borderColor: eventPillBorder },
                pressed && { transform: [{ scale: 0.97 }], opacity: 0.85 },
              ]}
            >
              {/* Top row: type label + countdown */}
              <View style={pulseStyles.pillRowBetween}>
                <Text style={pulseStyles.pillTypeLabel}>
                  🔥 {nextEvent.flagshipEventType ?? "Event"}
                </Text>
                <Text style={pulseStyles.pillCountdown}>{cdLabel}</Text>
              </View>
              {/* Middle row: market question */}
              <Text style={pulseStyles.pillTitle} numberOfLines={1}>
                {nextEvent.title}
              </Text>
              {/* Bottom row: crowd consensus + chevron */}
              <View style={pulseStyles.pillRowBetween}>
                <Text style={pulseStyles.pillConsensus}>
                  {crowdYesPercent != null
                    ? `${crowdYesPercent}% YES · ${totalVotes.toLocaleString()} voted`
                    : `${totalVotes.toLocaleString()} voted`}
                </Text>
                <Text style={pulseStyles.pillChevron}>›</Text>
              </View>
            </Pressable>
          )}

          {/* Pill B — Policy Calendar */}
          {showCalendarPill && (
            <Pressable
              onPress={() => onPress("calendar")}
              style={({ pressed }) => [
                pulseStyles.pill,
                pressed && { transform: [{ scale: 0.97 }], opacity: 0.85 },
              ]}
            >
              {/* Top row: icon + label left, count + chevron right */}
              <View style={pulseStyles.pillRowBetween}>
                <Text style={pulseStyles.pillTypeLabel}>💼 Policy calendar</Text>
                <View style={pulseStyles.pillCountRow}>
                  <Text style={pulseStyles.pillCountdown}>{clustersCount} events</Text>
                  <Text style={pulseStyles.pillChevron}>›</Text>
                </View>
              </View>
              {/* Bottom row: cluster name preview */}
              <Text style={pulseStyles.pillConsensus} numberOfLines={1}>
                {clusterPreview}
              </Text>
            </Pressable>
          )}

          {/* Pill C — RBI current rates (compact inline row, only when rbiRates provided) */}
          {rbiRates != null && (() => {
            const ratePills: { label: string; value: number }[] = [
              { label: "Repo", value: rbiRates.policyRepoRate ?? NaN },
              { label: "CRR",  value: rbiRates.cashReserveRatio ?? NaN },
              { label: "SLR",  value: rbiRates.statutoryLiquidityRatio ?? NaN },
              { label: "SDF",  value: rbiRates.standingDepositFacilityRate ?? NaN },
              { label: "MSF",  value: rbiRates.marginalStandingFacilityRate ?? NaN },
              { label: "Bank", value: rbiRates.bankRate ?? NaN },
            ].filter((r) => Number.isFinite(r.value));
            if (ratePills.length === 0) return null;
            return (
              <View style={pulseStyles.ratesCard}>
                <Text style={pulseStyles.ratesCardLabel}>🏦 RBI rates</Text>
                <View style={pulseStyles.ratesGrid}>
                  {ratePills.map((r) => (
                    <View key={r.label} style={pulseStyles.rateTile}>
                      <Text style={pulseStyles.rateTileLabel}>{r.label}</Text>
                      <Text style={pulseStyles.rateTileValue}>{r.value.toFixed(2)}%</Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })()}
        </View>
      )}
    </View>
  );
}


function PulseSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const pulseStyles = useThemedStyles(makePulseStyles);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={pulseStyles.sheetBackdrop} onPress={onClose} />
      <View style={pulseStyles.sheetContainer}>
        <View style={pulseStyles.sheetHandle} />
        <View style={pulseStyles.sheetHeader}>
          <Text style={pulseStyles.sheetTitle}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={pulseStyles.sheetClose}>Done</Text>
          </Pressable>
        </View>
        <ScrollView style={{ maxHeight: "90%" }} contentContainerStyle={{ paddingBottom: 40 }}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makePulseStyles = (t: ThemeContextValue) => StyleSheet.create({
  // S51-T4: card chrome matching CombinedAnalystCard so PulseRibbon reads as a
  // discrete card, not a section divider. Values copied from that card's chrome.
  // S52-T3: marginTop tightened from sm to xs for uniform 8px inter-card gap.
  card: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    backgroundColor: t.colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.colors.border,
    overflow: "hidden",
  },
  // S51-T4: headingRow is the Pressable that wraps both the label+chevron row
  // and the preview line. paddingHorizontal/paddingVertical give it comfortable
  // tap-target height (~70px collapsed when preview line is visible).
  headingRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  // Inner row: label left, chevron right — flex row inside headingRow.
  headingInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heading: {
    fontSize: 13,
    fontWeight: "500" as const,
    color: t.colors.text,
    letterSpacing: 0,
  },
  collapseChevron: {
    fontSize: 12,
    color: t.colors.textMuted,
  },
  // Preview line shown only in collapsed state below the label row.
  previewLine: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 4,
  },
  // S52: Vertical stack container replacing horizontal ScrollView
  pillStack: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  pill: {
    // S52: Full-width stacked card pill with vertical layout
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: t.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: t.colors.border,
    gap: 4,
  },
  pillMuted: { backgroundColor: t.colors.surfaceMuted, borderColor: t.colors.border },
  pillRowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pillCountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  pillTypeLabel: {
    fontSize: 13,
    fontWeight: "700" as const,
    color: t.colors.text,
  },
  pillCountdown: {
    fontSize: 12,
    fontWeight: "500" as const,
    color: t.colors.textMuted,
  },
  pillTitle: {
    fontSize: 13,
    color: t.colors.text,
  },
  pillConsensus: {
    fontSize: 12,
    color: t.colors.textMuted,
    flexShrink: 1,
  },
  // Legacy style names kept for zero-diff safety on any remaining references
  pillTop: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4 },
  pillIcon: { fontSize: 13 },
  pillLabel: {
    fontSize: 10,
    fontWeight: "700" as const,
    color: t.colors.textMuted,
    letterSpacing: 0.3,
    textTransform: "uppercase" as const,
  },
  pillValue: { fontSize: 12, fontWeight: "700" as const, color: t.colors.text },
  pillChevron: { fontSize: 16, color: t.colors.textSubtle, fontWeight: "600" as const },

  // RBI current rates — showcased as a wrapping grid of stat tiles so every
  // value renders in full (the old single-line row truncated the numbers).
  ratesCard: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    gap: 8,
  },
  ratesCardLabel: {
    fontSize: 13,
    fontWeight: "700" as const,
    color: "#1E40AF",
  },
  ratesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  rateTile: {
    flexGrow: 1,
    flexBasis: "30%",
    minWidth: 60,
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    gap: 2,
  },
  rateTileLabel: {
    fontSize: 9,
    fontWeight: "700" as const,
    color: "#1E40AF",
    textTransform: "uppercase" as const,
    letterSpacing: 0.4,
  },
  rateTileValue: {
    fontSize: 13,
    fontWeight: "800" as const,
    color: t.colors.text,
  },

  // Bottom sheet (events / sentiment / calendar)
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheetContainer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: t.colors.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.lg,
    maxHeight: "85%",
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.colors.border, alignSelf: "center", marginBottom: spacing.md },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md, paddingHorizontal: 4 },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: t.colors.text },
  sheetClose: { fontSize: 14, fontWeight: "700", color: t.colors.accent },
});


// ─── S38: Weekly Calls + Sentiment Toggle Card ───────────────────────────────
// Replaces the standalone WeeklyCallsDigestCard. Toggles between two views:
//   "calls"     → personal performance (HIT / MISS / Pending) — from /api/finance/my-calls-digest
//   "sentiment" → market-wide analyst sentiment (Bullish / Bearish / Neutral) — from /api/finance/expert-sentiment
// Toggle state is persisted in AsyncStorage.

function WeekToggleCard({
  digest,
  sentiment,
  onPressCalls,
  selectedDirectionFilter,
  onSentimentDirectionPress,
}: {
  digest: ApiMyCallsDigest | null;
  sentiment: ApiFinanceExpertSentiment | null;
  onPressCalls: () => void;
  selectedDirectionFilter: DirectionFilter;
  onSentimentDirectionPress: (dir: "BULLISH" | "BEARISH" | "NEUTRAL") => void;
}) {
  const digestStyles = useThemedStyles(makeDigestStyles);
  const hasCalls = digest !== null && (digest.hits + digest.misses + digest.pending) > 0;
  const hasSentiment = sentiment !== null && sentiment.totalCount > 0;

  // S70-T2: Default view is always "calls" so the empty state CTA ("Vote on an
  // analyst call in the feed to start.") is the first thing a new user sees.
  const [view, setViewState] = useState<"calls" | "sentiment">("calls");

  // S51-T3: Expand/collapse state — defaults to compact strip (false).
  // Persisted per-device (no userId in scope); renders collapsed before AsyncStorage
  // hydrates so first render is already in compact mode, no flash.
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    void AsyncStorage.getItem("finance.weekCardView").then((v) => {
      if (v === "calls" || v === "sentiment") setViewState(v);
    });
  }, []);

  useEffect(() => {
    void AsyncStorage.getItem("finance_section_expanded_yourweek").then((v) => {
      if (v === "true") setExpanded(true);
    });
  }, []);

  const setView = useCallback((next: "calls" | "sentiment") => {
    setViewState(next);
    void AsyncStorage.setItem("finance.weekCardView", next);
  }, []);

  const toggleExpanded = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    void AsyncStorage.setItem("finance_section_expanded_yourweek", String(next));
  }, [expanded]);

  // S70-T2: Compact strip — shows counts when data exists, italic prompt when empty.
  if (!expanded) {
    const stripContent = hasCalls ? (
      <Text style={digestStyles.compactStripText}>
        {"Your week: "}
        <Text style={{ color: "#16a34a", fontWeight: "700" }}>{digest!.hits} right</Text>
        {" · "}
        <Text style={{ color: "#dc2626", fontWeight: "700" }}>{digest!.misses} wrong</Text>
        {" · "}
        <Text style={digestStyles.statNeutral}>{digest!.pending} pending</Text>
      </Text>
    ) : (
      <Text style={digestStyles.compactStripTextEmpty}>
        {"Your week: track your accuracy here  ›"}
      </Text>
    );

    return (
      <Pressable
        style={digestStyles.compactStrip}
        onPress={toggleExpanded}
        accessibilityRole="button"
        accessibilityState={{ expanded: false }}
        accessibilityLabel={
          hasCalls
            ? `Your week: ${digest!.hits} correct, ${digest!.misses} wrong, ${digest!.pending} pending. Tap to expand.`
            : "Your week: tap to expand and start tracking your accuracy."
        }
      >
        {stripContent}
        {hasCalls && <Text style={digestStyles.compactStripChevron}>›</Text>}
      </Pressable>
    );
  }

  // S51-T3/T5: Expanded full card — collapse via the explicit ▲ chevron in the
  // toggle row. Active-pill-as-close removed: tapping an active pill now does
  // nothing (expected no-op), and the chevron is the single, discoverable path
  // back to compact strip.
  return (
    <View style={digestStyles.card}>
      {/* Toggle pills row + ▲ collapse chevron (S51-T5) */}
      <View style={digestStyles.toggleRow}>
        {/* S70-T2: Neither pill is disabled in the empty state — user must be
            able to see both sub-views even when they have no data yet. */}
        <Pressable
          style={[digestStyles.toggleBtn, view === "calls" && digestStyles.toggleBtnActive]}
          onPress={() => setView("calls")}
        >
          <Text
            style={[
              digestStyles.toggleText,
              view === "calls" && digestStyles.toggleTextActive,
            ]}
          >
            Your Week
          </Text>
        </Pressable>
        <Pressable
          style={[digestStyles.toggleBtn, view === "sentiment" && digestStyles.toggleBtnActive]}
          onPress={() => setView("sentiment")}
        >
          <Text
            style={[
              digestStyles.toggleText,
              view === "sentiment" && digestStyles.toggleTextActive,
            ]}
          >
            Market Sentiment
          </Text>
        </Pressable>

        {/* Explicit collapse affordance — the only way to collapse from expanded */}
        <Pressable
          onPress={toggleExpanded}
          style={digestStyles.collapseBtn}
          accessibilityRole="button"
          accessibilityLabel="Collapse Your Week to compact strip"
          hitSlop={8}
        >
          <Text style={digestStyles.collapseBtnText}>▲</Text>
        </Pressable>
        <SectionHelp helpKey="finance-your-week-card" />
      </View>

      {/* View body — S70-T2: always render a meaningful state, never blank */}
      {view === "calls" ? (
        hasCalls && digest ? (
          <Pressable onPress={onPressCalls}>
            <WeekCallsBody digest={digest} />
            <Text style={digestStyles.tapHint}>Tap to see all your calls</Text>
          </Pressable>
        ) : (
          /* S70-T2: Empty calls state — show 0/0/0 blocks + motivating CTA */
          <Pressable onPress={onPressCalls}>
            <WeekCallsBodyEmpty />
          </Pressable>
        )
      ) : (
        hasSentiment && sentiment ? (
          <SentimentBody
            sentiment={sentiment}
            selectedDirection={selectedDirectionFilter}
            onDirectionPress={onSentimentDirectionPress}
          />
        ) : (
          <Text style={digestStyles.emptyText}>
            No analyst calls logged this week yet.
          </Text>
        )
      )}
    </View>
  );
}

/** S70-T2: Zero-state calls body — displays 0/0/0 blocks + motivating copy. */
function WeekCallsBodyEmpty() {
  const digestStyles = useThemedStyles(makeDigestStyles);
  return (
    <>
      <View style={digestStyles.statRow}>
        <View style={digestStyles.statBlock}>
          <Text style={[digestStyles.statCount, { color: "#16a34a" }]}>0</Text>
          <Text style={digestStyles.statLabel}>Correct</Text>
        </View>
        <View style={digestStyles.statDivider} />
        <View style={digestStyles.statBlock}>
          <Text style={[digestStyles.statCount, { color: "#dc2626" }]}>0</Text>
          <Text style={digestStyles.statLabel}>Wrong</Text>
        </View>
        <View style={digestStyles.statDivider} />
        <View style={digestStyles.statBlock}>
          <Text style={[digestStyles.statCount, digestStyles.statNeutral]}>0</Text>
          <Text style={digestStyles.statLabel}>Pending</Text>
        </View>
      </View>
      <Text style={digestStyles.emptyCallsAccuracy}>
        Your weekly accuracy — updated as calls you react to get resolved.
      </Text>
      <Text style={digestStyles.emptyCallsCta}>
        Vote on an analyst call in the feed to start.
      </Text>
    </>
  );
}

function WeekCallsBody({ digest }: { digest: ApiMyCallsDigest }) {
  const digestStyles = useThemedStyles(makeDigestStyles);
  const total = digest.hits + digest.misses;
  const correctPct = total > 0 ? Math.round((digest.hits / total) * 100) : 0;
  // S38: HIT/MISS were misleading for user stats — those are RESOLUTION
  // outcomes for the analyst's call. The user's prediction is "Correct" when
  // their AGREE/DISAGREE vote matched how the call actually resolved.
  return (
    <>
      <View style={digestStyles.statRow}>
        <View style={digestStyles.statBlock}>
          <Text style={[digestStyles.statCount, { color: "#16a34a" }]}>{digest.hits}</Text>
          <Text style={digestStyles.statLabel}>Correct</Text>
        </View>
        <View style={digestStyles.statDivider} />
        <View style={digestStyles.statBlock}>
          <Text style={[digestStyles.statCount, { color: "#dc2626" }]}>{digest.misses}</Text>
          <Text style={digestStyles.statLabel}>Wrong</Text>
        </View>
        {digest.pending > 0 && (
          <>
            <View style={digestStyles.statDivider} />
            <View style={digestStyles.statBlock}>
              <Text style={[digestStyles.statCount, digestStyles.statNeutral]}>{digest.pending}</Text>
              <Text style={digestStyles.statLabel}>Pending</Text>
            </View>
          </>
        )}
      </View>
      {total > 0 && (
        <View style={digestStyles.barTrack}>
          <View style={[digestStyles.barFill, { flex: correctPct, backgroundColor: "#16a34a" }]} />
          <View
            style={[digestStyles.barFill, { flex: 100 - correctPct, backgroundColor: "#dc2626" }]}
          />
        </View>
      )}
    </>
  );
}

function SentimentBody({
  sentiment,
  selectedDirection,
  onDirectionPress,
}: {
  sentiment: ApiFinanceExpertSentiment;
  /** S70-T3: Currently active direction filter — highlights the matching block. */
  selectedDirection: DirectionFilter;
  /** S70-T3: Called when user taps a direction block; parent handles filter + scroll. */
  onDirectionPress: (dir: "BULLISH" | "BEARISH" | "NEUTRAL") => void;
}) {
  const digestStyles = useThemedStyles(makeDigestStyles);
  const bullPct = Math.round(sentiment.bullishPercent);
  const bearPct = Math.round(sentiment.bearishPercent);
  const neutPct = Math.round(sentiment.neutralPercent);

  // S70-T3: Visual active-state helper — subtle tint when this direction is selected.
  const blockStyle = (dir: "BULLISH" | "BEARISH" | "NEUTRAL") =>
    selectedDirection === dir
      ? [digestStyles.statBlock, digestStyles.statBlockActive]
      : digestStyles.statBlock;

  return (
    <>
      <View style={digestStyles.statRow}>
        {/* BULLISH block — tappable */}
        <Pressable
          style={({ pressed }) => [blockStyle("BULLISH"), pressed && { opacity: 0.75 }]}
          onPress={() => onDirectionPress("BULLISH")}
          accessibilityRole="button"
          accessibilityLabel={`Filter by Bullish (${bullPct}%)`}
        >
          <Text style={[digestStyles.statCount, { color: "#16a34a" }]}>{bullPct}%</Text>
          <Text style={digestStyles.statLabel}>BULLISH</Text>
        </Pressable>

        <View style={digestStyles.statDivider} />

        {/* BEARISH block — tappable */}
        <Pressable
          style={({ pressed }) => [blockStyle("BEARISH"), pressed && { opacity: 0.75 }]}
          onPress={() => onDirectionPress("BEARISH")}
          accessibilityRole="button"
          accessibilityLabel={`Filter by Bearish (${bearPct}%)`}
        >
          <Text style={[digestStyles.statCount, { color: "#dc2626" }]}>{bearPct}%</Text>
          <Text style={digestStyles.statLabel}>BEARISH</Text>
        </Pressable>

        {/* NEUTRAL block — only rendered when neutPct > 0 */}
        {neutPct > 0 && (
          <>
            <View style={digestStyles.statDivider} />
            <Pressable
              style={({ pressed }) => [blockStyle("NEUTRAL"), pressed && { opacity: 0.75 }]}
              onPress={() => onDirectionPress("NEUTRAL")}
              accessibilityRole="button"
              accessibilityLabel={`Filter by Neutral (${neutPct}%)`}
            >
              <Text style={[digestStyles.statCount, digestStyles.statNeutral]}>{neutPct}%</Text>
              <Text style={digestStyles.statLabel}>Neutral</Text>
            </Pressable>
          </>
        )}
      </View>
      <View style={digestStyles.barTrack}>
        <View style={[digestStyles.barFill, { flex: bullPct || 0.01, backgroundColor: "#16a34a" }]} />
        {neutPct > 0 && (
          <View style={[digestStyles.barFill, { flex: neutPct, backgroundColor: "#9ca3af" }]} />
        )}
        <View style={[digestStyles.barFill, { flex: bearPct || 0.01, backgroundColor: "#dc2626" }]} />
      </View>
      <Text style={digestStyles.tapHint}>
        Across {sentiment.totalCount} analyst {sentiment.totalCount === 1 ? "call" : "calls"} this week — tap a direction to filter
      </Text>
    </>
  );
}

const makeDigestStyles = (t: ThemeContextValue) => StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    // S38: tightened margins above/below per user request — the card was
    // feeling like it had too much breathing room.
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  // S38: toggle row for the merged calls/sentiment card
  toggleRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: spacing.sm,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceMuted,
    alignItems: "center",
  },
  toggleBtnActive: { backgroundColor: t.colors.text, borderColor: t.colors.text },
  toggleText: { fontSize: 12, fontWeight: "700" as const, color: t.colors.textMuted },
  toggleTextActive: { color: t.colors.background },
  // S51-T5: explicit collapse button — sits at the right end of the toggle row
  collapseBtn: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  collapseBtnText: {
    fontSize: 14,
    color: t.colors.textMuted,
    lineHeight: 18,
  },
  emptyText: {
    fontSize: 13,
    color: t.colors.textMuted,
    textAlign: "center",
    paddingVertical: spacing.md,
    fontStyle: "italic",
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  statBlock: {
    alignItems: "center",
    flex: 1,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: t.colors.border,
  },
  statCount: {
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 26,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: t.colors.textMuted,
    marginTop: 1,
    letterSpacing: 0.5,
  },
  barTrack: {
    flexDirection: "row",
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: t.colors.surfaceMuted,
    marginBottom: spacing.xs ?? 4,
  },
  barFill: {
    height: 4,
  },
  statNeutral: {
    color: t.colors.textMuted,
  },
  tapHint: {
    fontSize: 11,
    color: t.colors.textSubtle,
    marginTop: 4,
  },
  // S51-T3: compact strip layout — single-line summary, ~50px tall
  compactStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  compactStripText: {
    fontSize: 13,
    color: t.colors.text,
    flex: 1,
  },
  compactStripChevron: {
    fontSize: 18,
    color: t.colors.textSubtle,
    lineHeight: 20,
  },
  // S70-T2: italic muted text shown in compact strip when there's no call data yet
  compactStripTextEmpty: {
    fontSize: 13,
    color: t.colors.textMuted,
    fontStyle: "italic",
    flex: 1,
  },
  // S70-T2: empty calls body — accuracy explanation line (muted)
  emptyCallsAccuracy: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 8,
    lineHeight: 17,
  },
  // S70-T2: empty calls body — motivating CTA line (blue, bold)
  emptyCallsCta: {
    fontSize: 12,
    fontWeight: "700",
    color: "#2563EB",
    marginTop: 4,
    lineHeight: 17,
  },
  // S70-T3: active direction block — subtle tint to indicate selection
  statBlockActive: {
    backgroundColor: t.colors.surfaceMuted,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
});

// S38 — new filter UX: Show tabs + Sort dropdown + active-filter chip strip.
const makeControlsStyles = (t: ThemeContextValue) => StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  // S38 v3: 2 tabs in a flex row (no scroll needed) — equal-width feel.
  tabsRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  tab: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surface,
    alignItems: "center" as const,
  },
  tabActive: { backgroundColor: t.colors.accent, borderColor: t.colors.accent },
  tabText: { fontSize: 13, fontWeight: "700" as const, color: t.colors.textMuted },
  tabTextActive: { color: "#FFFFFF" },
  // Sort chip lives inside the chip row (after the S38-v2 cramping fix that
  // moved it out of the tabs row).
  sortChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceMuted,
  },
  sortChipText: { fontSize: 11, fontWeight: "700" as const, color: t.colors.text },

  // Active filter chip strip
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    alignItems: "center",
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#eef2ff",
    borderWidth: 1,
    borderColor: "#c7d2fe",
  },
  filterChipText: { fontSize: 11, fontWeight: "700" as const, color: t.colors.accentDeep },
  filterChipX: { fontSize: 14, color: t.colors.accent, marginLeft: 2, lineHeight: 14 },
  addFilterChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderStyle: "dashed" as const,
    backgroundColor: t.colors.surface,
  },
  addFilterText: { fontSize: 11, fontWeight: "700" as const, color: t.colors.textMuted },
  // UX3: clear-all chip — visually distinct (red tint) so it reads as a
  // destructive action vs the neutral "+ Filter" affordance.
  clearAllChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
  },
  clearAllText: { fontSize: 11, fontWeight: "700" as const, color: "#b91c1c" },

  // Action-sheet rows shared by Sort & Add-filter sheets
  sheetRow: {
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetRowActive: { backgroundColor: "#eef2ff" },
  sheetRowText: { fontSize: 15, fontWeight: "600" as const, color: t.colors.text },
  sheetRowTextActive: { color: "#4338ca" },
  sheetRowCheck: { fontSize: 16, color: "#4338ca" },
});

const makeLensStyles = (t: ThemeContextValue) => StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 0,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    flexWrap: "wrap",
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surface,
  },
  pillActive: {
    backgroundColor: t.colors.accent,
    borderColor: t.colors.accent,
  },
  pillText: { fontSize: 12, fontWeight: "600" as const, color: t.colors.textMuted },
  pillTextActive: { color: "#FFFFFF" },
});

// ─── India Macro card (rates-events tab) ──────────────────────────────────────
// Non-collapsible combined card: RBI Policy rates (Repo/CRR/SLR) + IMF Projections
// (GDP Growth, CPI Inflation). Data served from the /api/finance/macro warm store.
// Gracefully omits missing values; hides entirely when all data is null.
function IndiaMacroCard({
  data,
  loading,
}: {
  data: ApiFinanceMacroResponse | null;
  loading: boolean;
}) {
  const pulseStyles = useThemedStyles(makePulseStyles);
  const macroStyles = useThemedStyles(makeMacroStyles);
  const { colors } = useTheme();

  // Skeleton tiles shown while loading
  if (loading) {
    return (
      <View
        style={[
          pulseStyles.card,
          { marginHorizontal: 16, marginTop: 8, marginBottom: 4, padding: 12 },
        ]}
      >
        {/* Skeleton header */}
        <View style={macroStyles.headerRow}>
          <View style={[macroStyles.skeletonBlock, { width: 90, height: 13 }]} />
          <View style={[macroStyles.skeletonBlock, { width: 70, height: 11 }]} />
        </View>
        {/* Skeleton RBI section */}
        <View style={[macroStyles.sectionLabel, { borderBottomWidth: 0, marginTop: 10 }]}>
          <View style={[macroStyles.skeletonBlock, { width: 60, height: 10 }]} />
        </View>
        <View style={macroStyles.tileRow}>
          {[1, 2, 3].map((i) => (
            <View key={i} style={[macroStyles.tile, { flex: 1, alignItems: "center" }]}>
              <View style={[macroStyles.skeletonBlock, { width: 30, height: 9, marginBottom: 4 }]} />
              <View style={[macroStyles.skeletonBlock, { width: 44, height: 14 }]} />
            </View>
          ))}
        </View>
        {/* Skeleton IMF section */}
        <View style={[macroStyles.sectionLabel, { borderBottomWidth: 0, marginTop: 10 }]}>
          <View style={[macroStyles.skeletonBlock, { width: 100, height: 10 }]} />
        </View>
        <View style={macroStyles.tileRow}>
          {[1, 2].map((i) => (
            <View key={i} style={[macroStyles.tile, { flex: 1, alignItems: "center" }]}>
              <View style={[macroStyles.skeletonBlock, { width: 50, height: 9, marginBottom: 4 }]} />
              <View style={[macroStyles.skeletonBlock, { width: 44, height: 14 }]} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  // Build the RBI tiles — only show tiles with a non-null value
  const rbiTiles: { label: string; value: number }[] = [];
  if (data?.rbi?.repoRate != null) rbiTiles.push({ label: "Repo", value: data.rbi.repoRate });
  if (data?.rbi?.crr != null)      rbiTiles.push({ label: "CRR",  value: data.rbi.crr });
  if (data?.rbi?.slr != null)      rbiTiles.push({ label: "SLR",  value: data.rbi.slr });

  // Build the IMF tiles
  const imfTiles: { label: string; value: string }[] = [];
  if (data?.imf?.gdpGrowth != null)    imfTiles.push({ label: "GDP Growth",  value: `${data.imf.gdpGrowth.toFixed(1)}%` });
  if (data?.imf?.cpiInflation != null) imfTiles.push({ label: "Inflation",   value: `${data.imf.cpiInflation.toFixed(1)}%` });

  // If both groups are empty, render nothing — no empty chrome
  if (rbiTiles.length === 0 && imfTiles.length === 0) return null;

  // Format asOf as "d Mon" (e.g. "4 Jul")
  let asOfText: string | null = null;
  if (data?.asOf) {
    try {
      asOfText = new Date(data.asOf).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
      });
    } catch {
      asOfText = null;
    }
  }

  // IMF section label: "IMF Projection, {year}" using the GDP year (or CPI year as fallback)
  const imfYear = data?.imf?.gdpGrowthYear ?? data?.imf?.cpiInflationYear ?? new Date().getFullYear();
  const imfLabel = `IMF Projection, ${imfYear}`;

  return (
    <View
      style={[
        pulseStyles.card,
        { marginHorizontal: 16, marginTop: 8, marginBottom: 4, padding: 12 },
      ]}
    >
      {/* Header row */}
      <View style={macroStyles.headerRow}>
        <Text style={macroStyles.cardTitle}>India Macro</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {asOfText ? (
            <Text style={macroStyles.asOfText}>Updated {asOfText}</Text>
          ) : null}
          <SectionHelp helpKey="finance-india-macro-card" />
        </View>
      </View>

      {/* RBI Policy group */}
      {rbiTiles.length > 0 && (
        <>
          <View style={macroStyles.sectionLabel}>
            <Text style={macroStyles.sectionLabelText}>RBI Policy</Text>
          </View>
          <View style={macroStyles.tileRow}>
            {rbiTiles.map((t) => (
              <View key={t.label} style={[macroStyles.tile, { flex: 1 }]}>
                <Text style={macroStyles.tileLabel}>{t.label}</Text>
                <Text style={macroStyles.tileValue}>{t.value.toFixed(2)}%</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* IMF Projection group */}
      {imfTiles.length > 0 && (
        <>
          <View style={[macroStyles.sectionLabel, { marginTop: rbiTiles.length > 0 ? 10 : 0 }]}>
            <Text style={macroStyles.sectionLabelText}>{imfLabel}</Text>
          </View>
          <View style={macroStyles.tileRow}>
            {imfTiles.map((t) => (
              <View key={t.label} style={[macroStyles.tile, { flex: 1 }]}>
                <Text style={macroStyles.tileLabel}>{t.label}</Text>
                <Text style={macroStyles.tileValue}>{t.value}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

/** Styles exclusive to IndiaMacroCard. */
const makeMacroStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    cardTitle: {
      fontSize: 13,
      fontWeight: "500" as const,
      color: t.colors.text,
    },
    asOfText: {
      fontSize: 11,
      color: t.colors.textMuted,
    },
    // Section label — full-width with 1px hairline bottom border acting as divider
    sectionLabel: {
      borderBottomWidth: 1,
      borderBottomColor: t.colors.border,
      paddingBottom: 4,
      marginBottom: 8,
    },
    sectionLabelText: {
      fontSize: 10,
      fontWeight: "700" as const,
      color: t.colors.textMuted,
      textTransform: "uppercase" as const,
      letterSpacing: 0.5,
    },
    tileRow: {
      flexDirection: "row",
      gap: 8,
    },
    tile: {
      alignItems: "center",
      paddingVertical: 6,
      paddingHorizontal: 4,
      borderRadius: 8,
      backgroundColor: "#EFF6FF",
      borderWidth: 1,
      borderColor: "#BFDBFE",
      gap: 2,
    },
    tileLabel: {
      fontSize: 9,
      fontWeight: "700" as const,
      color: "#1E40AF",
      textTransform: "uppercase" as const,
      letterSpacing: 0.4,
    },
    tileValue: {
      fontSize: 13,
      fontWeight: "800" as const,
      color: t.colors.text,
    },
    // Loading skeleton block
    skeletonBlock: {
      borderRadius: 4,
      backgroundColor: t.colors.surfaceMuted,
    },
  });

// ─── Always-visible RBI Rates card (rates-events tab) ─────────────────────────
// Renders the RBI current rates grid as a standalone non-collapsible card.
// Must call hooks in its own body (themed styles).
// NOTE: This component is retained but no longer used in the Rates & Events tab
// (replaced by IndiaMacroCard in S72). Safe to delete in a future cleanup sprint.
function RbiRatesCard({ rbiRates }: { rbiRates: RbiCurrentRates }) {
  const pulseStyles = useThemedStyles(makePulseStyles);

  const ratePills: { label: string; value: number }[] = [
    { label: "Repo", value: rbiRates.policyRepoRate ?? NaN },
    { label: "CRR",  value: rbiRates.cashReserveRatio ?? NaN },
    { label: "SLR",  value: rbiRates.statutoryLiquidityRatio ?? NaN },
    { label: "SDF",  value: rbiRates.standingDepositFacilityRate ?? NaN },
    { label: "MSF",  value: rbiRates.marginalStandingFacilityRate ?? NaN },
    { label: "Bank", value: rbiRates.bankRate ?? NaN },
  ].filter((r) => Number.isFinite(r.value));

  if (ratePills.length === 0) return null;

  return (
    <View
      style={[
        pulseStyles.card,
        { marginHorizontal: 16, marginTop: 8, marginBottom: 4, padding: 12 },
      ]}
    >
      <View style={pulseStyles.ratesCard}>
        <Text style={pulseStyles.ratesCardLabel}>🏦 RBI rates</Text>
        <View style={pulseStyles.ratesGrid}>
          {ratePills.map((r) => (
            <View key={r.label} style={pulseStyles.rateTile}>
              <Text style={pulseStyles.rateTileLabel}>{r.label}</Text>
              <Text style={pulseStyles.rateTileValue}>{r.value.toFixed(2)}%</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

// ─── Always-visible Policy Calendar card (rates-events tab) ──────────────────
// Renders the eventClusters list inline without a bottom sheet. The
// "See expert takes" footer switches to the Expert Opinions tab first (since
// the feed is hidden while on the rates-events tab), then applies the cluster
// filter and scrolls to the expert section.
function PolicyCalendarCard({
  clusters,
  onGoToCluster,
}: {
  clusters: { id: string; name: string; startsAt: string; endsAt: string; bannerEmoji?: string | null; description?: string | null; dataPoints: { label: string; value: string; subtext?: string | null }[]; expertTakeCount: number }[];
  onGoToCluster: (clusterId: string) => void;
}) {
  const financeStyles = useThemedStyles(makeFinanceStyles);
  const pulseStyles = useThemedStyles(makePulseStyles);

  return (
    <View
      style={[
        pulseStyles.card,
        { marginHorizontal: 16, marginTop: 4, marginBottom: 8, paddingTop: 12, paddingHorizontal: 0, paddingBottom: 0, overflow: "hidden" },
      ]}
    >
      {/* Card heading */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingBottom: 8 }}>
        <Text
          style={[
            pulseStyles.ratesCardLabel,
            { fontSize: 14, fontWeight: "800" },
          ]}
        >
          💼 Policy Calendar
        </Text>
        <SectionHelp helpKey="finance-policy-calendar" />
      </View>

      {clusters.length === 0 ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
          <Text style={financeStyles.emptyText}>No events on the calendar this week.</Text>
        </View>
      ) : (
        clusters.map((cluster) => {
          const hasTakes = cluster.expertTakeCount > 0;
          return (
            <View key={cluster.id} style={[financeStyles.clusterSection, { marginHorizontal: 0, marginBottom: 0, borderRadius: 0, borderLeftWidth: 0, borderRightWidth: 0, borderBottomWidth: 0 }]}>
              {/* Header: emoji + name + date */}
              <View style={financeStyles.clusterHeader}>
                {cluster.bannerEmoji ? (
                  <Text style={financeStyles.clusterEmoji}>{cluster.bannerEmoji}</Text>
                ) : null}
                <View style={financeStyles.clusterHeaderText}>
                  <Text style={financeStyles.clusterName}>{cluster.name}</Text>
                  <Text style={financeStyles.clusterDateRange}>
                    {formatDateRange(cluster.startsAt, cluster.endsAt)}
                  </Text>
                </View>
              </View>

              {/* Description */}
              {cluster.description ? (
                <Text style={financeStyles.clusterDescription}>{cluster.description}</Text>
              ) : null}

              {/* Data points */}
              {cluster.dataPoints && cluster.dataPoints.length > 0 ? (
                <View style={financeStyles.clusterDataGrid}>
                  {cluster.dataPoints.map((dp, idx) => (
                    <View key={idx} style={financeStyles.clusterDataItem}>
                      <Text style={financeStyles.clusterDataLabel}>{dp.label}</Text>
                      <Text style={financeStyles.clusterDataValue}>{dp.value}</Text>
                      {dp.subtext ? (
                        <Text style={financeStyles.clusterDataSubtext}>{dp.subtext}</Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}

              {/* Footer */}
              {hasTakes ? (
                <Pressable
                  style={financeStyles.clusterFooter}
                  onPress={() => onGoToCluster(cluster.id)}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                  <Text style={financeStyles.expertTakesLink}>
                    {`→ See ${cluster.expertTakeCount} expert ${cluster.expertTakeCount === 1 ? "take" : "takes"} in the feed`}
                  </Text>
                </Pressable>
              ) : (
                <View style={financeStyles.clusterFooter}>
                  <Text style={financeStyles.expertTakesMuted}>
                    No expert takes yet — check back closer to the date
                  </Text>
                </View>
              )}
            </View>
          );
        })
      )}
    </View>
  );
}

export function FinanceMode({
  initialClusterId,
}: {
  /** When provided (e.g. via deep-link from opinion detail cluster chip), pre-applies cluster filter. */
  initialClusterId?: string | null;
}) {
  const financeStyles = useThemedStyles(makeFinanceStyles);
  const controlsStyles = useThemedStyles(makeControlsStyles);
  const { colors } = useTheme();
  const [data, setData] = useState<ApiFinanceMarketsResponse | null>(null);
  const [analystSentiment, setAnalystSentiment] = useState<ApiFinanceExpertSentiment | null>(null);
  const [flagshipEvents, setFlagshipEvents] = useState<ApiFlagshipEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Events bottom sheet — opened by tapping macro countdown chip
  const [pulseOpen, setPulseOpen] = useState<PulseKind | null>(null);

  // S35-T2: Today's Big Call spotlight opinion (window-aware after S37)
  const [bigCallOpinion, setBigCallOpinion] = useState<ApiFinanceBigCallOpinion | null>(null);
  const [bigCallWindowLabel, setBigCallWindowLabel] = useState<string>("Today's Big Call");

  // S50-T3: Top analysts this week — fetched independently so a failure here
  // never blocks the main Finance load (markets/news/sentiment/etc.).
  // Finance Mode unmounts/remounts on tab switch (Expo Router tab screens are
  // not kept alive), so this fetch fires on every Finance tab visit.
  // The /api/experts/top-weekly endpoint has a 1-hour server cache (revalidate: 3600),
  // so re-fetching on every tab visit is safe and keeps the data fresh.
  // topWeeklyRefetchEpoch increments on pull-to-refresh to re-trigger the effect.
  const [topWeeklyExperts, setTopWeeklyExperts] = useState<ApiTopExpertEntry[]>([]);
  const [topWeeklyLoading, setTopWeeklyLoading] = useState(true);
  const [topWeeklyRefetchEpoch, setTopWeeklyRefetchEpoch] = useState(0);

  // S62-T7 / redesign: RBI MPC pack from the Poll API — fetched independently so a
  // failure here never blocks the main Finance load. Groups the returned polls
  // by packId and surfaces the first open pack (3 polls: Repo / CRR / SLR).
  const [rbiPollPack, setRbiPollPack] = useState<ApiPoll[] | null>(null);

  // S72: India Macro panel — warm store data from /api/finance/macro.
  // null = loading; non-null = data or 404 (both prevent showing stale nothing).
  // Hydrated from AsyncStorage cache first, then refreshed from API.
  const [macroData, setMacroData] = useState<ApiFinanceMacroResponse | null>(null);
  const [macroLoading, setMacroLoading] = useState(true);

  // S35-T1: Active instrument filter — toggled by tapping ticker chips
  const [activeInstrumentFilter, setActiveInstrumentFilter] = useState<string | null>(null);

  // S35-T3: Finance personal stats from profile
  const [financeProfile, setFinanceProfile] = useState<Pick<ApiUserProfile, "financeStreak" | "financeAccuracy" | "financeTotalVotes" | "financeResolvedVotes"> | null>(null);
  const [marketWindow] = useState<MarketWindow>(() => getMarketWindow());

  // S38 v4: 2 tabs by CONTENT SOURCE (per user spec).
  //   "expert-opinions" → individual named analysts only
  //   "market-analysis" → brokerages / publications only (J.P. Morgan, ET Money, etc.)
  // Resolved + Verified live as filter chips (toggleable, compound on the tab).
  // Sort still uses max(resolvedAt, articlePublishedAt) so resolved calls bubble.
  type ShowScope = "expert-opinions" | "market-analysis" | "rates-events";
  type SortMode = "latest" | "top-week";

  const defaultSortForWindow = (w: MarketWindow): SortMode => {
    if (w === "weekend" || w === "holiday") return "top-week";
    return "latest";
  };

  const [showScope, setShowScopeState] = useState<ShowScope>("expert-opinions");
  const [sortMode, setSortModeState] = useState<SortMode>(() => defaultSortForWindow(marketWindow));
  const [verifiedOnly, setVerifiedOnlyState] = useState(false);
  const [resolvedOnly, setResolvedOnlyState] = useState(false);

  useEffect(() => {
    // Hydrate persisted user overrides (one-time on mount).
    void AsyncStorage.getItem("finance.showScope").then((v) => {
      if (v === "expert-opinions" || v === "market-analysis" || v === "rates-events") setShowScopeState(v);
    });
    void AsyncStorage.getItem("finance.sortMode").then((v) => {
      if (v === "latest" || v === "top-week") setSortModeState(v);
    });
    void AsyncStorage.getItem("finance.verifiedOnly").then((v) => {
      if (v === "1") setVerifiedOnlyState(true);
    });
    void AsyncStorage.getItem("finance.resolvedOnly").then((v) => {
      if (v === "1") setResolvedOnlyState(true);
    });
  }, []);

  // S44-T3: Fetch instrument catalog once on mount. Error → fall back to
  // INSTRUMENT_FALLBACK so the picker remains usable without the API.
  useEffect(() => {
    let cancelled = false;
    mobileApi.getFinanceInstruments()
      .then(({ items }) => {
        if (cancelled) return;
        setInstrumentCatalog(items.length > 0 ? items : INSTRUMENT_FALLBACK);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn("[finance-mode] instrument catalog fetch failed — using fallback:", err);
        setInstrumentCatalog(INSTRUMENT_FALLBACK);
      })
      .finally(() => {
        if (!cancelled) setInstrumentCatalogLoading(false);
      });
    return () => { cancelled = true; };
    // INSTRUMENT_FALLBACK is a component-level const, stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setShowScope = useCallback((next: ShowScope) => {
    setShowScopeState(next);
    void AsyncStorage.setItem("finance.showScope", next);
  }, []);
  const setSortMode = useCallback((next: SortMode) => {
    setSortModeState(next);
    void AsyncStorage.setItem("finance.sortMode", next);
  }, []);
  const setVerifiedOnly = useCallback((next: boolean) => {
    setVerifiedOnlyState(next);
    void AsyncStorage.setItem("finance.verifiedOnly", next ? "1" : "0");
  }, []);
  const setResolvedOnly = useCallback((next: boolean) => {
    setResolvedOnlyState(next);
    void AsyncStorage.setItem("finance.resolvedOnly", next ? "1" : "0");
  }, []);

  // Action-sheet open state for Sort and Add-filter (+ each facet picker)
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [directionPickerOpen, setDirectionPickerOpen] = useState(false);
  const [instrumentPickerOpen, setInstrumentPickerOpen] = useState(false);
  const [analystPickerOpen, setAnalystPickerOpen] = useState(false);

  // S44-T3: Instrument catalog — fetched once on mount; drives searchable picker.
  // Falls back to 5 hardcoded options when the fetch fails or returns empty.
  const INSTRUMENT_FALLBACK: ApiInstrumentCatalogItem[] = [
    { label: "Nifty 50",   ticker: "^NSEI",    count: 0, isPopular: true },
    { label: "Bank Nifty", ticker: "^NSEBANK",  count: 0, isPopular: true },
    { label: "Sensex",     ticker: "^BSESN",   count: 0, isPopular: true },
    { label: "Gold",       ticker: "GC=F",     count: 0, isPopular: true },
    { label: "Crude Oil",  ticker: "CL=F",     count: 0, isPopular: true },
  ];
  const [instrumentCatalog, setInstrumentCatalog] = useState<ApiInstrumentCatalogItem[]>([]);
  const [instrumentCatalogLoading, setInstrumentCatalogLoading] = useState(true);
  const [instrumentSearch, setInstrumentSearch] = useState("");

  // Expert leaderboard count for conditional "Top Experts" link
  const [leaderboardCount, setLeaderboardCount] = useState(0);

  // Latest finance news with attached expert opinions and dual polls
  const [financeNews, setFinanceNews] = useState<ApiNewsFeedItem[]>([]);

  // S28-T2: Pagination state
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // ScrollView ref and expert section Y offset for scroll-to navigation (S18-T2 / T4)
  const scrollViewRef = useRef<ScrollView>(null);
  const expertSectionY = useRef<number>(0);

  // Cluster filter state: when set, only opinions with matching eventClusterId are shown (S18-T4)
  // Initial value can come from a deep-link param (e.g. tapping the cluster chip on opinion detail).
  const [selectedClusterFilter, setSelectedClusterFilter] = useState<string | null>(initialClusterId ?? null);

  // Toggle between named-analyst expert opinions and trusted-source market analysis
  // opinionTab state removed — content type now driven by lens (S37 cleanup).

  // S28-T3: Direction filter state
  const [selectedDirectionFilter, setSelectedDirectionFilter] = useState<DirectionFilter>(null);

  // S28-T1: Follow system state
  const [followedExpertIds, setFollowedExpertIds] = useState<string[]>([]);
  const [expertNamesMap, setExpertNamesMap] = useState<Record<string, { name: string; org: string }>>({});
  const [selectedAnalystFilter, setSelectedAnalystFilter] = useState<string | null>(null);

  // Verified calls — fetched independently so they're always visible
  const [verifiedCalls, setVerifiedCalls] = useState<ApiVerifiedCall[]>([]);

  // S33-T3: Weekly calls digest — null means not yet loaded or user has no votes
  const [callsDigest, setCallsDigest] = useState<ApiMyCallsDigest | null>(null);

  const router = useRouter();

  // Builds the server-side filter payload from current filter state. Everything
  // here gets sent to /api/news so pagination operates on the full filtered
  // result set, not just whatever has already been loaded client-side.
  const buildNewsFilterPayload = useCallback(
    () => ({
      category: "FINANCE" as const,
      limit: 10,
      requireExpertOpinions: true,
      expertOpinionClusterId: selectedClusterFilter ?? undefined,
      expertOpinionSourceType:
        showScope === "expert-opinions"
          ? ("ANALYST" as const)
          : showScope === "market-analysis"
            ? ("PUBLICATION" as const)
            : undefined,
      expertOpinionDirection:
        selectedDirectionFilter === "BULLISH" ||
        selectedDirectionFilter === "BEARISH" ||
        selectedDirectionFilter === "NEUTRAL"
          ? selectedDirectionFilter
          : undefined,
      expertOpinionVerified: verifiedOnly || undefined,
      expertOpinionResolved: resolvedOnly || undefined,
      expertOpinionInstrument: activeInstrumentFilter ?? undefined,
      expertOpinionAnalyst: selectedAnalystFilter ?? undefined,
    }),
    [
      selectedClusterFilter,
      showScope,
      selectedDirectionFilter,
      verifiedOnly,
      resolvedOnly,
      activeInstrumentFilter,
      selectedAnalystFilter,
    ]
  );

  // Snapshot of filter state at fetch-start. Only the default-state fetch is
  // worth caching — caching every filter permutation would balloon storage and
  // confuse the SWR hydration.
  const captureIsDefaultFilter = useCallback(
    () =>
      showScope === "expert-opinions" &&
      selectedDirectionFilter === null &&
      !verifiedOnly &&
      !resolvedOnly &&
      activeInstrumentFilter === null &&
      selectedAnalystFilter === null &&
      selectedClusterFilter === null,
    [
      showScope,
      selectedDirectionFilter,
      verifiedOnly,
      resolvedOnly,
      activeInstrumentFilter,
      selectedAnalystFilter,
      selectedClusterFilter,
    ]
  );

  // SWR hydrate: read the cached default feed on mount and render it instantly.
  // The fresh load() will overwrite it as soon as it lands. If the fresh fetch
  // fails AND we have cache, we keep the cache visible (no error screen).
  const [feedCacheHydrated, setFeedCacheHydrated] = useState(false);
  const hadCacheOnMount = useRef(false);
  useEffect(() => {
    void AsyncStorage.getItem(FEED_DEFAULT_CACHE_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const cache = JSON.parse(raw) as FeedCache;
          if (!Array.isArray(cache.items) || cache.items.length === 0) return;
          // Only apply cache if the fresh fetch hasn't already populated
          // financeNews — otherwise stale cache would overwrite fresh data
          // in the load()-finishes-first race.
          setFinanceNews((prev) => {
            if (prev.length > 0) return prev; // fresh fetch beat us; do nothing
            // Use queueMicrotask so the cursor/hasMore/loading updates batch
            // with the items update rather than triggering 3 separate renders.
            queueMicrotask(() => {
              setNextCursor(cache.nextCursor ?? null);
              setHasMore(Boolean(cache.hasMore));
              hadCacheOnMount.current = true;
              setLoading(false);
            });
            return cache.items;
          });
        } catch (err) {
          console.warn("[finance-mode] feed cache parse failed:", err);
        }
      })
      .catch((err) => console.error("[finance-mode] feed cache read failed:", err))
      .finally(() => setFeedCacheHydrated(true));
  }, []);

  const load = async (isRefresh = false) => {
    // Skip spinner when we already hydrated content from cache — refresh in
    // the background instead of blanking the screen.
    if (!isRefresh && financeNews.length === 0) setLoading(true);
    setError(null);
    const wasDefaultFilter = captureIsDefaultFilter();
    // Snapshot the filter epoch at fetch-start — same staleness check pattern
    // as loadMore. Without this, a slow refresh that lands after the user
    // toggled a filter would clobber the filter-change refetch with stale data.
    const epoch = filterEpochRef.current;
    try {
      // Side cards (sentiment, verified, flagship, digest, big call) each have
      // their own catch so a single failure doesn't blow up the whole screen
      // load — BUT every failure is logged so we can diagnose missing UI parts.
      // The two REQUIRED fetches (markets + news) are not catch-wrapped on
      // purpose: their failure should propagate to the outer catch and trigger
      // the screen-level error state.
      const logSideFetch = (label: string) => (err: unknown) => {
        console.error(`[finance-mode] ${label} fetch failed (card hidden):`, err);
        return null;
      };
      // All seven are idempotent GETs — wrap each in withRetry so a transient
      // "Network request failed" (flaky Wi-Fi / dropped socket / contention when 7
      // requests fire at once) self-heals instead of permanently hiding the card.
      // Critical fetches (markets/news) still propagate to the outer catch after
      // retries are exhausted; side fetches still degrade gracefully via their .catch.
      const [marketsResult, newsResult, sentimentResult, verifiedResult, flagshipResult, digestResult, bigCallResult] = await Promise.all([
        withRetry(() => mobileApi.getFinanceMarkets()),
        withRetry(() => mobileApi.getNews(buildNewsFilterPayload())),
        withRetry(() => mobileApi.getFinanceExpertSentiment()).catch(logSideFetch("expert-sentiment")),
        withRetry(() => mobileApi.getVerifiedCalls()).catch((err) => {
          console.error("[finance-mode] verified-calls fetch failed (showing empty):", err);
          return [];
        }),
        withRetry(() => mobileApi.getFlagshipEvents()).catch((err) => {
          console.error("[finance-mode] flagship-events fetch failed (showing empty):", err);
          return { events: [] };
        }),
        withRetry(() => mobileApi.getMyCallsDigest()).catch(logSideFetch("my-calls-digest")),
        withRetry(() => mobileApi.getFinanceBigCall()).catch(logSideFetch("big-call")),
      ]);

      // Staleness check — if the user toggled a filter while load() was in
      // flight, the filter-change effect has already kicked off a fresh fetch
      // with the new filter. Applying this stale result would clobber it.
      // The non-news state (markets/sentiment/etc.) is filter-independent so
      // we still apply those; only news state is gated by the epoch check.
      const epochStillValid = filterEpochRef.current === epoch;

      setData(marketsResult);
      if (epochStillValid) {
        setFinanceNews(newsResult.items ?? []);
        setNextCursor(newsResult.nextCursor ?? null);
        setHasMore(newsResult.hasMore ?? false);

        // SWR write-through: persist the default-filter feed so the next cold
        // app launch can hydrate instantly even if the network is down.
        if (wasDefaultFilter && (newsResult.items?.length ?? 0) > 0) {
          const cache: FeedCache = {
            items: newsResult.items ?? [],
            nextCursor: newsResult.nextCursor ?? null,
            hasMore: newsResult.hasMore ?? false,
            savedAt: Date.now(),
          };
          void AsyncStorage.setItem(FEED_DEFAULT_CACHE_KEY, JSON.stringify(cache)).catch(
            (err) => console.error("[finance-mode] feed cache write failed:", err)
          );
        }
      } else {
        console.info("[finance-mode] load() result dropped — filter changed mid-flight");
      }
      setAnalystSentiment(sentimentResult);
      setVerifiedCalls(verifiedResult ?? []);
      setFlagshipEvents((flagshipResult?.events ?? []) as ApiFlagshipEvent[]);
      // Only show digest card when the user has voted on at least one resolved opinion
      if (digestResult && digestResult.resolvedOpinions.length > 0) {
        setCallsDigest(digestResult);
      }
      // S35-T2 / S37: Big Call spotlight — window-aware
      setBigCallOpinion(bigCallResult?.opinion ?? null);
      if (bigCallResult?.windowLabel) setBigCallWindowLabel(bigCallResult.windowLabel);

      // Note: pull-to-refresh deliberately preserves all filter state.
      // The user wanted fresh data with their current filter setup intact —
      // wiping their carefully-set filters on every refresh was a footgun.
    } catch (err) {
      console.error("[finance-mode] initial load failed:", err);
      // If we hydrated from cache, the user is already seeing content —
      // don't blank the screen with an error. Just log + keep stale data.
      if (financeNews.length === 0) {
        setError("Couldn't load finance content. Check your connection and tap Retry.");
      }
    } finally {
      setLoading(false);
      if (isRefresh) setRefreshing(false);
    }
  };

  // Load more items (append to list). Includes all active server-side filters
  // so pagination continues over the filtered set. Captures filterEpochRef at
  // start of fetch — if the user toggles a filter mid-flight, the response is
  // dropped so it can't corrupt state or the pagination cursor of the new filter.
  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || nextCursor === null) return;
    const epoch = filterEpochRef.current;
    setLoadingMore(true);
    try {
      const result = await mobileApi.getNews({
        ...buildNewsFilterPayload(),
        cursor: nextCursor,
      });
      if (filterEpochRef.current !== epoch) {
        // Filter changed mid-request — discard response so we don't clobber
        // state with results from a stale filter context.
        return;
      }
      setFinanceNews((prev) => {
        // Defensive dedup — should be a no-op now that the epoch check above
        // catches stale responses, but cheap insurance against any other
        // overlap source (e.g. server-side cursor edge cases on same-timestamp
        // pages). If this set ever filters anything out, log it because it
        // means the assumption above is wrong somewhere.
        const seenIds = new Set(prev.map((p) => p.id));
        const fresh = (result.items ?? []).filter((it) => !seenIds.has(it.id));
        const filtered = (result.items ?? []).length - fresh.length;
        if (filtered > 0) {
          console.warn(
            `[finance-mode] loadMore dedup filtered ${filtered} duplicate item(s) — investigate cursor/filter race`
          );
        }
        return [...prev, ...fresh];
      });
      setNextCursor(result.nextCursor ?? null);
      setHasMore(result.hasMore ?? false);
    } catch (err) {
      // Surface to console with context — caller can also trigger a retry by
      // scrolling again. We deliberately don't reset hasMore so the UI keeps
      // the "load more" affordance available.
      console.error("[finance-mode] loadMore failed:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, nextCursor, buildNewsFilterPayload]);

  // S28-T2: Scroll handler — trigger loadMore when within 200px of bottom
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
      if (distanceFromBottom < 200) {
        void loadMore();
      }
    },
    [loadMore]
  );

  // Check leaderboard for conditional link
  const checkLeaderboard = async () => {
    try {
      const lb = await mobileApi.getExpertLeaderboard();
      setLeaderboardCount(Array.isArray(lb) ? lb.length : 0);
    } catch (err) {
      console.error("[finance-mode] getExpertLeaderboard failed (hiding See Top Experts link):", err);
      setLeaderboardCount(0);
    }
  };

  // Load followed expert IDs (from cache first, then API)
  const loadFollowedExperts = useCallback(async () => {
    // Instant render from AsyncStorage cache
    try {
      const cached = await AsyncStorage.getItem(FOLLOWED_ANALYSTS_KEY);
      if (cached) {
        const ids: string[] = JSON.parse(cached) as string[];
        setFollowedExpertIds(ids);
      }
    } catch (err) {
      console.warn("[finance-mode] reading followed-experts cache failed:", err);
    }

    // Then fetch from API. Cache is the fallback — log so a degraded UI
    // (stale followed-experts list) is diagnosable instead of mysterious.
    try {
      const ids = await mobileApi.getFollowedExperts();
      setFollowedExpertIds(ids);
      await AsyncStorage.setItem(FOLLOWED_ANALYSTS_KEY, JSON.stringify(ids));
    } catch (err) {
      console.error("[finance-mode] getFollowedExperts failed (using cached list):", err);
    }
  }, []);

  // Load finance streak + accuracy from profile. Unauthenticated users will
  // 401 — that's the only acceptable silent case; everything else is a real
  // error we want to see.
  const loadFinanceProfile = useCallback(async () => {
    try {
      const profile = await mobileApi.getMyProfile();
      if (profile?.user) {
        setFinanceProfile({
          financeStreak: profile.user.financeStreak ?? 0,
          financeAccuracy: profile.user.financeAccuracy ?? null,
          financeTotalVotes: profile.user.financeTotalVotes ?? 0,
          financeResolvedVotes: profile.user.financeResolvedVotes ?? 0,
        });
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        // Expected for unauthenticated browse — no log needed.
        return;
      }
      console.error("[finance-mode] getMyProfile failed:", err);
    }
  }, []);

  // S35-T1: Toggle instrument filter (tap again to clear)
  const handleToggleInstrumentFilter = useCallback((label: string) => {
    setActiveInstrumentFilter((prev) => (prev === label ? null : label));
  }, []);

  useEffect(() => {
    void load();
    void checkLeaderboard();
    void loadFollowedExperts();
    void loadFinanceProfile();
  }, []);

  // Refetch the news feed whenever ANY filter changes so server-side filtering
  // surfaces all matching stories across the full dataset (not just the first
  // page that happens to already be loaded). The filter payload itself is the
  // dependency — useCallback identity changes when any constituent state changes.
  //
  // filterEpochRef bumps on every filter change so any in-flight loadMore from
  // the previous filter context can detect it's stale and drop its response —
  // otherwise it would clobber state with wrong-filter data and corrupt the
  // pagination cursor for subsequent scrolls.
  const isInitialMount = useRef(true);
  const filterEpochRef = useRef(0);
  useEffect(() => {
    filterEpochRef.current += 1;
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const epoch = filterEpochRef.current;
    let cancelled = false;
    (async () => {
      try {
        const result = await mobileApi.getNews(buildNewsFilterPayload());
        if (cancelled || filterEpochRef.current !== epoch) return;
        setFinanceNews(result.items ?? []);
        setNextCursor(result.nextCursor ?? null);
        setHasMore(result.hasMore ?? false);
      } catch (err) {
        if (cancelled) return;
        // Surface so a busted filter change is visible — user keeps the old
        // (stale) feed but at least we see the error in the console / Sentry.
        console.error("[finance-mode] filter-change refetch failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buildNewsFilterPayload]);

  // S50-T3: Fetch top weekly experts independently — isolated from the main Promise.all
  // so a failed or slow top-weekly call never affects market/news rendering.
  // topWeeklyRefetchEpoch increments on pull-to-refresh so this effect re-fires.
  useEffect(() => {
    let cancelled = false;
    setTopWeeklyLoading(true);
    void mobileApi.getTopWeeklyExperts().then((entries) => {
      if (!cancelled) {
        setTopWeeklyExperts(entries.slice(0, 3));
        setTopWeeklyLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setTopWeeklyExperts([]);
        setTopWeeklyLoading(false);
      }
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topWeeklyRefetchEpoch]);

  // S62-T7 / redesign: Fetch RBI MPC pack from the Poll API independently so any failure
  // here does not block the main Finance screen load. Re-fires on pull-to-refresh
  // via topWeeklyRefetchEpoch (both cards share the same epoch counter).
  // A valid pack has 2+ polls sharing the same packId; ordered by createdAt ascending
  // so creation order (Repo → CRR → SLR) is preserved.
  useEffect(() => {
    let cancelled = false;
    withRetry(() => mobileApi.getPollPacks({ status: "open" }))
      .then(({ polls }) => {
        if (cancelled) return;
        // Group polls by packId.
        const byPack = new Map<string, ApiPoll[]>();
        for (const poll of polls) {
          if (!poll.packId) continue;
          const group = byPack.get(poll.packId) ?? [];
          group.push(poll);
          byPack.set(poll.packId, group);
        }
        for (const [, packPolls] of byPack.entries()) {
          if (packPolls.length < 2) continue;
          // Sort by createdAt ascending so Repo → CRR → SLR order is preserved.
          const sorted = [...packPolls].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
          setRbiPollPack(sorted);
          return; // Take the first valid pack only
        }
        // No valid pack found — clear any stale state
        setRbiPollPack(null);
      })
      .catch((err: unknown) => {
        console.error("[finance-mode] getPollPacks fetch failed (RBI card hidden):", err);
        if (!cancelled) setRbiPollPack(null);
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topWeeklyRefetchEpoch]);

  // S72: India Macro panel — fetches from /api/finance/macro warm store.
  // SWR pattern: hydrate from AsyncStorage cache immediately, then refresh from API.
  // Re-fires on topWeeklyRefetchEpoch (shared pull-to-refresh epoch counter).
  const MACRO_CACHE_KEY = "finance:macro:v1";
  useEffect(() => {
    let cancelled = false;

    // 1. Hydrate from cache first for instant render
    void AsyncStorage.getItem(MACRO_CACHE_KEY)
      .then((raw) => {
        if (!raw || cancelled) return;
        try {
          const cached = JSON.parse(raw) as ApiFinanceMacroResponse;
          if (!cancelled) {
            setMacroData(cached);
            setMacroLoading(false);
          }
        } catch {
          // Malformed cache — ignore, fresh fetch will fix it
        }
      })
      .catch(() => {
        // Cache read failure is non-fatal
      });

    // 2. Fresh fetch from API
    mobileApi.getFinanceMacro()
      .then((fresh) => {
        if (cancelled) return;
        setMacroData(fresh);
        setMacroLoading(false);
        void AsyncStorage.setItem(MACRO_CACHE_KEY, JSON.stringify(fresh)).catch(() => {
          // Cache write failure is non-fatal
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 404 = cron hasn't seeded yet; other errors = network/server issue.
        // Either way, keep showing cached data or nothing (don't crash).
        console.warn("[finance-mode] getFinanceMacro failed (macro card hidden or stale):", err);
        setMacroLoading(false);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topWeeklyRefetchEpoch]);

  // S28-T1: Build expert name map from loaded financeNews
  useEffect(() => {
    const map: Record<string, { name: string; org: string }> = {};
    for (const item of financeNews) {
      for (const op of (item.expertOpinions ?? [])) {
        if (!map[op.expertId]) {
          map[op.expertId] = { name: op.expertName, org: op.expertOrganization };
        }
      }
    }
    setExpertNamesMap((prev) => ({ ...prev, ...map }));
  }, [financeNews]);

  // S28-T1: Handle follow/unfollow from ExpertOpinionRow — update local state + cache
  const handleFollowToggle = useCallback(async (expertId: string, currentlyFollowing: boolean) => {
    try {
      if (currentlyFollowing) {
        await mobileApi.unfollowExpert(expertId);
        setFollowedExpertIds((prev) => {
          const next = prev.filter((id) => id !== expertId);
          void AsyncStorage.setItem(FOLLOWED_ANALYSTS_KEY, JSON.stringify(next));
          return next;
        });
      } else {
        await mobileApi.followExpert(expertId);
        setFollowedExpertIds((prev) => {
          const next = [...prev, expertId];
          void AsyncStorage.setItem(FOLLOWED_ANALYSTS_KEY, JSON.stringify(next));
          return next;
        });
      }
    } catch {
      // Optimistic update already happened in ExpertOpinionRow — re-sync on next load
    }
  }, []);

  if (loading) {
    return (
      <View style={financeStyles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={financeStyles.center}>
        <Text style={financeStyles.errorText}>{error}</Text>
        <Pressable
          style={({ pressed }) => [financeStyles.retryBtn, pressed && { opacity: 0.7 }]}
          onPress={() => void load()}
        >
          <Text style={financeStyles.retryBtnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
    <ScrollView
      ref={scrollViewRef}
      style={financeStyles.scroll}
      contentContainerStyle={financeStyles.scrollContent}
      onScroll={handleScroll}
      // 32ms = ~30fps onScroll fires — responsive enough that loadMore's
      // 200px-from-bottom trigger catches fast flicks. 200ms (the previous
      // setting) would miss the window during a quick swipe.
      scrollEventThrottle={32}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            // Also re-trigger the independent top-weekly fetch (S50-T3)
            setTopWeeklyRefetchEpoch((e) => e + 1);
            void load(true);
          }}
          tintColor={colors.accent}
        />
      }
    >
      {SHOW_TOP_ANALYSTS && (
        <CombinedAnalystCard
          opinion={SHOW_OVERNIGHT_BIG_CALL ? bigCallOpinion : null}
          windowLabel={bigCallWindowLabel}
          onOpenOpinionDetail={() => {
            if (bigCallOpinion) {
              router.push(`/finance/opinion/${bigCallOpinion.id}` as Parameters<typeof router.push>[0]);
            }
          }}
          entries={topWeeklyExperts}
          topLoading={topWeeklyLoading}
          onAnalystPress={(expertId) =>
            router.push(`/expert/${expertId}` as Parameters<typeof router.push>[0])
          }
        />
      )}

      {/* S38: Merged Your Week + Market Sentiment toggle card.
          Replaces the old standalone WeeklyCallsDigestCard. Sentiment moved out
          of the PulseRibbon and merged here under a toggle. */}
      <WeekToggleCard
        digest={callsDigest}
        sentiment={analystSentiment}
        onPressCalls={() => router.push("/finance/my-calls" as Parameters<typeof router.push>[0])}
        selectedDirectionFilter={selectedDirectionFilter}
        onSentimentDirectionPress={(dir) => {
          // S70-T3: toggle filter (tap again to clear), switch to expert-opinions,
          // and scroll down to the expert section so the filter result is visible.
          setSelectedDirectionFilter((prev) => (prev === dir ? null : dir));
          setShowScope("expert-opinions");
          setTimeout(
            () => scrollViewRef.current?.scrollTo({ y: expertSectionY.current, animated: true }),
            200
          );
        }}
      />

      {/* Personal Accuracy Chip removed — "Start voting — track your accuracy"
          didn't have a clear meaning. Accuracy stats live on the user's profile
          and inside the Weekly Calls Digest card. */}

      {/* Section 3: Expert Opinions + Market Analysis (NOW THE HERO FEED) */}
      <View
        style={financeStyles.unclusteredSection}
        onLayout={(e) => { expertSectionY.current = e.nativeEvent.layout.y; }}
      >
        {/* S38 v3: 3 tabs (content TYPE — exclusive). Verified + Resolved
            moved to filter chips since they're qualifiers, not content types.
            "Rates & Events" shows always-visible RBI Rates, Policy Calendar, and MPC polls. */}
        <View style={controlsStyles.tabsRow}>
          {([
            { key: "expert-opinions" as const, label: "Expert Opinions" },
            { key: "market-analysis" as const, label: "Market Analysis" },
            { key: "rates-events" as const, label: "Rates & Events" },
          ]).map((opt) => {
            const active = showScope === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setShowScope(opt.key)}
                style={[controlsStyles.tab, active && controlsStyles.tabActive]}
              >
                <Text style={[controlsStyles.tabText, active && controlsStyles.tabTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
          <SectionHelp helpKey="finance-scope-tabs" />
        </View>

        {/* Rates & Events tab content — always-visible cards (no PulseRibbon, no collapse).
            S72 render order: IndiaMacroCard → PolicyCalendarCard → MpcPollPackCard.
            Rendered ONLY when showScope === "rates-events". */}
        {showScope === "rates-events" && (
          <>
            {/* S72: India Macro card — combined RBI rates + IMF projections from warm store */}
            <IndiaMacroCard data={macroData} loading={macroLoading} />

            {/* Policy Calendar card — always visible; "See expert takes" switches to Expert Opinions tab */}
            <PolicyCalendarCard
              clusters={data?.eventClusters ?? []}
              onGoToCluster={(clusterId) => {
                setShowScope("expert-opinions");
                setSelectedClusterFilter(clusterId);
                setTimeout(
                  () => scrollViewRef.current?.scrollTo({ y: expertSectionY.current, animated: true }),
                  200
                );
              }}
            />

            {/* MPC predict card — non-collapsible, shown when an open RBI MPC pack exists */}
            {rbiPollPack !== null && (
              <MpcPollPackCard polls={rbiPollPack} />
            )}
          </>
        )}

        {/* Sort/filter chip strip + opinion/market feed.
            Hidden when the Rates & Events tab is active — that tab has its
            own dedicated content (RBI Rates + Policy Calendar + MpcPollPackCard) rendered above. */}
        {showScope !== "rates-events" && <>
        {/* S38: Sort + active-filter chip strip — replaces the 3 separate rows
            (MY ANALYSTS row + instrument banner + cluster banner) AND hosts the
            Sort dropdown so it doesn't crowd the Show tabs row above. */}
        <View style={controlsStyles.chipRow}>
          {/* Sort chip — leads the row so it's always visible */}
          <Pressable
            style={controlsStyles.sortChip}
            onPress={() => setSortSheetOpen(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={controlsStyles.sortChipText}>
              ⇅ {sortMode === "latest" ? "Latest" : "Top week"}
            </Text>
          </Pressable>

          {/* Resolved-only filter chip */}
          {resolvedOnly && (
            <Pressable
              style={controlsStyles.filterChip}
              onPress={() => setResolvedOnly(false)}
            >
              <Text style={controlsStyles.filterChipText}>🎯 Resolved</Text>
              <Text style={controlsStyles.filterChipX}>×</Text>
            </Pressable>
          )}

          {/* Verified-only filter chip */}
          {verifiedOnly && (
            <Pressable
              style={controlsStyles.filterChip}
              onPress={() => setVerifiedOnly(false)}
            >
              <Text style={controlsStyles.filterChipText}>✓ Verified</Text>
              <Text style={controlsStyles.filterChipX}>×</Text>
            </Pressable>
          )}

          {selectedDirectionFilter !== null && selectedDirectionFilter !== "VERIFIED" && (
            <Pressable
              style={controlsStyles.filterChip}
              onPress={() => setSelectedDirectionFilter(null)}
            >
              <Text style={controlsStyles.filterChipText}>
                {selectedDirectionFilter === "BULLISH" ? "↑ Bullish" :
                 selectedDirectionFilter === "BEARISH" ? "↓ Bearish" : "→ Neutral"}
              </Text>
              <Text style={controlsStyles.filterChipX}>×</Text>
            </Pressable>
          )}
          {activeInstrumentFilter !== null && (
            <Pressable
              style={controlsStyles.filterChip}
              onPress={() => setActiveInstrumentFilter(null)}
            >
              <Text style={controlsStyles.filterChipText}>📊 {activeInstrumentFilter}</Text>
              <Text style={controlsStyles.filterChipX}>×</Text>
            </Pressable>
          )}
          {selectedAnalystFilter !== null && (
            <Pressable
              style={controlsStyles.filterChip}
              onPress={() => setSelectedAnalystFilter(null)}
            >
              <Text style={controlsStyles.filterChipText}>
                👤 {expertNamesMap[selectedAnalystFilter]?.name ?? "Analyst"}
              </Text>
              <Text style={controlsStyles.filterChipX}>×</Text>
            </Pressable>
          )}
          {selectedClusterFilter !== null && (() => {
            const activeCluster = data?.eventClusters.find((c) => c.id === selectedClusterFilter);
            return (
              <Pressable
                style={controlsStyles.filterChip}
                onPress={() => setSelectedClusterFilter(null)}
              >
                <Text style={controlsStyles.filterChipText}>
                  📅 {activeCluster?.name ?? "Cluster"}
                </Text>
                <Text style={controlsStyles.filterChipX}>×</Text>
              </Pressable>
            );
          })()}
          <Pressable
            style={controlsStyles.addFilterChip}
            onPress={() => setFilterSheetOpen(true)}
          >
            <Text style={controlsStyles.addFilterText}>+ Filter</Text>
          </Pressable>
          {/* UX3: Clear-all affordance — only shows when ≥2 filters are active,
              so it never clutters the single-chip case (which already has its own × on the chip). */}
          {(() => {
            const activeCount =
              (resolvedOnly ? 1 : 0) +
              (verifiedOnly ? 1 : 0) +
              (selectedDirectionFilter !== null ? 1 : 0) +
              (activeInstrumentFilter !== null ? 1 : 0) +
              (selectedAnalystFilter !== null ? 1 : 0) +
              (selectedClusterFilter !== null ? 1 : 0);
            if (activeCount < 2) return null;
            return (
              <Pressable
                style={controlsStyles.clearAllChip}
                onPress={() => {
                  setResolvedOnly(false);
                  setVerifiedOnly(false);
                  setSelectedDirectionFilter(null);
                  setActiveInstrumentFilter(null);
                  setSelectedAnalystFilter(null);
                  setSelectedClusterFilter(null);
                }}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Text style={controlsStyles.clearAllText}>Clear all ({activeCount}) ×</Text>
              </Pressable>
            );
          })()}
          <SectionHelp helpKey="finance-sort-filter-chips" />
        </View>

        {(() => {
          // Group opinions by (storyId, expertId) so same analyst's takes on one article share a card
          interface GroupedCard {
            key: string;
            storyId: string;
            storyHeadline: string;
            articlePublishedAt: string;
            opinions: NonNullable<ApiNewsFeedItem["expertOpinions"]>;
          }
          const grouped: GroupedCard[] = [];
          const seen = new Map<string, number>();
          // S38 (per user): Big Call hero is an ADD-ON spotlight, not a
          // substitute. The same opinion still appears in the list below — so
          // the math between sentiment count and feed count reconciles 1:1.
          // Defensive: dedupe items by id before grouping so a duplicate row
          // in financeNews can't generate two groups with the same key.
          const seenItemIds = new Set<string>();
          for (const item of financeNews) {
            if (seenItemIds.has(item.id)) continue;
            seenItemIds.add(item.id);
            for (const op of (item.expertOpinions ?? [])) {
              const key = `${item.id}::${op.expertId}`;
              const idx = seen.get(key);
              if (idx !== undefined) {
                grouped[idx].opinions.push(op);
              } else {
                seen.set(key, grouped.length);
                grouped.push({ key, storyId: item.id, storyHeadline: item.headline, articlePublishedAt: item.publishedAt, opinions: [op] });
              }
            }
          }

          // Apply cluster filter: show group if any opinion matches the selected cluster
          let filteredGroups = selectedClusterFilter
            ? grouped.filter((g) => g.opinions.some((op) => op.eventClusterId === selectedClusterFilter))
            : grouped;

          // S28-T1: Apply analyst filter
          if (selectedAnalystFilter !== null) {
            filteredGroups = filteredGroups.filter((g) =>
              g.opinions.some((op) => op.expertId === selectedAnalystFilter)
            );
          }

          // S35-T1: Apply instrument filter from ticker chip tap
          if (activeInstrumentFilter !== null) {
            const needle = activeInstrumentFilter.toLowerCase();
            filteredGroups = filteredGroups
              .map((g) => ({
                ...g,
                opinions: g.opinions.filter(
                  (op) =>
                    op.instrument?.toLowerCase().includes(needle) ||
                    op.instrumentTicker?.toLowerCase().includes(needle)
                ),
              }))
              .filter((g) => g.opinions.length > 0);
          }

          // S28-T3: Apply direction/verified filter at the individual opinion level
          // VERIFIED uses the dedicated verifiedCalls fetch — handled below at render time
          if (selectedDirectionFilter !== null && selectedDirectionFilter !== "VERIFIED") {
            filteredGroups = filteredGroups
              .map((g) => ({
                ...g,
                opinions: g.opinions.filter((op) => op.direction === selectedDirectionFilter),
              }))
              .filter((g) => g.opinions.length > 0);
          }

          // S38 v3: Verified is a separate boolean filter (not a tab).
          if (verifiedOnly) {
            filteredGroups = filteredGroups
              .map((g) => ({ ...g, opinions: g.opinions.filter((op) => op.verified) }))
              .filter((g) => g.opinions.length > 0);
          }

          // S38 v4: Resolved-only filter — keep only HIT/MISS calls.
          if (resolvedOnly) {
            filteredGroups = filteredGroups
              .map((g) => ({
                ...g,
                opinions: g.opinions.filter(
                  (op) =>
                    op.resolutionStatus === "RESOLVED_HIT" ||
                    op.resolutionStatus === "RESOLVED_MISS"
                ),
              }))
              .filter((g) => g.opinions.length > 0);
          }

          // Sort key:
          //   • resolvedOnly mode → strictly by latest resolvedAt (matches the
          //     server-side latestResolvedAt cursor so loaded items stay in order)
          //   • otherwise → max(articlePublishedAt, latest resolvedAt) so a
          //     freshly-resolved old call still bubbles up among pending ones
          const groupSortKey = (g: GroupedCard): number => {
            let maxResolvedTs = 0;
            for (const op of g.opinions) {
              if (op.resolvedAt) {
                const t = new Date(op.resolvedAt).getTime();
                if (t > maxResolvedTs) maxResolvedTs = t;
              }
            }
            if (resolvedOnly) {
              return maxResolvedTs;
            }
            const articleTs = new Date(g.articlePublishedAt).getTime();
            return Math.max(articleTs, maxResolvedTs);
          };

          if (sortMode === "top-week") {
            // "This week" pivots on which timestamp the user is actually
            // looking at:
            //   - resolvedOnly ON → window is "resolved within the last 7
            //     days" (matches the server-side latestResolvedAt cursor
            //     and the date users see on these cards).
            //   - resolvedOnly OFF → window is "call was made within the
            //     last 7 days" (articlePublishedAt). A 30-day-old call
            //     that resolved this week is still a 30-day-old CALL when
            //     we're showing pending + resolved together.
            // Sort within the filtered set by groupSortKey so freshly
            // resolved calls still bubble to the top of the visible list.
            const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
            const now = Date.now();
            const groupWindowTs = (g: GroupedCard): number => {
              if (resolvedOnly) {
                let maxResolvedTs = 0;
                for (const op of g.opinions) {
                  if (op.resolvedAt) {
                    const t = new Date(op.resolvedAt).getTime();
                    if (t > maxResolvedTs) maxResolvedTs = t;
                  }
                }
                return maxResolvedTs;
              }
              return new Date(g.articlePublishedAt).getTime();
            };
            filteredGroups = [...filteredGroups]
              .filter((g) => {
                const ts = groupWindowTs(g);
                return ts > 0 && now - ts <= SEVEN_DAYS_MS;
              })
              .sort((a, b) => {
                if (b.opinions.length !== a.opinions.length) {
                  return b.opinions.length - a.opinions.length;
                }
                return groupSortKey(b) - groupSortKey(a);
              });
          } else {
            // "latest" default — sorted by max(resolvedAt, articlePublishedAt) desc
            filteredGroups = [...filteredGroups].sort(
              (a, b) => groupSortKey(b) - groupSortKey(a)
            );
          }

          // Split into named-analyst opinions vs trusted-source market analysis.
          // Route to Market Analysis if: isSourceAttribution=true OR no individual expertName
          // (catches Goldman Sachs/JPMorgan institutional notes where AI omits a personal name).
          const isAnalysis = (g: GroupedCard) =>
            g.opinions[0].isSourceAttribution || !g.opinions[0].expertName?.trim();
          const expertGroups = filteredGroups.filter((g) => !isAnalysis(g));
          const analysisGroups = filteredGroups.filter((g) => isAnalysis(g));

          if (grouped.length === 0) {
            return (
              <View style={financeStyles.expertEmptyCard}>
                <Text style={financeStyles.expertEmptyIcon}>📊</Text>
                <Text style={financeStyles.expertEmptyTitle}>No expert takes yet</Text>
                <Text style={financeStyles.expertEmptySubtitle}>
                  Trusted analyst opinions are extracted daily from leading finance sources. Check back soon.
                </Text>
                <Pressable
                  onPress={() => router.push("/(tabs)/markets" as Parameters<typeof router.push>[0])}
                  style={financeStyles.expertEmptyLink}
                >
                  <Text style={financeStyles.expertEmptyLinkText}>View all finance markets ↓</Text>
                </Pressable>
              </View>
            );
          }

          const allGroups = selectedClusterFilter
            ? grouped.filter((g) => g.opinions.some((op) => op.eventClusterId === selectedClusterFilter))
            : grouped;

          if (allGroups.length === 0 && selectedClusterFilter !== null) {
            return (
              <View style={financeStyles.expertEmptyCard}>
                <Text style={financeStyles.expertEmptyTitle}>No opinions tagged to this cluster yet</Text>
                <Pressable onPress={() => setSelectedClusterFilter(null)} style={financeStyles.expertEmptyLink}>
                  <Text style={financeStyles.expertEmptyLinkText}>Show all opinions</Text>
                </Pressable>
              </View>
            );
          }

          // S38 v2: "For You" is now a true union — includes BOTH named-analyst
          // opinions AND brokerage notes (J.P. Morgan, ET Money, etc.).
          //   "for-you"  → union (expert + analysis), re-sorted by chosen sortMode
          //   "verified" → expert-only (already filtered to verified above)
          //   "resolved" → union (already filtered to resolved above), so brokerage HITs show too
          //   "analysis" → analysis-only
          // S38 v4: 2 tabs by source type — strict split.
          //   expert-opinions → individual named analysts only
          //   market-analysis → brokerages/publications only
          const activeGroups =
            showScope === "market-analysis" ? analysisGroups : expertGroups;

          // S28-T3: Count unfiltered groups for toggle badge
          const allExpertGroups = (selectedClusterFilter
            ? grouped.filter((g) => g.opinions.some((op) => op.eventClusterId === selectedClusterFilter))
            : grouped
          ).filter((g) => !isAnalysis(g));
          const allAnalysisGroups = (selectedClusterFilter
            ? grouped.filter((g) => g.opinions.some((op) => op.eventClusterId === selectedClusterFilter))
            : grouped
          ).filter((g) => isAnalysis(g));

          return (
            <>
              {/* S38: Direction-chip row + active-filter banner removed — both
                  replaced by the unified chip strip above (direction is now a
                  picker on the "+ Filter" button). The "VERIFIED" direction
                  value retained internally so the dedicated verifiedCalls track
                  record view can still be invoked from inside the Add-filter
                  sheet's Track-record option if we re-add that path later. */}

              {/* Subheader when viewing Market Analysis */}
              {showScope === "market-analysis" && selectedDirectionFilter !== "VERIFIED" && (
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, marginBottom: 4 }}>
                  <Text style={[financeStyles.sectionSubheader, { flex: 1, marginBottom: 0 }]}>
                    Notes from publications like J.P. Morgan, ET Money, Goldman Sachs
                  </Text>
                  <SectionHelp helpKey="finance-market-analysis" />
                </View>
              )}

              {/* Cards */}
              {selectedDirectionFilter === "VERIFIED" && showScope !== "market-analysis" ? (
                verifiedCalls.length === 0 ? (
                  <View style={financeStyles.expertEmptyCard}>
                    <Text style={financeStyles.expertEmptyTitle}>No verified calls yet</Text>
                    <Text style={financeStyles.expertEmptySubtitle}>
                      Calls are verified once their resolution window elapses. Check back soon.
                    </Text>
                  </View>
                ) : (
                  verifiedCalls.map((call) => {
                    const isHit = call.resolutionStatus === "RESOLVED_HIT";
                    const color = isHit ? "#16a34a" : "#dc2626";
                    const dirLabel = call.direction === "BULLISH" ? "↑ Bullish" : call.direction === "BEARISH" ? "↓ Bearish" : "→ Neutral";
                    const fmt = (iso: string | null) =>
                      iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null;
                    const articleDate = fmt(call.publishedAt);
                    const resolvedDate = fmt(call.resolvedAt);
                    return (
                      <Pressable
                        key={call.id}
                        style={financeStyles.verifiedCard}
                        onPress={() => router.push(`/finance/opinion/${call.id}` as Parameters<typeof router.push>[0])}
                      >
                        <View style={[financeStyles.verifiedBadge, { backgroundColor: color }]}>
                          <Text style={financeStyles.verifiedBadgeText}>{isHit ? "HIT ✓" : "MISS ✗"}</Text>
                        </View>
                        <View style={financeStyles.verifiedCardBody}>
                          <Text style={financeStyles.verifiedExpert} numberOfLines={1}>
                            {call.expertName} · {call.expertOrganization}
                          </Text>
                          {call.instrument ? (
                            <Text style={[financeStyles.verifiedInstrument, { color }]}>{dirLabel} on {call.instrument}</Text>
                          ) : null}
                          <Text style={financeStyles.verifiedQuote} numberOfLines={2}>{call.quote}</Text>
                          {call.resolutionNote ? (
                            <Text style={[financeStyles.verifiedNote, { color }]} numberOfLines={1}>{call.resolutionNote}</Text>
                          ) : null}
                          <Text style={financeStyles.verifiedDates}>
                            {articleDate ? `Called ${articleDate}` : ""}
                            {articleDate && resolvedDate ? "  ·  " : ""}
                            {resolvedDate ? `Resolved ${resolvedDate}` : ""}
                          </Text>
                          {call.storyHeadline ? (
                            <Text style={financeStyles.verifiedStory} numberOfLines={1}>{call.storyHeadline}</Text>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })
                )
              ) : (
                activeGroups.length === 0 ? (
                  <View style={financeStyles.expertEmptyCard}>
                    <Text style={financeStyles.expertEmptyTitle}>
                      {resolvedOnly
                        ? "No resolved calls match yet"
                        : verifiedOnly
                          ? "No verified analysts here yet"
                          : showScope === "market-analysis"
                            ? "No market analysis from publications yet"
                            : sortMode === "top-week"
                              ? "Nothing from the last 7 days yet"
                              : "No expert opinions yet"}
                    </Text>
                    {(verifiedOnly || resolvedOnly || sortMode !== "latest") && (
                      <Pressable
                        onPress={() => {
                          setSortMode("latest");
                          setVerifiedOnly(false);
                          setResolvedOnly(false);
                        }}
                        style={financeStyles.expertEmptyLink}
                      >
                        <Text style={financeStyles.expertEmptyLinkText}>
                          Reset filters →
                        </Text>
                      </Pressable>
                    )}
                  </View>
                ) : (
                  activeGroups.map(({ key, storyId, storyHeadline, articlePublishedAt, opinions }) => (
                    <ExpertOpinionCard
                      key={key}
                      opinions={opinions}
                      storyHeadline={storyHeadline}
                      storyId={storyId}
                      articlePublishedAt={articlePublishedAt}
                      followedExpertIds={followedExpertIds}
                      onFollowToggle={handleFollowToggle}
                    />
                  ))
                )
              )}
            </>
          );
        })()}

        {/* S28-T2: Loading more footer */}
        {loadingMore && (
          <View style={financeStyles.loadMoreFooter}>
            <ActivityIndicator size="small" color={colors.accent} />
          </View>
        )}

        {/* S28-T2: End of list footer */}
        {!hasMore && financeNews.length > 0 && !loadingMore && (
          <View style={financeStyles.noMoreFooter}>
            <Text style={financeStyles.noMoreText}>No more opinions</Text>
          </View>
        )}
        </>}
      </View>

      {/* Top Experts link at the bottom, after the infinite-scroll feed */}
      {leaderboardCount >= 3 && (
        <Pressable
          style={financeStyles.crossTabLink}
          onPress={() => router.push("/expert-leaderboard" as Parameters<typeof router.push>[0])}
        >
          <Text style={financeStyles.crossTabLinkText}>See Top Experts →</Text>
        </Pressable>
      )}
    </ScrollView>

    {/* S38: Sort action sheet — opened by the "Latest ▾" button */}
    <PulseSheet
      visible={sortSheetOpen}
      onClose={() => setSortSheetOpen(false)}
      title="Sort by"
    >
      {(
        [
          { key: "latest" as const, label: "Latest", desc: "Most recent calls first" },
          { key: "top-week" as const, label: "Top this week", desc: "Most engagement in last 7 days" },
        ]
      ).map((opt) => {
        const active = sortMode === opt.key;
        return (
          <Pressable
            key={opt.key}
            onPress={() => {
              setSortMode(opt.key);
              setSortSheetOpen(false);
            }}
            style={[controlsStyles.sheetRow, active && controlsStyles.sheetRowActive]}
          >
            <View>
              <Text style={[controlsStyles.sheetRowText, active && controlsStyles.sheetRowTextActive]}>
                {opt.label}
              </Text>
              <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{opt.desc}</Text>
            </View>
            {active ? <Text style={controlsStyles.sheetRowCheck}>✓</Text> : null}
          </Pressable>
        );
      })}
    </PulseSheet>

    {/* S38: Add-filter action sheet — pick a facet to filter by */}
    <PulseSheet
      visible={filterSheetOpen}
      onClose={() => setFilterSheetOpen(false)}
      title="Add a filter"
    >
      <Pressable
        style={[controlsStyles.sheetRow, resolvedOnly && controlsStyles.sheetRowActive]}
        onPress={() => {
          setResolvedOnly(!resolvedOnly);
          setFilterSheetOpen(false);
        }}
      >
        <Text style={[controlsStyles.sheetRowText, resolvedOnly && controlsStyles.sheetRowTextActive]}>
          🎯 Resolved only
        </Text>
        <Text style={{ fontSize: 12, color: colors.textSubtle }}>
          {resolvedOnly ? "On — tap to turn off" : "HIT/MISS calls only"}
        </Text>
      </Pressable>

      <Pressable
        style={[controlsStyles.sheetRow, verifiedOnly && controlsStyles.sheetRowActive]}
        onPress={() => {
          setVerifiedOnly(!verifiedOnly);
          setFilterSheetOpen(false);
        }}
      >
        <Text style={[controlsStyles.sheetRowText, verifiedOnly && controlsStyles.sheetRowTextActive]}>
          ✓ Verified analysts only
        </Text>
        <Text style={{ fontSize: 12, color: colors.textSubtle }}>
          {verifiedOnly ? "On — tap to turn off" : "Off"}
        </Text>
      </Pressable>

      <Pressable
        style={controlsStyles.sheetRow}
        onPress={() => {
          setFilterSheetOpen(false);
          setDirectionPickerOpen(true);
        }}
      >
        <Text style={controlsStyles.sheetRowText}>↑↓ Direction</Text>
        <Text style={{ fontSize: 12, color: colors.textSubtle }}>Bullish · Bearish · Neutral</Text>
      </Pressable>
      <Pressable
        style={controlsStyles.sheetRow}
        onPress={() => {
          setFilterSheetOpen(false);
          setInstrumentPickerOpen(true);
        }}
      >
        <Text style={controlsStyles.sheetRowText}>📊 Instrument</Text>
        <Text style={{ fontSize: 12, color: colors.textSubtle }}>Nifty · Bank Nifty · etc.</Text>
      </Pressable>
      <Pressable
        style={controlsStyles.sheetRow}
        onPress={() => {
          setFilterSheetOpen(false);
          setAnalystPickerOpen(true);
        }}
      >
        <Text style={controlsStyles.sheetRowText}>👤 Analyst</Text>
        <Text style={{ fontSize: 12, color: colors.textSubtle }}>Pick from followed</Text>
      </Pressable>
    </PulseSheet>

    {/* S38: Direction picker (action sheet) */}
    <PulseSheet
      visible={directionPickerOpen}
      onClose={() => setDirectionPickerOpen(false)}
      title="Filter by direction"
    >
      {(
        [
          { key: null, label: "All directions" },
          { key: "BULLISH" as const, label: "↑ Bullish" },
          { key: "BEARISH" as const, label: "↓ Bearish" },
          { key: "NEUTRAL" as const, label: "→ Neutral" },
        ]
      ).map((opt, i) => {
        const active = selectedDirectionFilter === opt.key;
        return (
          <Pressable
            key={i}
            onPress={() => {
              setSelectedDirectionFilter(opt.key);
              setDirectionPickerOpen(false);
            }}
            style={[controlsStyles.sheetRow, active && controlsStyles.sheetRowActive]}
          >
            <Text style={[controlsStyles.sheetRowText, active && controlsStyles.sheetRowTextActive]}>
              {opt.label}
            </Text>
            {active ? <Text style={controlsStyles.sheetRowCheck}>✓</Text> : null}
          </Pressable>
        );
      })}
    </PulseSheet>

    {/* S44-T3: Instrument picker — dynamic catalog with search (replaces hardcoded 5-option list) */}
    <PulseSheet
      visible={instrumentPickerOpen}
      onClose={() => {
        setInstrumentPickerOpen(false);
        setInstrumentSearch("");
      }}
      title="Filter by instrument"
    >
      {instrumentCatalogLoading ? (
        <View style={{ paddingVertical: spacing.lg, alignItems: "center" }}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      ) : (
        <>
          {/* Search input */}
          <TextInput
            value={instrumentSearch}
            onChangeText={setInstrumentSearch}
            placeholder="Search instruments..."
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              fontSize: 15,
              fontWeight: "500",
              color: colors.text,
              paddingHorizontal: spacing.md,
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              marginBottom: 4,
            }}
          />
          {/* Instrument list */}
          {(() => {
            const query = instrumentSearch.trim().toLowerCase();
            const displayItems = query.length === 0
              ? instrumentCatalog.filter((item) => item.isPopular)
              : instrumentCatalog.filter((item) =>
                  item.label.toLowerCase().includes(query)
                );

            if (displayItems.length === 0) {
              return (
                <View style={{ paddingVertical: spacing.lg, paddingHorizontal: spacing.md, alignItems: "center" }}>
                  <Text style={{ fontSize: 14, color: colors.textSubtle, textAlign: "center" }}>
                    No instruments match — try a broader term.
                  </Text>
                </View>
              );
            }

            return (
              <>
                {query.length === 0 && (
                  <Text style={{
                    fontSize: 11,
                    fontWeight: "700",
                    color: colors.textSubtle,
                    letterSpacing: 0.5,
                    textTransform: "uppercase",
                    paddingHorizontal: spacing.md,
                    paddingTop: 8,
                    paddingBottom: 4,
                  }}>
                    Popular
                  </Text>
                )}
                {displayItems.map((item) => {
                  const active = activeInstrumentFilter === item.label;
                  return (
                    <Pressable
                      key={item.label}
                      onPress={() => {
                        setActiveInstrumentFilter(active ? null : item.label);
                        setInstrumentPickerOpen(false);
                        setInstrumentSearch("");
                      }}
                      style={[controlsStyles.sheetRow, active && controlsStyles.sheetRowActive]}
                    >
                      <Text style={[controlsStyles.sheetRowText, active && controlsStyles.sheetRowTextActive]}>
                        {item.label}
                      </Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        {item.count > 0 && (
                          <Text style={{ fontSize: 12, color: colors.textSubtle }}>{item.count}</Text>
                        )}
                        {active ? <Text style={controlsStyles.sheetRowCheck}>✓</Text> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </>
            );
          })()}
        </>
      )}
    </PulseSheet>

    {/* S38: Analyst picker (action sheet, from followed list) */}
    <PulseSheet
      visible={analystPickerOpen}
      onClose={() => setAnalystPickerOpen(false)}
      title="Filter by analyst"
    >
      {followedExpertIds.length === 0 ? (
        <View style={{ padding: spacing.lg, alignItems: "center" }}>
          <Text style={{ fontSize: 13, color: colors.textMuted }}>
            Follow an analyst first by tapping their name on any opinion.
          </Text>
        </View>
      ) : (
        <>
          <Pressable
            onPress={() => {
              setSelectedAnalystFilter(null);
              setAnalystPickerOpen(false);
            }}
            style={[controlsStyles.sheetRow, !selectedAnalystFilter && controlsStyles.sheetRowActive]}
          >
            <Text style={[controlsStyles.sheetRowText, !selectedAnalystFilter && controlsStyles.sheetRowTextActive]}>
              All analysts
            </Text>
            {!selectedAnalystFilter && <Text style={controlsStyles.sheetRowCheck}>✓</Text>}
          </Pressable>
          {followedExpertIds.map((expertId) => {
            const name = expertNamesMap[expertId]?.name ?? "Analyst";
            const active = selectedAnalystFilter === expertId;
            return (
              <Pressable
                key={expertId}
                onPress={() => {
                  setSelectedAnalystFilter(expertId);
                  setAnalystPickerOpen(false);
                }}
                style={[controlsStyles.sheetRow, active && controlsStyles.sheetRowActive]}
              >
                <Text style={[controlsStyles.sheetRowText, active && controlsStyles.sheetRowTextActive]}>
                  {name}
                </Text>
                {active ? <Text style={controlsStyles.sheetRowCheck}>✓</Text> : null}
              </Pressable>
            );
          })}
        </>
      )}
    </PulseSheet>

    {/* ── Pulse bottom sheets — opened by tapping a PulseRibbon pill ───── */}
    <PulseSheet
      visible={pulseOpen === "events"}
      onClose={() => setPulseOpen(null)}
      title="🔥 Policy & Big Events"
    >
      <FlagshipEventsCarousel events={flagshipEvents} />
    </PulseSheet>

    {/* Sentiment sheet removed — data is now inline on the WeekToggleCard */}

    <PulseSheet
      visible={pulseOpen === "calendar"}
      onClose={() => setPulseOpen(null)}
      title="💼 Policy Calendar"
    >
      {data && data.eventClusters.length > 0 ? (
        data.eventClusters.map((cluster) => {
          const hasTakes = cluster.expertTakeCount > 0;
          const goToCluster = () => {
            setSelectedClusterFilter(cluster.id);
            setPulseOpen(null);
            setTimeout(
              () => scrollViewRef.current?.scrollTo({ y: expertSectionY.current, animated: true }),
              200
            );
          };
          return (
            // S38 fix: card itself is a non-tappable View. Only the explicit
            // "See expert takes" footer link triggers navigation, so reading the
            // data doesn't accidentally filter the feed.
            <View key={cluster.id} style={financeStyles.clusterSection}>
              {/* Header: emoji + name + date */}
              <View style={financeStyles.clusterHeader}>
                {cluster.bannerEmoji ? (
                  <Text style={financeStyles.clusterEmoji}>{cluster.bannerEmoji}</Text>
                ) : null}
                <View style={financeStyles.clusterHeaderText}>
                  <Text style={financeStyles.clusterName}>{cluster.name}</Text>
                  <Text style={financeStyles.clusterDateRange}>
                    {formatDateRange(cluster.startsAt, cluster.endsAt)}
                  </Text>
                </View>
              </View>

              {/* Description */}
              {cluster.description ? (
                <Text style={financeStyles.clusterDescription}>{cluster.description}</Text>
              ) : null}

              {/* Data points (key stats about the event) */}
              {cluster.dataPoints && cluster.dataPoints.length > 0 ? (
                <View style={financeStyles.clusterDataGrid}>
                  {cluster.dataPoints.map((dp, idx) => (
                    <View key={idx} style={financeStyles.clusterDataItem}>
                      <Text style={financeStyles.clusterDataLabel}>{dp.label}</Text>
                      <Text style={financeStyles.clusterDataValue}>{dp.value}</Text>
                      {dp.subtext ? (
                        <Text style={financeStyles.clusterDataSubtext}>{dp.subtext}</Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}

              {/* Footer — ONLY this is tappable (filters the feed) */}
              {hasTakes ? (
                <Pressable
                  style={financeStyles.clusterFooter}
                  onPress={goToCluster}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                  <Text style={financeStyles.expertTakesLink}>
                    {`→ See ${cluster.expertTakeCount} expert ${cluster.expertTakeCount === 1 ? "take" : "takes"} in the feed`}
                  </Text>
                </Pressable>
              ) : (
                <View style={financeStyles.clusterFooter}>
                  <Text style={financeStyles.expertTakesMuted}>
                    No expert takes yet — check back closer to the date
                  </Text>
                </View>
              )}
            </View>
          );
        })
      ) : (
        <View style={financeStyles.emptyState}>
          <Text style={financeStyles.emptyText}>No events on the calendar this week.</Text>
        </View>
      )}
    </PulseSheet>

    </>
  );
}

const makeFinanceStyles = (t: ThemeContextValue) => StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorText: { color: "#dc2626", textAlign: "center", padding: spacing.lg },
  retryBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: t.colors.accent,
  },
  retryBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  verifiedCard: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: t.colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  verifiedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    alignSelf: "flex-start",
    minWidth: 52,
    alignItems: "center",
  },
  verifiedBadgeText: { fontSize: 10, fontWeight: "800", color: "#fff" },
  verifiedCardBody: { flex: 1, gap: 2 },
  verifiedExpert: { fontSize: 12, fontWeight: "700", color: t.colors.text },
  verifiedInstrument: { fontSize: 11, fontWeight: "600" },
  verifiedQuote: { fontSize: 12, color: t.colors.textMuted, lineHeight: 16 },
  verifiedNote: { fontSize: 11, fontWeight: "600", fontStyle: "italic" as const },
  verifiedDates: { fontSize: 10, color: t.colors.textMuted, marginTop: 3 },
  verifiedStory: { fontSize: 11, color: t.colors.textMuted, marginTop: 2 },
  expertLinksRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingVertical: 6,
  },
  crossTabLink: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingVertical: 6,
    alignSelf: "flex-end",
  },
  crossTabLinkText: {
    fontSize: 12,
    fontWeight: "700",
    color: t.colors.accent,
  },
  heroHeader: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: t.colors.text,
    letterSpacing: -0.5,
    lineHeight: 32,
  },
  heroSubtitle: {
    fontSize: 13,
    color: t.colors.textMuted,
    marginTop: 4,
    fontWeight: "500",
  },
  heroNewsLink: {
    marginTop: 6,
    alignSelf: "flex-start",
  },
  heroNewsLinkText: {
    fontSize: 12,
    fontWeight: "700",
    color: t.colors.accent,
  },
  // Direction filter chips
  directionChipsScroll: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  directionChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: t.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  directionChipActive: {
    backgroundColor: t.colors.accent,
    borderColor: t.colors.accent,
  },
  directionChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: t.colors.textMuted,
  },
  directionChipTextActive: {
    color: "#fff",
    fontWeight: "700",
  },
  // Pagination footers
  loadMoreFooter: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  noMoreFooter: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  noMoreText: {
    fontSize: 12,
    color: t.colors.textMuted ?? "#6b7280",
    fontStyle: "italic",
  },
  emptyState: {
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  emptyText: { fontSize: 13, color: t.colors.textMuted ?? "#6b7280", fontStyle: "italic" },
  expertEmptyCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: t.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: t.colors.border,
    alignItems: "center",
  },
  expertEmptyIcon: { fontSize: 36, marginBottom: spacing.sm },
  expertEmptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: t.colors.text ?? "#111827",
    marginBottom: 6,
  },
  expertEmptySubtitle: {
    fontSize: 13,
    color: t.colors.textMuted ?? "#6b7280",
    textAlign: "center",
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  expertEmptyLink: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#C7D2FE",
  },
  expertEmptyLinkText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#4338CA",
  },
  clusterSection: {
    marginBottom: spacing.lg,
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surface,
    overflow: "hidden",
  },
  clusterHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: t.colors.surfaceMuted,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
  },
  clusterEmoji: { fontSize: 20 },
  clusterHeaderText: { flex: 1 },
  clusterName: { fontSize: 14, fontWeight: "800", color: t.colors.text ?? "#111827" },
  clusterDateRange: { fontSize: 11, color: t.colors.textMuted ?? "#6b7280", marginTop: 1 },
  clusterScroll: { paddingLeft: spacing.lg },
  // S38: new cluster sheet styles — description + data point grid
  clusterDescription: {
    fontSize: 12,
    color: t.colors.textMuted,
    lineHeight: 17,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  clusterDataGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 4,
    gap: 8,
  },
  clusterDataItem: {
    flexBasis: "47%",
    flexGrow: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: t.colors.surfaceMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  clusterDataLabel: {
    fontSize: 10,
    color: t.colors.textMuted,
    fontWeight: "700" as const,
    letterSpacing: 0.3,
    textTransform: "uppercase" as const,
  },
  clusterDataValue: {
    fontSize: 13,
    color: t.colors.text,
    fontWeight: "800" as const,
    marginTop: 1,
  },
  clusterDataSubtext: {
    fontSize: 10,
    color: t.colors.textSubtle,
    fontStyle: "italic" as const,
    marginTop: 2,
  },
  dataPanel: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs ?? 4,
  },
  dataPanelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: spacing.sm,
  },
  dataPanelRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.border,
  },
  dataPanelLabel: {
    fontSize: 12,
    color: t.colors.textMuted ?? "#6b7280",
    flex: 1,
    marginRight: spacing.sm,
  },
  dataPanelValueCol: {
    alignItems: "flex-end",
    flex: 1.2,
  },
  dataPanelValue: {
    fontSize: 13,
    fontWeight: "700",
    color: t.colors.text ?? "#111827",
    textAlign: "right",
  },
  dataPanelDate: {
    fontSize: 10,
    color: t.colors.textMuted ?? "#6b7280",
    marginTop: 2,
  },
  dataPanelSubtext: {
    fontSize: 10,
    color: t.colors.textMuted ?? "#6b7280",
    fontStyle: "italic",
    marginTop: 2,
  },
  clusterFooter: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.border,
    marginTop: spacing.xs ?? 4,
  },
  expertTakesLink: {
    fontSize: 12,
    fontWeight: "700",
    color: t.colors.accent,
  },
  expertTakesMuted: {
    fontSize: 12,
    color: t.colors.textMuted ?? "#6b7280",
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: "800",
    color: t.colors.text ?? "#111827",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionSubheader: {
    fontSize: 11,
    color: t.colors.textMuted ?? "#6b7280",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    marginTop: -2,
  },
  opinionToggle: {
    flexDirection: "row",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: 10,
    backgroundColor: t.colors.surfaceMuted,
    padding: 3,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: "center",
    borderRadius: 8,
  },
  toggleBtnActive: {
    backgroundColor: t.colors.surface,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  toggleBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: t.colors.textMuted ?? "#6b7280",
  },
  toggleBtnTextActive: {
    color: t.colors.text ?? "#111827",
    fontWeight: "700",
  },
  unclusteredSection: { marginTop: spacing.sm },
  filterBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#C7D2FE",
  },
  filterBannerText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#4338CA",
    flex: 1,
  },
  filterClearBtn: {
    fontSize: 12,
    fontWeight: "700",
    color: "#4338CA",
    marginLeft: spacing.sm,
  },
});

// ─── Flagship carousel styles ─────────────────────────────────────────────────
const makeFlagshipStyles = (t: ThemeContextValue) => StyleSheet.create({
  section: {
    marginBottom: spacing.lg,
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: "800",
    color: t.colors.text,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  createBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderWidth: 1,
    borderColor: "#fbbf24",
  },
  createBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#92400e",
  },
  emptyCard: {
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
    borderRadius: 12,
    backgroundColor: "rgba(245, 158, 11, 0.06)",
    borderWidth: 1,
    borderColor: "#fde68a",
    borderStyle: "dashed",
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#92400e",
    marginBottom: 4,
  },
  emptyHint: {
    fontSize: 12,
    color: "#92400e",
    opacity: 0.85,
    lineHeight: 17,
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    paddingRight: spacing.lg * 2,
  },
  card: {
    width: 280,
    backgroundColor: t.colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderLeftWidth: 4,
    padding: spacing.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 3,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  typeChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  typeChipText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  countdownBadge: {
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  countdownText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#92400E",
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: t.colors.text,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  probSection: {
    marginBottom: spacing.xs ?? 4,
  },
  crowdLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: t.colors.textMuted,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  barTrack: {
    flexDirection: "row",
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    gap: 2,
    marginBottom: 4,
  },
  barSegment: {
    borderRadius: 4,
  },
  barLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  barLabel: {
    fontSize: 11,
    fontWeight: "700",
  },
  barLabelsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  barLabelSmall: {
    fontSize: 10,
    fontWeight: "600",
  },
  noDataText: {
    fontSize: 11,
    color: t.colors.textSubtle,
    fontStyle: "italic",
    marginBottom: 4,
  },
  expertLine: {
    fontSize: 11,
    fontWeight: "600",
    color: "#4338CA",
    marginTop: spacing.xs ?? 4,
  },
  expertLineNull: {
    fontSize: 11,
    color: t.colors.textSubtle,
    fontStyle: "italic",
    marginTop: spacing.xs ?? 4,
  },
  cardFooter: {
    marginTop: spacing.sm,
    alignItems: "flex-end",
  },
  predictBtn: {
    fontSize: 13,
    fontWeight: "800",
  },
});
