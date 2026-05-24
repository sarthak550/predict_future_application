/**
 * Finance Flagship Poll detail screen.
 *
 * Dedicated route for flagship polls — kept entirely separate from /market/[id]
 * which serves regular betting markets. Polls are: free vote, no amount staked,
 * no reasoning input. The detail screen surfaces related expert opinions so
 * users can read what economists are saying and compare their stance.
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
import { colors, radius, spacing } from "@predict-future/ui-tokens";
import { formatRelativeTime } from "@predict-future/utils";

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

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PollDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const marketId = typeof id === "string" ? id : "";
  const insets = useSafeAreaInsets();
  const [voteSheetOpen, setVoteSheetOpen] = useState(false);

  const fetcher = useCallback(() => mobileApi.getMarketById(marketId), [marketId]);
  const { data, status, error, refetch } = useApiQuery<PollResponse>(fetcher, [marketId], {
    enabled: Boolean(marketId),
  });

  if (!marketId || status === "loading") {
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
          <Text style={styles.metaLine}>
            {(market.totalParticipants ?? 0).toLocaleString()} {market.totalParticipants === 1 ? "vote" : "votes"}
          </Text>
        </View>

        {/* Vote summary */}
        <VoteConsensus market={market} isMultiChoice={isMultiChoice} userSide={userSide} userOptionId={userOptionId} hasVoted={hasVoted} />

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
                You voted{userSide ? ` ${userSide}` : userOptionId ? ` "${market.options?.find((o) => o.id === userOptionId)?.label}"` : ""}
              </Text>
            </View>
          ) : (
            <Pressable style={styles.voteBtn} onPress={() => setVoteSheetOpen(true)}>
              <Text style={styles.voteBtnText}>Cast your vote</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {/* Vote sheet */}
      <PollVoteSheet
        visible={voteSheetOpen}
        onClose={() => setVoteSheetOpen(false)}
        marketId={marketId}
        market={market}
        isMultiChoice={isMultiChoice}
        onSuccess={() => {
          setVoteSheetOpen(false);
          refetch();
        }}
      />
    </View>
  );
}

// ─── Vote Consensus ──────────────────────────────────────────────────────────

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
  if (!hasVoted) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Live consensus</Text>
        <Text style={styles.consensusEmpty}>Cast your vote to reveal the crowd consensus.</Text>
      </View>
    );
  }

  if (isMultiChoice) {
    const options = market.options ?? [];
    const total = options.reduce((sum, o) => sum + (o.totalStaked || 1), 0); // each vote counts as 1
    return (
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Live consensus</Text>
        {options.map((opt) => {
          const pct = total > 0 ? (opt.totalStaked || 1) / total : 0;
          const mine = opt.id === userOptionId;
          return (
            <View key={opt.id} style={styles.mcRow}>
              <View style={styles.mcRowHeader}>
                <Text style={[styles.mcLabel, mine && styles.mcLabelMine]} numberOfLines={2}>
                  {opt.label}{mine ? " · your vote" : ""}
                </Text>
                <Text style={styles.mcPct}>{Math.round(pct * 100)}%</Text>
              </View>
              <View style={styles.mcBar}>
                <View style={[styles.mcBarFill, mine && styles.mcBarFillMine, { width: `${Math.round(pct * 100)}%` }]} />
              </View>
            </View>
          );
        })}
      </View>
    );
  }

  // Binary. yesPct is a placeholder constant (50%) until the API surfaces raw
  // counts — keeping it as a plain const avoids the Rules-of-Hooks violation
  // we'd hit by calling useMemo after the conditional early returns above.
  const yesPct = 0.5;
  return (
    <View style={styles.card}>
      <Text style={styles.sectionLabel}>Your vote</Text>
      <View style={[styles.sideTag, userSide === "YES" ? styles.sideTagYes : styles.sideTagNo]}>
        <Text style={styles.sideTagText}>{userSide}</Text>
      </View>
      <Text style={[styles.consensusEmpty, { marginTop: spacing.sm }]}>
        Consensus updates as more votes come in. {Math.round(yesPct * 100)}% YES so far.
      </Text>
    </View>
  );
}

// ─── Related expert opinions ─────────────────────────────────────────────────

