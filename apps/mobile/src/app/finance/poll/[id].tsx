/**
 * Finance Flagship Poll detail screen.
 *
 * Dedicated route for flagship polls — kept entirely separate from /market/[id]
 * which serves regular betting markets. Polls are: free vote, no amount staked,
 * no reasoning input. The detail screen surfaces related expert opinions so
 * users can read what economists are saying and compare their stance.
 *
 * S61 additions:
 *  - T2: EMI impact line from structuredData shown under the Repo question.
 *  - T2: "You vs the crowd" consensus breakdown shown after the user votes.
 *  - T5: "Next: predict the stance" CTA after voting on the Repo question,
 *        when the screen was launched from an MPC pack card (sisterMarketId param).
 *
 * S62-T7 addition:
 *  - When the URL carries `source=poll-api`, the screen fetches via
 *    `getPoll(id)` and submits votes via `votePoll(id, optionId)`.
 *    The Market API path (getMarketById / placeMultiChoicePosition) is
 *    preserved unchanged for all non-RBI flagship polls.
 */

import { Feather, Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { mobileApi } from "@/lib/api";
import { useApiQuery } from "@/hooks/useApiQuery";
import { radius, spacing } from "@predict-future/ui-tokens";
import { formatRelativeTime } from "@predict-future/utils";
import type { ApiPollDetail } from "@predict-future/types";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";
import { SectionHelp } from "@/components/section-help";

type RelatedOpinion = {
  id: string;
  quote: string;
  direction: string;
  sourceUrl: string;
  publishedAt: string;
  instrument: string | null;
  expert: {
    id: string;
    name: string;
    organization: string;
    avatarUrl: string | null;
    verified: boolean;
  };
};

type UserPosition = { id: string; side: string | null; amount: number };
type UserMCPosition = { id?: string; optionId: string; amount: number };

type PollResponse = {
  market: {
    id: string;
    title: string;
    description?: string | null;
    /**
     * For RBI MPC markets: `{ emiImpactLine: string }`.
     * Typed as unknown values to match the API definition — we narrowly cast
     * to string when rendering.
     */
    structuredData?: Record<string, unknown> | null;
    marketType?: string;
    flagshipEventAt?: string | null;
    flagshipEventType?: string | null;
    options?: Array<{ id: string; label: string; sortOrder: number; totalStaked: number }>;
    totalParticipants?: number;
    closeAt?: string;
    status: string;
  };
  userPositions?: UserPosition[];
  userMultiChoicePositions?: UserMCPosition[];
  relatedExpertOpinions?: RelatedOpinion[];
};

function countdown(target: string): string {
  const ms = new Date(target).getTime() - Date.now();
  if (ms < 0) return "Closed";
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 2) return `in ${days} days`;
  if (days === 1) return "Tomorrow";
  const hours = Math.floor(ms / (60 * 60 * 1000));
  return hours > 0 ? `in ${hours}h` : "Today";
}

// ─── Adapter: normalise ApiPollDetail into the PollResponse shape ────────────