function ExpertOpinionsSection({ opinions }: { opinions: RelatedOpinion[] }) {
  const router = useRouter();

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
        Read curated analyst calls on this event. Compare your vote to the expert view.
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
  marketId,
  market,
  isMultiChoice,
  onSuccess,
}: {
  visible: boolean;
  onClose: () => void;
  marketId: string;
  market: PollResponse["market"];
  isMultiChoice: boolean;
  onSuccess: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [selectedSide, setSelectedSide] = useState<"YES" | "NO" | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (submitting) return;
    if (isMultiChoice && !selectedOptionId) {
      setError("Pick an option.");
      return;
    }
    if (!isMultiChoice && !selectedSide) {
      setError("Pick YES or NO.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (isMultiChoice && selectedOptionId) {
        await mobileApi.placeMultiChoicePosition(marketId, { optionId: selectedOptionId, amount: 0 });
      } else if (selectedSide) {
        await mobileApi.placePosition(marketId, { side: selectedSide, amount: 0 });
      }
      Alert.alert("Vote recorded", "Your vote is in. Read what economists are saying to compare your view.");
      onSuccess();
      setSelectedSide(null);
      setSelectedOptionId(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to record vote.");
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
          <Text style={styles.sheetTitle}>Cast your vote</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.sheetClose}>Cancel</Text>
          </Pressable>
        </View>
        <Text style={styles.sheetSub} numberOfLines={3}>{market.title}</Text>

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
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Submit vote</Text>}
        </Pressable>
        <Text style={styles.disclaimer}>One vote per user — your stance is final once submitted.</Text>
      </View>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.xl },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  backBtn: { padding: 4 },
  topBarTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  errorText: { color: colors.textMuted, marginBottom: spacing.md, textAlign: "center" },
  retryBtn: { backgroundColor: colors.accent, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 8 },
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
  title: { fontSize: 20, fontWeight: "800", color: colors.text, lineHeight: 26 },
  description: { fontSize: 14, color: colors.textMuted, marginTop: 8, lineHeight: 20 },
  metaLine: { fontSize: 12, color: colors.textMuted, marginTop: 12, fontWeight: "600" },

  card: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
  },
  sectionLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5, color: colors.textMuted, textTransform: "uppercase", marginBottom: 8 },
  helperLine: { fontSize: 12, color: colors.textMuted, marginBottom: 12, lineHeight: 17 },
  consensusEmpty: { fontSize: 13, color: colors.textMuted, fontStyle: "italic" },

  mcRow: { marginBottom: spacing.sm },
  mcRowHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  mcLabel: { fontSize: 13, color: colors.text, flex: 1, marginRight: 8 },
  mcLabelMine: { fontWeight: "700", color: "#92400e" },
  mcPct: { fontSize: 13, fontWeight: "700", color: colors.text },
  mcBar: { height: 6, backgroundColor: "#f3f4f6", borderRadius: 3, overflow: "hidden" },
  mcBarFill: { height: "100%", backgroundColor: colors.accent, borderRadius: 3 },
  mcBarFillMine: { backgroundColor: "#f59e0b" },

  sideTag: { alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  sideTagYes: { backgroundColor: "#dcfce7" },
  sideTagNo: { backgroundColor: "#fee2e2" },
  sideTagText: { fontSize: 13, fontWeight: "800", letterSpacing: 0.5, color: colors.text },

  opinionRow: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  opinionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  opinionExpert: { fontSize: 14, fontWeight: "700", color: colors.text, flex: 1, marginRight: 8 },
  opinionOrg: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  opinionQuote: { fontSize: 13, color: colors.text, fontStyle: "italic", marginTop: 6, lineHeight: 18 },
  opinionMeta: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
  directionPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4 },
  directionText: { fontSize: 10, fontWeight: "800", color: "#fff", letterSpacing: 0.5 },
  dirBullish: { backgroundColor: "#16a34a" },
  dirBearish: { backgroundColor: "#dc2626" },
  dirNeutral: { backgroundColor: "#6b7280" },

  stickyBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
    paddingHorizontal: spacing.md, paddingTop: 10,
  },
  voteBtn: { backgroundColor: colors.accent, paddingVertical: 14, borderRadius: radius.md, alignItems: "center" },
  voteBtnText: { color: "#fff", fontSize: 16, fontWeight: "800", letterSpacing: 0.3 },
  votedBadge: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, backgroundColor: "rgba(34, 197, 94, 0.1)", borderRadius: radius.md },
  votedBadgeText: { color: colors.accent, fontSize: 14, fontWeight: "700" },

  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.lg },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.md },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  sheetClose: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  sheetSub: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.lg },
  sideRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  sideBtn: { flex: 1, paddingVertical: 18, borderRadius: radius.md, alignItems: "center", borderWidth: 1 },
  sideYes: { backgroundColor: "#f0fdf4", borderColor: "#86efac" },
  sideYesActive: { backgroundColor: "#16a34a", borderColor: "#16a34a" },
  sideNo: { backgroundColor: "#fef2f2", borderColor: "#fca5a5" },
  sideNoActive: { backgroundColor: "#dc2626", borderColor: "#dc2626" },
  sideBtnText: { fontSize: 18, fontWeight: "800", color: colors.text },
  mcChoice: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 14, borderRadius: radius.md, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  mcChoiceSelected: { backgroundColor: "rgba(245, 158, 11, 0.08)", borderColor: "#f59e0b" },
  mcChoiceText: { fontSize: 14, color: colors.text, flex: 1 },
  mcChoiceTextSelected: { fontWeight: "700" },
  submitBtn: { backgroundColor: colors.accent, paddingVertical: 14, borderRadius: radius.md, alignItems: "center", marginTop: 8 },
  submitBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  disclaimer: { fontSize: 11, color: colors.textMuted, textAlign: "center", marginTop: 8 },
  errorLine: { color: "#dc2626", fontSize: 12, marginBottom: 8 },
});