function pollDetailToResponse(poll: ApiPollDetail): PollResponse {
  return {
    market: {
      id: poll.id,
      title: poll.question,
      description: poll.description,
      structuredData: poll.structuredData as Record<string, unknown> | null,
      // Poll API polls are always MULTIPLE_CHOICE (options-based).
      marketType: "MULTIPLE_CHOICE",
      flagshipEventAt: poll.eventAt,
      // Poll API does not carry a flagshipEventType — use a safe default.
      flagshipEventType: "RBI",
      // Map ApiPollOption.voteCount → totalStaked for the existing VoteConsensus renderer.
      options: poll.options.map((o) => ({
        id: o.id,
        label: o.label,
        sortOrder: o.sortOrder,
        totalStaked: o.voteCount,
      })),
      totalParticipants: poll.totalVotes,
      closeAt: poll.closeAt,
      status: poll.status === "OPEN" ? "OPEN" : poll.status === "RESOLVED" ? "RESOLVED" : "CLOSED",
    },
    // Translate userVote into the userMultiChoicePositions shape the rest of
    // the screen already knows how to read.
    userMultiChoicePositions: poll.userVote
      ? [{ optionId: poll.userVote.optionId, amount: 0 }]
      : [],
    relatedExpertOpinions: [],
  };
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.xl },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  backBtn: { padding: 4 },
  topBarTitle: { fontSize: 16, fontWeight: "700", color: t.colors.text },
  errorText: { color: t.colors.textMuted, marginBottom: spacing.md, textAlign: "center" },
  retryBtn: { backgroundColor: t.colors.accent, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 8 },
  retryBtnText: { color: "#fff", fontWeight: "700" },

  headerCard: {
    backgroundColor: "rgba(245, 158, 11, 0.08)",
    borderLeftWidth: 4,
    borderLeftColor: "#f59e0b",
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
  },
  headerMeta: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  typeChip: { backgroundColor: "#f59e0b", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  typeChipText: { color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  cdChip: { backgroundColor: "rgba(146, 64, 14, 0.15)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  cdChipText: { color: "#92400e", fontSize: 11, fontWeight: "700" },
  cdChipClosed: { backgroundColor: "rgba(107, 114, 128, 0.15)" },
  cdChipTextClosed: { color: "#6b7280" },
  title: { fontSize: 20, fontWeight: "800", color: t.colors.text, lineHeight: 26 },
  description: { fontSize: 14, color: t.colors.textMuted, marginTop: 8, lineHeight: 20 },
  metaLine: { fontSize: 12, color: t.colors.textMuted, marginTop: 12, fontWeight: "600" },

  // S61-T2: EMI impact box on header card
  emiBox: {
    marginTop: 12,
    backgroundColor: "rgba(220, 38, 38, 0.06)",
    borderLeftWidth: 3,
    borderLeftColor: "#DC2626",
    borderRadius: 6,
    padding: 10,
  },
  emiLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: "#991B1B",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  emiText: {
    fontSize: 13,
    color: t.colors.text,
    lineHeight: 18,
  },

  // S61-T5: Sister-market CTA card
  sisterCta: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    backgroundColor: t.colors.surfaceMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    padding: spacing.md,
  },
  sisterCtaInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sisterCtaLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: "#1D4ED8",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  sisterCtaTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#1E3A8A",
  },
  sisterCtaSub: {
    fontSize: 12,
    color: "#3B82F6",
    marginTop: 2,
    lineHeight: 17,
  },
  sisterCtaArrow: {
    fontSize: 28,
    color: "#3B82F6",
    fontWeight: "600",
    lineHeight: 32,
  },

  card: {
    backgroundColor: t.colors.surface,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
  },
  sectionLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5, color: t.colors.textMuted, textTransform: "uppercase", marginBottom: 8 },
  helperLine: { fontSize: 12, color: t.colors.textMuted, marginBottom: 12, lineHeight: 17 },
  consensusEmpty: { fontSize: 13, color: t.colors.textMuted, fontStyle: "italic" },

  // S61-T2: You vs the crowd note
  youVsCrowdNote: {
    fontSize: 12,
    color: "#4338CA",
    marginBottom: 10,
    fontStyle: "italic",
    lineHeight: 17,
  },
  participantNote: {
    fontSize: 11,
    color: t.colors.textMuted,
    marginTop: 8,
  },

  mcRow: { marginBottom: spacing.sm },
  mcRowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  mcLabel: { fontSize: 13, color: t.colors.text, flex: 1, marginRight: 4 },
  mcLabelMine: { fontWeight: "700", color: "#92400e" },
  mcPct: { fontSize: 13, fontWeight: "700", color: t.colors.text, minWidth: 36, textAlign: "right" },
  mcPctMine: { color: "#92400e" },
  mcBar: { height: 6, backgroundColor: t.colors.surfaceMuted, borderRadius: 3, overflow: "hidden" },
  mcBarFill: { height: "100%", backgroundColor: t.colors.accent, borderRadius: 3 },
  mcBarFillMine: { backgroundColor: "#f59e0b" },
  mcBarFillCrowd: { backgroundColor: "#6366F1" },

  // Your pick + crowd fave inline badges
  yourPickBadge: {
    backgroundColor: "#FEF3C7",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  yourPickBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#92400e",
    letterSpacing: 0.2,
  },
  crowdFaveBadge: {
    backgroundColor: "#EEF2FF",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  crowdFaveBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#4338CA",
    letterSpacing: 0.2,
  },

  sideTag: { alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  sideTagYes: { backgroundColor: "#dcfce7" },
  sideTagNo: { backgroundColor: "#fee2e2" },
  sideTagText: { fontSize: 13, fontWeight: "800", letterSpacing: 0.5, color: t.colors.text },

  opinionRow: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: t.colors.border },
  opinionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  opinionExpert: { fontSize: 14, fontWeight: "700", color: t.colors.text, flex: 1, marginRight: 8 },
  opinionOrg: { fontSize: 11, color: t.colors.textMuted, marginTop: 2 },
  opinionQuote: { fontSize: 13, color: t.colors.text, fontStyle: "italic", marginTop: 6, lineHeight: 18 },
  opinionMeta: { fontSize: 11, color: t.colors.textMuted, marginTop: 6 },
  directionPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4 },
  directionText: { fontSize: 10, fontWeight: "800", color: "#fff", letterSpacing: 0.5 },
  dirBullish: { backgroundColor: "#16a34a" },
  dirBearish: { backgroundColor: "#dc2626" },
  dirNeutral: { backgroundColor: "#6b7280" },

  stickyBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: t.colors.surface, borderTopWidth: 1, borderTopColor: t.colors.border,
    paddingHorizontal: spacing.md, paddingTop: 10,
  },
  voteBtn: { backgroundColor: t.colors.accent, paddingVertical: 14, borderRadius: radius.md, alignItems: "center" },
  voteBtnText: { color: "#fff", fontSize: 16, fontWeight: "800", letterSpacing: 0.3 },
  votedBadge: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, backgroundColor: "rgba(34, 197, 94, 0.1)", borderRadius: radius.md },
  votedBadgeText: { color: t.colors.accent, fontSize: 14, fontWeight: "700" },

  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: t.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.lg },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.colors.border, alignSelf: "center", marginBottom: spacing.md },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: t.colors.text },
  sheetClose: { color: t.colors.accent, fontSize: 14, fontWeight: "600" },
  sheetSub: { fontSize: 13, color: t.colors.textMuted, marginBottom: spacing.md },

  // S61-T2: EMI line inside the vote sheet
  sheetEmiBox: {
    backgroundColor: "rgba(220, 38, 38, 0.06)",
    borderLeftWidth: 3,
    borderLeftColor: "#DC2626",
    borderRadius: 6,
    padding: 10,
    marginBottom: spacing.md,
  },
  sheetEmiText: {
    fontSize: 12,
    color: t.colors.text,
    lineHeight: 17,
  },

  sideRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  sideBtn: { flex: 1, paddingVertical: 18, borderRadius: radius.md, alignItems: "center", borderWidth: 1 },
  sideYes: { backgroundColor: "#f0fdf4", borderColor: "#86efac" },
  sideYesActive: { backgroundColor: "#16a34a", borderColor: "#16a34a" },
  sideNo: { backgroundColor: "#fef2f2", borderColor: "#fca5a5" },
  sideNoActive: { backgroundColor: "#dc2626", borderColor: "#dc2626" },
  sideBtnText: { fontSize: 18, fontWeight: "800", color: t.colors.text },
  mcChoice: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 14, borderRadius: radius.md, marginBottom: 8, borderWidth: 1, borderColor: t.colors.border },
  mcChoiceSelected: { backgroundColor: "rgba(245, 158, 11, 0.08)", borderColor: "#f59e0b" },
  mcChoiceText: { fontSize: 14, color: t.colors.text, flex: 1 },
  mcChoiceTextSelected: { fontWeight: "700" },
  submitBtn: { backgroundColor: t.colors.accent, paddingVertical: 14, borderRadius: radius.md, alignItems: "center", marginTop: 8 },
  submitBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  disclaimer: { fontSize: 11, color: t.colors.textMuted, textAlign: "center", marginTop: 8, lineHeight: 16 },
  errorLine: { color: "#dc2626", fontSize: 12, marginBottom: 8 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PollDetailScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const {
    id,
    // Legacy Market-path params (non-RBI flagship polls)
    packClusterId,
    sisterMarketId,
    // Poll-API params (S62-T7: RBI MPC polls)
    source,
    packId,
    sisterPollId,
    preselect,
  } = useLocalSearchParams<{
    id: string;
    packClusterId?: string;
    sisterMarketId?: string;
    source?: string;
    packId?: string;
    sisterPollId?: string;
    preselect?: string;
  }>();

  const pollId = typeof id === "string" ? id : "";
  // When source=poll-api the screen uses getPoll/votePoll; otherwise the
  // existing Market API path (getMarketById/placeMultiChoicePosition) is used.
  const isPollApi = source === "poll-api";

  const insets = useSafeAreaInsets();
  const [voteSheetOpen, setVoteSheetOpen] = useState(false);

  // Track whether the user just voted in this session (used for sister CTA).
  const [justVoted, setJustVoted] = useState(false);

  // ── Market API path (non-RBI flagship polls, unchanged) ──────────────────
  const marketFetcher = useCallback(
    () => mobileApi.getMarketById(pollId),
    [pollId]
  );
  const marketQuery = useApiQuery<PollResponse>(marketFetcher, [pollId], {
    enabled: Boolean(pollId) && !isPollApi,
  });

  // ── Poll API path (S62-T7 — RBI MPC polls) ───────────────────────────────
  const pollApiFetcher = useCallback(
    () => mobileApi.getPoll(pollId).then(({ poll }) => pollDetailToResponse(poll)),
    [pollId]
  );
  const pollApiQuery = useApiQuery<PollResponse>(pollApiFetcher, [pollId], {
    enabled: Boolean(pollId) && isPollApi,
  });

  // Unified view over whichever query is active
  const { data, status, error, refetch } = isPollApi ? pollApiQuery : marketQuery;

  if (!pollId || status === "loading") {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Poll" }} />
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (status === "error" || !data) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Poll" }} />
        <Text style={styles.errorText}>{error ?? "Couldn't load poll."}</Text>
        <Pressable onPress={refetch} style={styles.retryBtn}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const market = data.market;
  const isMultiChoice = market.marketType === "MULTIPLE_CHOICE";
  const binaryPositions = data.userPositions ?? [];
  const mcPositions = data.userMultiChoicePositions ?? [];
  const hasVoted = isMultiChoice ? mcPositions.length > 0 : binaryPositions.length > 0;
  const userSide = binaryPositions[0]?.side ?? null;
  const userOptionId = mcPositions[0]?.optionId ?? null;
  const opinions = data.relatedExpertOpinions ?? [];

  const cd = market.flagshipEventAt ? countdown(market.flagshipEventAt) : null;
  const isClosed = cd === "Closed" || market.status !== "OPEN";

  // S61-T2: Extract EMI impact line from structuredData if present.
  const emiImpactLine =
    market.structuredData &&
    typeof market.structuredData["emiImpactLine"] === "string"
      ? (market.structuredData["emiImpactLine"] as string)
      : null;

  // Sister-market CTA — supports both the legacy Market path (sisterMarketId)
  // and the new Poll API path (sisterPollId). The CTA is shown after voting.
  const effectiveSisterId = isPollApi
    ? (typeof sisterPollId === "string" ? sisterPollId : "")
    : (typeof sisterMarketId === "string" ? sisterMarketId : "");
  const hasSisterCta = justVoted && effectiveSisterId.length > 0;

  const goToSister = () => {
    if (!effectiveSisterId) return;
    if (isPollApi) {
      const effectivePackId = typeof packId === "string" ? packId : "";
      router.push(
        `/finance/poll/${effectiveSisterId}?source=poll-api&packId=${effectivePackId}&sisterPollId=${pollId}` as Parameters<typeof router.push>[0]
      );
    } else {
      router.push(
        `/finance/poll/${effectiveSisterId}?packClusterId=${packClusterId ?? ""}&sisterMarketId=${pollId}` as Parameters<typeof router.push>[0]
      );
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Stack.Screen
        options={{
          title: "Poll",
          headerShown: false,
        }}
      />

      {/* Custom back header */}
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.topBarTitle}>Policy Poll</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.accent} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header card */}
        <View style={styles.headerCard}>
          <View style={styles.headerMeta}>
            {market.flagshipEventType ? (
              <View style={styles.typeChip}>
                <Text style={styles.typeChipText}>{market.flagshipEventType}</Text>
              </View>
            ) : null}
            {cd ? (
              <View style={[styles.cdChip, isClosed && styles.cdChipClosed]}>
                <Text style={[styles.cdChipText, isClosed && styles.cdChipTextClosed]}>{cd}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.title}>{market.title}</Text>
          {market.description ? (
            <Text style={styles.description}>{market.description}</Text>
          ) : null}

          {/* S61-T2: EMI impact line — only shown for Repo rate markets */}
          {emiImpactLine ? (
            <View style={styles.emiBox}>
              <Text style={styles.emiLabel}>What this means for your EMI</Text>
              <Text style={styles.emiText}>{emiImpactLine}</Text>
            </View>
          ) : null}

          <Text style={styles.metaLine}>
            {(market.totalParticipants ?? 0).toLocaleString()} {market.totalParticipants === 1 ? "vote" : "votes"}
          </Text>
        </View>

        {/* S61-T5: "Next: predict the stance" nudge — shown right after voting */}
        {hasSisterCta && (
          <SisterMarketCta onPress={goToSister} />
        )}

        {/* Vote summary / consensus — always visible (T4: ungate from hasVoted) */}
        <VoteConsensus
          market={market}
          isMultiChoice={isMultiChoice}
          userSide={userSide}
          userOptionId={userOptionId}
          hasVoted={hasVoted}
        />

        {/* Related expert opinions */}
        <ExpertOpinionsSection opinions={opinions} />
      </ScrollView>

      {/* Sticky vote bar */}
      {!isClosed ? (
        <View style={[styles.stickyBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {hasVoted ? (
            <View style={styles.votedBadge}>
              <Feather name="check-circle" size={16} color={colors.accent} />
              <Text style={styles.votedBadgeText}>
                You predicted{userSide ? ` ${userSide}` : userOptionId ? ` "${market.options?.find((o) => o.id === userOptionId)?.label}"` : ""}
              </Text>
            </View>
          ) : (
            <Pressable style={styles.voteBtn} onPress={() => setVoteSheetOpen(true)}>
              <Text style={styles.voteBtnText}>Predict — it&apos;s free</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {/* Vote sheet — pass hasVoted so submit() guards against double-voting */}
      <PollVoteSheet
        visible={voteSheetOpen}
        onClose={() => setVoteSheetOpen(false)}
        pollId={pollId}
        isPollApi={isPollApi}
        market={market}
        isMultiChoice={isMultiChoice}
        hasVoted={hasVoted}
        preselectOptionId={typeof preselect === "string" ? preselect : null}
        onSuccess={() => {
          setVoteSheetOpen(false);
          setJustVoted(true);
          refetch();
        }}
      />
    </View>
  );
}

// ─── Sister-market CTA (S61-T5) ──────────────────────────────────────────────

function SisterMarketCta({ onPress }: { onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      style={({ pressed }) => [styles.sisterCta, pressed && { opacity: 0.8 }]}
      onPress={onPress}
    >
      <View style={styles.sisterCtaInner}>
        <View>
          <Text style={styles.sisterCtaLabel}>Next prediction</Text>
          <Text style={styles.sisterCtaTitle}>Predict the stance decision</Text>
          <Text style={styles.sisterCtaSub}>
            Complete both questions for a full MPC prediction
          </Text>
        </View>
        <Text style={styles.sisterCtaArrow}>›</Text>
      </View>
    </Pressable>
  );
}

// ─── Vote Consensus (S61-T2: You vs the crowd) ───────────────────────────────

/**
 * VoteConsensus — T4: always visible (no longer gated behind hasVoted).
 *
 * Shows each option as: [label (80px) | proportional fill bar | pct (32px)].
 * When totalVotes===0, bars are empty and the voter-count line is hidden.
 * When the user has voted, their option is highlighted amber; crowd fave is indigo.
 */
function VoteConsensus({
  market,
  isMultiChoice,
  userSide,
  userOptionId,
  hasVoted,
}: {
  market: PollResponse["market"];
  isMultiChoice: boolean;
  userSide: string | null;
  userOptionId: string | null;
  hasVoted: boolean;
}) {
  const styles = useThemedStyles(makeStyles);

  if (isMultiChoice) {
    const options = market.options ?? [];
    // Use totalStaked as vote count (each free poll vote counts as 1 stake).
    const total = options.reduce((sum, o) => sum + o.totalStaked, 0);

    // Find the crowd favourite (option with highest share).
    const crowdLeaderId = options.reduce<string | null>(
      (best, o) => {
        if (!best) return o.id;
        const bestOpt = options.find((x) => x.id === best);
        return (o.totalStaked ?? 0) > (bestOpt?.totalStaked ?? 0) ? o.id : best;
      },
      null
    );

    const sectionTitle = hasVoted ? "You vs the crowd" : "Live consensus";

    const isYouVsCrowd =
      hasVoted &&
      userOptionId !== null &&
      crowdLeaderId !== null &&
      userOptionId !== crowdLeaderId;

    return (
      <View style={styles.card}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <Text style={[styles.sectionLabel, { marginBottom: 0 }]}>{sectionTitle}</Text>
          <SectionHelp helpKey={hasVoted ? "poll-you-vs-crowd" : "poll-live-consensus"} />
        </View>
        {isYouVsCrowd && (
          <Text style={styles.youVsCrowdNote}>
            You picked differently from the crowd — that&apos;s what makes it interesting.
          </Text>
        )}

        {options.map((opt) => {
          const fillPct = total > 0 ? (opt.totalStaked / total) * 100 : 0;
          const displayPct = Math.round(fillPct);
          const mine = hasVoted && opt.id === userOptionId;
          const isCrowdFave = opt.id === crowdLeaderId && total > 0;
          return (
            <View key={opt.id} style={styles.mcRow}>
              <View style={styles.mcRowHeader}>
                <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, marginRight: 8 }}>
                  <Text style={[styles.mcLabel, mine && styles.mcLabelMine]} numberOfLines={2}>
                    {opt.label}
                  </Text>
                  {mine && (
                    <View style={styles.yourPickBadge}>
                      <Text style={styles.yourPickBadgeText}>Your pick</Text>
                    </View>
                  )}
                  {isCrowdFave && !mine && hasVoted && (
                    <View style={styles.crowdFaveBadge}>
                      <Text style={styles.crowdFaveBadgeText}>Crowd</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.mcPct, mine && styles.mcPctMine]}>{displayPct}%</Text>
              </View>
              <View style={styles.mcBar}>
                <View
                  style={[
                    styles.mcBarFill,
                    mine && styles.mcBarFillMine,
                    isCrowdFave && !mine && styles.mcBarFillCrowd,
                    { width: `${fillPct}%` as `${number}%` },
                  ]}
                />
              </View>
            </View>
          );
        })}

        {total > 0 && (
          <Text style={styles.participantNote}>
            {total.toLocaleString("en-IN")} {total === 1 ? "prediction" : "predictions"}
          </Text>
        )}
      </View>
    );
  }

  // Binary — use same layout.
  const yesPct = 0.5; // placeholder until API returns raw counts for binary markets
  return (
    <View style={styles.card}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <Text style={[styles.sectionLabel, { marginBottom: 0 }]}>{hasVoted ? "You vs the crowd" : "Live consensus"}</Text>
        <SectionHelp helpKey={hasVoted ? "poll-you-vs-crowd" : "poll-live-consensus"} />
      </View>
      {hasVoted && userSide && (
        <View style={[styles.sideTag, userSide === "YES" ? styles.sideTagYes : styles.sideTagNo]}>
          <Text style={styles.sideTagText}>You predicted: {userSide}</Text>
        </View>
      )}
      <Text style={[styles.consensusEmpty, { marginTop: spacing.sm }]}>
        Consensus updates as more votes come in. {Math.round(yesPct * 100)}% YES so far.
      </Text>
    </View>
  );
}

// ─── Related expert opinions ─────────────────────────────────────────────────

function ExpertOpinionsSection({ opinions }: { opinions: RelatedOpinion[] }) {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);

  if (opinions.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>What economists are saying</Text>
        <Text style={styles.consensusEmpty}>No expert opinions yet on this event.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.sectionLabel}>What economists are saying</Text>
      <Text style={styles.helperLine}>
        Read curated analyst calls on this event. Compare your prediction to the expert view.
      </Text>
      {opinions.map((op) => (
        <Pressable
          key={op.id}
          style={styles.opinionRow}
          // Tap opens the in-app opinion detail screen (full quote + agree/
          // disagree poll). The "Read source article" link inside that screen
          // is the only place we hand off to the external publisher URL.
          onPress={() =>
            router.push(`/finance/opinion/${op.id}` as Parameters<typeof router.push>[0])
          }
        >
          <View style={styles.opinionHeader}>
            <Text style={styles.opinionExpert} numberOfLines={1}>
              {op.expert.name}{op.expert.verified ? " ✓" : ""}
            </Text>
            <View
              style={[
                styles.directionPill,
                op.direction === "BULLISH" ? styles.dirBullish : op.direction === "BEARISH" ? styles.dirBearish : styles.dirNeutral,
              ]}
            >
              <Text style={styles.directionText}>{op.direction}</Text>
            </View>
          </View>
          <Text style={styles.opinionOrg}>{op.expert.organization}</Text>
          <Text style={styles.opinionQuote}>&quot;{op.quote}&quot;</Text>
          <Text style={styles.opinionMeta}>{formatRelativeTime(op.publishedAt)} · tap to read full opinion →</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ─── Vote Sheet ──────────────────────────────────────────────────────────────

function PollVoteSheet({
  visible,
  onClose,
  pollId,
  isPollApi,
  market,
  isMultiChoice,
  hasVoted,
  preselectOptionId,
  onSuccess,
}: {
  visible: boolean;
  onClose: () => void;
  /** The poll/market id being voted on. */
  pollId: string;
  /**
   * When true, votes are submitted via `votePoll(pollId, optionId)`.
   * When false, the legacy Market API path is used (placeMultiChoicePosition /
   * placePosition).
   */
  isPollApi: boolean;
  market: PollResponse["market"];
  isMultiChoice: boolean;
  /** T3: if true, submit() is a hard no-op — prevents re-voting after lock. */
  hasVoted: boolean;
  preselectOptionId: string | null;
  onSuccess: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [selectedSide, setSelectedSide] = useState<"YES" | "NO" | null>(null);
  // Honour the preselect param from MpcPollPackCard option chip tap.
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(preselectOptionId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extract EMI impact line to show inside the vote sheet as well.
  const emiImpactLine =
    market.structuredData &&
    typeof market.structuredData["emiImpactLine"] === "string"
      ? (market.structuredData["emiImpactLine"] as string)
      : null;

  async function submit() {
    // T3 hard lock: if the user has already voted, silently no-op.
    if (hasVoted) {
      onClose();
      return;
    }
    if (submitting) return;
    if (isMultiChoice && !selectedOptionId) {
      setError("Pick an option to predict.");
      return;
    }
    if (!isMultiChoice && !selectedSide) {
      setError("Pick YES or NO.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (isPollApi) {
        // S62-T7: RBI MPC polls — use the Poll API's free-vote endpoint.
        if (!selectedOptionId) {
          setError("Pick an option to predict.");
          return;
        }
        await mobileApi.votePoll(pollId, selectedOptionId);
      } else if (isMultiChoice && selectedOptionId) {
        // Legacy Market API path (non-RBI flagship polls).
        await mobileApi.placeMultiChoicePosition(pollId, { optionId: selectedOptionId, amount: 0 });
      } else if (selectedSide) {
        await mobileApi.placePosition(pollId, { side: selectedSide, amount: 0 });
      }
      Alert.alert(
        "Prediction locked in",
        "Nice! Check the crowd consensus below and see what economists are saying."
      );
      onSuccess();
      setSelectedSide(null);
      setSelectedOptionId(preselectOptionId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to record prediction.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Your prediction</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <SectionHelp helpKey="poll-vote-sheet" />
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.sheetClose}>Cancel</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.sheetSub} numberOfLines={3}>{market.title}</Text>

        {/* S61-T2: EMI impact nudge inside the vote sheet */}
        {emiImpactLine ? (
          <View style={styles.sheetEmiBox}>
            <Text style={styles.sheetEmiText}>{emiImpactLine}</Text>
          </View>
        ) : null}

        {isMultiChoice ? (
          <ScrollView style={{ maxHeight: 280 }}>
            {(market.options ?? []).map((opt) => {
              const sel = selectedOptionId === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  style={[styles.mcChoice, sel && styles.mcChoiceSelected]}
                  onPress={() => { setSelectedOptionId(opt.id); setError(null); }}
                >
                  <Text style={[styles.mcChoiceText, sel && styles.mcChoiceTextSelected]}>{opt.label}</Text>
                  {sel ? <Feather name="check" size={18} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        ) : (
          <View style={styles.sideRow}>
            <Pressable
              style={[styles.sideBtn, styles.sideYes, selectedSide === "YES" && styles.sideYesActive]}
              onPress={() => { setSelectedSide("YES"); setError(null); }}
            >
              <Text style={[styles.sideBtnText, selectedSide === "YES" && { color: "#fff" }]}>YES</Text>
            </Pressable>
            <Pressable
              style={[styles.sideBtn, styles.sideNo, selectedSide === "NO" && styles.sideNoActive]}
              onPress={() => { setSelectedSide("NO"); setError(null); }}
            >
              <Text style={[styles.sideBtnText, selectedSide === "NO" && { color: "#fff" }]}>NO</Text>
            </Pressable>
          </View>
        )}

        {error ? <Text style={styles.errorLine}>{error}</Text> : null}

        <Pressable style={[styles.submitBtn, submitting && { opacity: 0.6 }]} onPress={submit} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Lock in prediction</Text>}
        </Pressable>
        <Text style={styles.disclaimer}>Predictions are free. One prediction per market — final once submitted.</Text>
      </View>
    </Modal>
  );
}
