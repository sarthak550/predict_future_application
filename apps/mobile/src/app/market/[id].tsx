import { Feather, Ionicons } from "@expo/vector-icons";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  type AppStateStatus,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Session } from "@/providers/session-provider";

import type { ApiAnalystPosition, ApiMarketDetail, ApiMarketSummary, ApiMyProfile, ApiProbabilityHistory } from "@predict-future/types";
import { formatDateTime, formatPercent, formatPoints, formatRelativeTime } from "@predict-future/utils";
import { radius, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { useInterval } from "@/hooks/useInterval";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";
import { GradientButton } from "@/components/gradient-button";
import { VerifiedBadge } from "@/components/verified-badge";
import { LinkifiedText } from "@/components/linkified-text";

type UserPosition = {
  id: string;
  side: string | null;
  amount: number;
  numericValue: number | null;
  createdAt: string;
  reasoning?: string | null;
};

type UserVote = {
  side: string | null;
  numericValue: number | null;
};

type UserMultiChoicePosition = {
  id?: string;
  optionId: string;
  amount: number;
  reasoning?: string | null;
};

type MarketResponse = Omit<ApiMarketDetail, "userMultiChoicePositions"> & {
  userPositions?: UserPosition[];
  userVote?: UserVote | null;
  userMultiChoicePositions?: UserMultiChoicePosition[];
};

function normalizeParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" && value.length > 0 ? value : null;
}

const BET_PRESETS = [50, 100, 250, 500, 1000];

function calcEstimatedReturn(
  side: "YES" | "NO",
  amount: number,
  yesPool: number,
  noPool: number
): number {
  const projectedYesPool = side === "YES" ? yesPool + amount : yesPool;
  const projectedNoPool = side === "NO" ? noPool + amount : noPool;
  if (side === "YES") {
    if (projectedYesPool === 0) return amount;
    return Math.floor(amount + (amount / projectedYesPool) * projectedNoPool);
  }
  if (projectedNoPool === 0) return amount;
  return Math.floor(amount + (amount / projectedNoPool) * projectedYesPool);
}

async function shareMarketResult(input: {
  title: string;
  side: string | null;
  outcome: string | null | undefined;
  amount: number;
  marketId: string;
}) {
  const won = input.side != null && input.outcome != null && input.side === input.outcome;
  const lost = input.side != null && input.outcome != null && input.side !== input.outcome;
  const resultLine = won
    ? `I predicted ${input.side} and won!`
    : lost
    ? `I predicted ${input.side} — the market resolved ${input.outcome}.`
    : `I participated in this prediction market.`;

  await Share.share({
    message: `${input.title}\n\n${resultLine}\n\nPredicting on Predict Future — free virtual points, no deposits.\n\nhttps://predictfuture.app/markets/${input.marketId}`,
    url: `https://predictfuture.app/markets/${input.marketId}`,
  });
}

async function shareOpenMarket(title: string, marketId: string) {
  await Share.share({
    message: `"${title}" — what do you think? Predict on Predict Future: https://predictfuture.app/markets/${marketId}`,
    url: `https://predictfuture.app/markets/${marketId}`,
  });
}

// ─── Resolution modal data ────────────────────────────────────────────────────

type ResolutionModalData = {
  won: boolean;
  winningSide: string;
  userSide: string;
  payout: number;
  marketTitle: string;
  marketId: string;
  positions: UserPosition[];
};

export default function MarketDetailScreen() {
  const params = useLocalSearchParams<{ id: string | string[]; justResolved?: string }>();
  const id = normalizeParam(params.id);
  const justResolved = params.justResolved === "true";
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const fetcher = useCallback(
    () => mobileApi.getMarketById(id as string),
    [id]
  );

  const { data, status, error, refetch } = useApiQuery<MarketResponse>(fetcher, [id], {
    enabled: Boolean(id),
    errorFallback: "Unable to load market.",
  });

  // ── Balance for bet panel (T2: S68) ─────────────────────────────────────────
  // Fetch the user's wallet balance once on mount so the betting sheets can
  // show an "Available: X pts" hint. Failures are silently swallowed — we
  // never block betting on a balance fetch error.
  const { session } = useSession();
  const profileFetcher = useCallback(() => mobileApi.getMyProfile(), []);
  const { data: profileData } = useApiQuery<ApiMyProfile>(profileFetcher, [session?.userId], {
    enabled: Boolean(session?.userId),
  });
  const walletBalance: number | null = profileData?.user?.wallet?.balance ?? null;

  // Track whether the screen is focused AND the app is foregrounded
  const [pollActive, setPollActive] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useFocusEffect(
    useCallback(() => {
      // Screen gained focus — start polling if app is active
      if (appStateRef.current === "active") setPollActive(true);

      const sub = AppState.addEventListener("change", (next) => {
        appStateRef.current = next;
        setPollActive(next === "active");
      });

      return () => {
        // Screen lost focus — stop polling
        setPollActive(false);
        sub.remove();
      };
    }, [])
  );

  // Poll every 15 seconds while screen is focused and app is foregrounded
  // Only poll when market is OPEN (no point refreshing resolved markets)
  const shouldPoll = pollActive && data?.market?.status === "OPEN";
  useInterval(refetch, 15_000, shouldPoll);

  // ─── Resolution payoff modal ───────────────────────────────────────────────
  // Track the market status at the time data first loads for this screen mount.
  // We only show the modal if:
  //   a) The market was OPEN on first load and then transitioned to RESOLVED (live transition), OR
  //   b) The screen was opened with justResolved=true nav param.
  const statusOnFirstLoadRef = useRef<string | null>(null);
  const resolutionModalShownRef = useRef(false);
  const [resolutionModal, setResolutionModal] = useState<ResolutionModalData | null>(null);

  useEffect(() => {
    if (!data?.market) return;
    const market = data.market;
    const positions = data.userPositions ?? [];

    // Capture status on first load
    if (statusOnFirstLoadRef.current === null) {
      statusOnFirstLoadRef.current = market.status;
    }

    // Determine whether we should fire the modal
    const wasOpenOnMount = statusOnFirstLoadRef.current === "OPEN";
    const isNowResolved = market.status === "RESOLVED";
    const hasPosition = positions.length > 0;
    const alreadyShown = resolutionModalShownRef.current;

    if (!alreadyShown && hasPosition && isNowResolved && (wasOpenOnMount || justResolved)) {
      resolutionModalShownRef.current = true;

      const winningSide = market.winningSide ?? null;
      const userSide = positions[0]?.side ?? null;
      const won = winningSide != null && userSide != null && winningSide === userSide;
      const totalCommitted = positions.reduce((sum, p) => sum + p.amount, 0);

      // Estimate payout for a win using pool math
      let payout = 0;
      if (won && winningSide != null) {
        const yesPool = market.yesPool ?? 0;
        const noPool = market.noPool ?? 0;
        payout = calcEstimatedReturn(
          winningSide as "YES" | "NO",
          totalCommitted,
          winningSide === "YES" ? yesPool - totalCommitted : yesPool,
          winningSide === "NO" ? noPool - totalCommitted : noPool
        );
      }

      setResolutionModal({
        won,
        winningSide: winningSide ?? "RESOLVED",
        userSide: userSide ?? "unknown",
        payout,
        marketTitle: market.title,
        marketId: market.id,
        positions,
      });
    }
  }, [data, justResolved]);

  // Bottom sheet / betting modal state — lifted here so sticky bar can open it
  const [betSheetOpen, setBetSheetOpen] = useState(false);

  return (
    <View style={[styles.root, { paddingBottom: 0 }]}>
      <Stack.Screen options={{ headerShown: true, title: "Market" }} />

      {/* Scrollable content area */}
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          // Bottom padding so last content clears the sticky bar + safe-area
          { paddingBottom: STICKY_BAR_HEIGHT + insets.bottom + spacing.lg },
        ]}
      >
        {!id ? (
          <Text style={styles.error}>Missing market id.</Text>
        ) : status === "loading" || status === "idle" ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
        ) : status === "error" ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Couldn't load market</Text>
            <Text style={styles.subtitle}>{error}</Text>
            <Pressable onPress={refetch} style={styles.retryBtn}>
              <Text style={styles.retryLabel}>Retry</Text>
            </Pressable>
          </View>
        ) : data?.market ? (
          <MarketBody
            data={data}
            marketId={id}
            onRefresh={refetch}
            onOpenBetSheet={() => setBetSheetOpen(true)}
          />
        ) : (
          <Text style={styles.error}>Market not found.</Text>
        )}
      </ScrollView>

      {/* Sticky bottom betting panel — always rendered when data is available */}
      {data?.market && id ? (
        <StickyBettingBar
          data={data}
          marketId={id}
          betSheetOpen={betSheetOpen}
          onOpenBetSheet={() => setBetSheetOpen(true)}
          onCloseBetSheet={() => setBetSheetOpen(false)}
          onRefresh={refetch}
          bottomInset={insets.bottom}
          walletBalance={walletBalance}
        />
      ) : null}

      {/* Resolution payoff modal */}
      {resolutionModal && data?.market ? (
        <ResolutionPayoffModal
          modalData={resolutionModal}
          onClose={() => setResolutionModal(null)}
        />
      ) : null}
    </View>
  );
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STICKY_BAR_HEIGHT = 72;

// ─── StickyBettingBar ─────────────────────────────────────────────────────────

type StickyBettingBarProps = {
  data: MarketResponse;
  marketId: string;
  betSheetOpen: boolean;
  onOpenBetSheet: () => void;
  onCloseBetSheet: () => void;
  onRefresh: () => void;
  bottomInset: number;
  walletBalance: number | null;
};

function StickyBettingBar({
  data,
  marketId,
  betSheetOpen,
  onOpenBetSheet,
  onCloseBetSheet,
  onRefresh,
  bottomInset,
  walletBalance,
}: StickyBettingBarProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const market = data.market;
  const positions = data.userPositions ?? [];
  const hasPosition = positions.length > 0;
  const totalCommitted = positions.reduce((sum, p) => sum + p.amount, 0);
  const ctaLabel = hasPosition ? "Add More" : "Predict";
  const ctaLabelMC = hasPosition ? "Stake More" : "Predict";

  const yesPool = market.yesPool ?? 0;
  const noPool = market.noPool ?? 0;
  const totalPool = yesPool + noPool;
  const resolvedSide = market.winningSide ?? market.outcome ?? null;
  const yesProbability =
    market.status === "RESOLVED" && resolvedSide === "YES" ? 1.0 :
    market.status === "RESOLVED" && resolvedSide === "NO" ? 0.0 :
    totalPool > 0 ? yesPool / totalPool :
    market.externalProbability ?? 0.5;

  const isOpen = market.status === "OPEN";
  const isNumeric = market.marketType === "NUMERIC";
  const isMultipleChoice = market.marketType === "MULTIPLE_CHOICE";
  const isPoll = Boolean(market.storyId);

  // Poll inline vote state (binary polls on the bar)
  const existingVote = data.userVote ?? null;
  const [pollVoteOptimistic, setPollVoteOptimistic] = useState<"YES" | "NO" | null>(
    existingVote?.side as "YES" | "NO" | null
  );
  const [pollVoting, setPollVoting] = useState(false);
  const [pollVoteError, setPollVoteError] = useState<string | null>(null);

  async function handlePollVote(side: "YES" | "NO") {
    if (pollVoting || pollVoteOptimistic != null) return;
    setPollVoteOptimistic(side);
    setPollVoting(true);
    setPollVoteError(null);
    try {
      await mobileApi.castVote(marketId, { side });
      onRefresh();
    } catch (err: unknown) {
      // Revert optimistic update
      setPollVoteOptimistic(null);
      setPollVoteError(err instanceof Error ? err.message : "Vote failed.");
    } finally {
      setPollVoting(false);
    }
  }

  // Resolved outcome chip
  const resolvedOutcome = market.winningSide ?? (market.status === "RESOLVED" ? "RESOLVED" : null);

  const barStyle = [
    styles.stickyBar,
    { paddingBottom: Math.max(bottomInset, spacing.sm) },
  ];

  // ── Case 1: Closed / resolved market ──
  if (!isOpen) {
    return (
      <View style={barStyle}>
        <View style={styles.stickyBarInner}>
          <View style={styles.stickyBarLeft}>
            <View style={[styles.outcomePill, resolvedOutcome === "YES" ? styles.outcomePillYes : styles.outcomePillNo]}>
              <Text style={styles.outcomePillText}>
                {resolvedOutcome ? `Resolved ${resolvedOutcome}` : market.status}
              </Text>
            </View>
            {hasPosition ? (
              <Text style={styles.stickyPositionLabel}>
                Your position: {formatPoints(totalCommitted)} pts
              </Text>
            ) : null}
          </View>
          {hasPosition && market.winningSide ? (
            <Pressable
              style={styles.stickyShareBtn}
              onPress={() =>
                shareMarketResult({
                  title: market.title,
                  side: positions[0]?.side ?? null,
                  outcome: market.winningSide ?? null,
                  amount: totalCommitted,
                  marketId,
                })
              }
            >
              <Text style={styles.stickyShareBtnText}>Share Result</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  // ── Case 2: Open poll market ──
  if (isPoll && !isNumeric) {
    const voted = pollVoteOptimistic != null;
    return (
      <View style={barStyle}>
        <View style={styles.stickyBarInner}>
          {voted ? (
            <>
              <View
                style={[
                  styles.votedChip,
                  pollVoteOptimistic === "YES" ? styles.votedChipYes : styles.votedChipNo,
                ]}
              >
                <Text style={styles.votedChipText}>You voted {pollVoteOptimistic}</Text>
              </View>
              <Text style={styles.stickyPollSubtext}>Free poll — no points at stake</Text>
            </>
          ) : (
            <>
              <Text
                style={styles.stickyPollQuestion}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {market.title}
              </Text>
              <View style={styles.stickyPollBtns}>
                <Pressable
                  style={[styles.stickyPollBtn, styles.stickyPollBtnYes]}
                  onPress={() => handlePollVote("YES")}
                  disabled={pollVoting}
                >
                  {pollVoting && pollVoteOptimistic === "YES" ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.stickyPollBtnText}>YES</Text>
                  )}
                </Pressable>
                <Pressable
                  style={[styles.stickyPollBtn, styles.stickyPollBtnNo]}
                  onPress={() => handlePollVote("NO")}
                  disabled={pollVoting}
                >
                  {pollVoting && pollVoteOptimistic === "NO" ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.stickyPollBtnText}>NO</Text>
                  )}
                </Pressable>
              </View>
              {pollVoteError ? (
                <Text style={styles.stickyError}>{pollVoteError}</Text>
              ) : null}
            </>
          )}
        </View>
      </View>
    );
  }

  // ── Case 3: Open multiple-choice market ──
  if (isMultipleChoice) {
    const totalStaked = (market.options ?? []).reduce((sum, o) => sum + o.totalStaked, 0);
    return (
      <>
        <View style={barStyle}>
          <View style={styles.stickyBarInner}>
            <View style={styles.stickyBarLeft}>
              <Text style={styles.stickyProbLabel}>Total staked</Text>
              <Text style={styles.stickyProbValue}>{formatPoints(totalStaked)} pts</Text>
            </View>
            <Pressable style={styles.predictBtn} onPress={onOpenBetSheet}>
              <Text style={styles.predictBtnText}>{ctaLabelMC}</Text>
            </Pressable>
          </View>
        </View>
        <MultiChoiceBettingSheet
          visible={betSheetOpen}
          onClose={onCloseBetSheet}
          data={data}
          marketId={marketId}
          onRefresh={onRefresh}
          onBetSuccess={onCloseBetSheet}
          bottomInset={bottomInset}
          walletBalance={walletBalance}
        />
      </>
    );
  }

  // ── Case 4: Open non-poll market (binary or numeric) ──
  return (
    <>
      <View style={barStyle}>
        <View style={styles.stickyBarInner}>
          <View style={styles.stickyBarLeft}>
            {!isNumeric ? (
              <View>
                <Text style={styles.stickyProbLabel}>YES probability</Text>
                <Text style={styles.stickyProbValue}>{formatPercent(yesProbability)}</Text>
              </View>
            ) : (
              <View>
                <Text style={styles.stickyProbLabel}>Avg prediction</Text>
                <Text style={styles.stickyProbValue}>
                  {market.averageNumericValue != null
                    ? `${Number(market.averageNumericValue).toLocaleString(undefined, { maximumFractionDigits: 2 })}${market.unit ? ` ${market.unit}` : ""}`
                    : "—"}
                </Text>
              </View>
            )}
            {hasPosition ? (
              <View style={styles.stickyPositionBadge}>
                <View
                  style={[
                    styles.stickyPosPill,
                    positions[0]?.side === "YES"
                      ? styles.stickyPosPillYes
                      : positions[0]?.side === "NO"
                      ? styles.stickyPosPillNo
                      : styles.stickyPosPillNumeric,
                  ]}
                >
                  <Text style={styles.stickyPosPillText}>
                    {positions[0]?.side ?? `${positions[0]?.numericValue}`}
                  </Text>
                </View>
                <Text style={styles.stickyPositionAmount}>
                  {formatPoints(totalCommitted)} pts
                </Text>
              </View>
            ) : null}
          </View>
          <Pressable style={styles.predictBtn} onPress={onOpenBetSheet}>
            <Text style={styles.predictBtnText}>{ctaLabel}</Text>
          </Pressable>
        </View>
      </View>

      {/* Full betting bottom sheet modal */}
      <BettingSheet
        visible={betSheetOpen}
        onClose={onCloseBetSheet}
        data={data}
        marketId={marketId}
        onRefresh={onRefresh}
        onBetSuccess={onCloseBetSheet}
        bottomInset={bottomInset}
        walletBalance={walletBalance}
      />
    </>
  );
}

// ─── BettingSheet ─────────────────────────────────────────────────────────────

type BettingSheetProps = {
  visible: boolean;
  onClose: () => void;
  data: MarketResponse;
  marketId: string;
  onRefresh: () => void;
  onBetSuccess: () => void;
  bottomInset: number;
  walletBalance: number | null;
};

function BettingSheet({
  visible,
  onClose,
  data,
  marketId,
  onRefresh,
  onBetSuccess,
  bottomInset,
  walletBalance,
}: BettingSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const market = data.market;
  const positions = data.userPositions ?? [];
  const hasPosition = positions.length > 0;

  const yesPool = market.yesPool ?? 0;
  const noPool = market.noPool ?? 0;
  const isNumeric = market.marketType === "NUMERIC";

  const [selectedSide, setSelectedSide] = useState<"YES" | "NO" | null>(null);
  const [numericGuess, setNumericGuess] = useState("");
  const [amount, setAmount] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [placing, setPlacing] = useState(false);
  const [betError, setBetError] = useState<string | null>(null);
  const [betSuccess, setBetSuccess] = useState(false);
  // Reasoning field — sticky within session once expanded
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const [reasoning, setReasoning] = useState("");

  // Reset form when sheet opens.
  useEffect(() => {
    if (visible) {
      setSelectedSide(null);
      setNumericGuess("");
      setAmount("");
      setCustomAmount("");
      setBetError(null);
      setBetSuccess(false);
      setReasoningExpanded(false);
      setReasoning("");
    }
  }, [visible]);

  const betAmount = customAmount ? parseInt(customAmount, 10) : parseInt(amount, 10);

  const yesProbability = (yesPool + noPool) > 0 ? yesPool / (yesPool + noPool) : 0.5;

  async function handlePlaceBet() {
    if (placing) return;
    if (!betAmount || betAmount < 50) {
      setBetError("Minimum bet is 50 points.");
      return;
    }
    if (!isNumeric && !selectedSide && !hasPosition) {
      setBetError("Pick YES or NO.");
      return;
    }
    if (isNumeric && !numericGuess && !hasPosition) {
      setBetError("Enter your guess.");
      return;
    }

    setPlacing(true);
    setBetError(null);
    try {
      const existingSide = positions[0]?.side as "YES" | "NO" | null;
      const trimmedReasoning = reasoning.trim();
      const result = await mobileApi.placePosition(marketId, {
        side: isNumeric ? undefined : hasPosition ? (existingSide ?? undefined) : (selectedSide ?? undefined),
        numericValue: isNumeric
          ? hasPosition
            ? (positions[0]?.numericValue ?? undefined)
            : parseFloat(numericGuess)
          : undefined,
        amount: betAmount,
        reasoning: trimmedReasoning.length > 0 ? trimmedReasoning : undefined,
      });
      setBetSuccess(true);
      onRefresh();

      // Show quest-completion toast if any quests were completed as a side-effect.
      const rewards = result?.questRewards ?? [];
      if (rewards.length > 0) {
        const totalPts = rewards.reduce((sum, r) => sum + r.reward, 0);
        Alert.alert(
          "Quest complete!",
          `You earned +${totalPts} pts from daily quests.`,
          [{ text: "Nice!" }]
        );
      }

      // Auto-close after brief success flash
      setTimeout(() => {
        onBetSuccess();
      }, 1200);
    } catch (err: unknown) {
      setBetError(err instanceof Error ? err.message : "Failed to place bet.");
    } finally {
      setPlacing(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={[styles.sheetContainer, { paddingBottom: Math.max(bottomInset, spacing.lg) }]}>
        {/* Handle bar */}
        <View style={styles.sheetHandle} />

        {/* Header */}
        <View style={styles.sheetHeader}>
          <View style={styles.sheetTitleWrap}>
            <Text style={styles.sheetTitle}>
              {hasPosition ? "Increase Your Bet" : "Place Your Bet"}
            </Text>
            {walletBalance != null && (
              <Text style={styles.sheetBalanceHint}>
                Available: {walletBalance.toLocaleString()} pts
              </Text>
            )}
          </View>
          <Pressable onPress={onClose} style={styles.sheetCloseBtn} hitSlop={12}>
            <Text style={styles.sheetCloseBtnText}>Done</Text>
          </Pressable>
        </View>

        {betSuccess ? (
          // ── Success state ──
          <View style={styles.sheetSuccessSection}>
            <Text style={styles.sheetSuccessTitle}>Bet placed!</Text>
            <Text style={styles.sheetSuccessText}>
              Your position has been recorded. You can increase your bet but cannot change your side.
            </Text>
          </View>
        ) : (
          <>
            {/* Side selection (binary, new position only) */}
            {!isNumeric && !hasPosition ? (
              <View style={styles.sideRow}>
                <Pressable
                  style={[
                    styles.sideBtn,
                    styles.sideBtnYes,
                    selectedSide === "YES" && styles.sideBtnYesActive,
                  ]}
                  onPress={() => setSelectedSide("YES")}
                >
                  <Text
                    style={[
                      styles.sideBtnText,
                      selectedSide === "YES" && styles.sideBtnTextActive,
                    ]}
                  >
                    YES
                  </Text>
                  <Text style={styles.sideProb}>{formatPercent(yesProbability)}</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.sideBtn,
                    styles.sideBtnNo,
                    selectedSide === "NO" && styles.sideBtnNoActive,
                  ]}
                  onPress={() => setSelectedSide("NO")}
                >
                  <Text
                    style={[
                      styles.sideBtnText,
                      selectedSide === "NO" && styles.sideBtnTextActive,
                    ]}
                  >
                    NO
                  </Text>
                  <Text style={styles.sideProb}>{formatPercent(1 - yesProbability)}</Text>
                </Pressable>
              </View>
            ) : null}

            {/* Existing side reminder */}
            {!isNumeric && hasPosition ? (
              <View style={styles.lockedSideRow}>
                <Text style={styles.lockedLabel}>Your side:</Text>
                <View
                  style={[
                    styles.sidePill,
                    positions[0]?.side === "YES" ? styles.sidePillYes : styles.sidePillNo,
                  ]}
                >
                  <Text style={styles.sidePillText}>{positions[0]?.side}</Text>
                </View>
                <Text style={styles.lockedHint}>(can't change)</Text>
              </View>
            ) : null}

            {/* Numeric guess (new position only) */}
            {isNumeric && !hasPosition ? (
              <View style={styles.numericSection}>
                <Text style={styles.inputLabel}>Your guess</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder={
                    market.minValue != null && market.maxValue != null
                      ? `Between ${market.minValue} and ${market.maxValue}`
                      : "Enter your guess"
                  }
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  value={numericGuess}
                  onChangeText={setNumericGuess}
                />
              </View>
            ) : null}

            {isNumeric && hasPosition ? (
              <View style={styles.lockedSideRow}>
                <Text style={styles.lockedLabel}>Your guess:</Text>
                <Text style={styles.lockedValue}>{positions[0]?.numericValue}</Text>
                <Text style={styles.lockedHint}>(can't change)</Text>
              </View>
            ) : null}

            {/* Amount selection */}
            <Text style={[styles.inputLabel, { marginTop: spacing.lg }]}>Amount</Text>
            <View style={styles.presetRow}>
              {BET_PRESETS.map((preset) => (
                <Pressable
                  key={preset}
                  style={[
                    styles.presetPill,
                    amount === String(preset) && !customAmount && styles.presetPillActive,
                  ]}
                  onPress={() => {
                    setAmount(String(preset));
                    setCustomAmount("");
                  }}
                >
                  <Text
                    style={[
                      styles.presetText,
                      amount === String(preset) && !customAmount && styles.presetTextActive,
                    ]}
                  >
                    {preset}
                  </Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              style={styles.textInput}
              placeholder="Custom amount (min 50)"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={customAmount}
              onChangeText={(text) => {
                setCustomAmount(text);
                if (text) setAmount("");
              }}
            />

            {!isNumeric && selectedSide && betAmount >= 50 ? (
              <View style={styles.estimatedReturnRow}>
                <Text style={styles.estimatedReturnLabel}>Estimated return</Text>
                <Text style={styles.estimatedReturnValue}>
                  {formatPoints(calcEstimatedReturn(selectedSide, betAmount, yesPool, noPool))} pts
                </Text>
              </View>
            ) : null}

            {/* Low-balance warning (T2: S68) — informational only, does not block Submit */}
            {walletBalance != null && betAmount >= 50 && betAmount > walletBalance ? (
              <View style={styles.lowBalanceWarning}>
                <Ionicons name="warning-outline" size={14} color={colors.warning as string} />
                <Text style={styles.lowBalanceWarningText}>
                  You only have {walletBalance.toLocaleString()} pts available
                </Text>
              </View>
            ) : null}

            {/* Reasoning field */}
            <Pressable
              style={styles.reasoningToggleRow}
              onPress={() => setReasoningExpanded((prev) => !prev)}
              accessibilityRole="button"
              accessibilityLabel="Add reasoning"
            >
              <Ionicons
                name="pencil-outline"
                size={15}
                color={colors.textMuted}
                style={{ marginRight: spacing.xs }}
              />
              <Text style={styles.reasoningToggleLabel}>
                Add your reasoning (optional)
              </Text>
              <Ionicons
                name={reasoningExpanded ? "chevron-up" : "chevron-down"}
                size={14}
                color={colors.textMuted}
              />
            </Pressable>

            {reasoningExpanded ? (
              <View style={styles.reasoningInputWrapper}>
                <TextInput
                  style={styles.reasoningInput}
                  placeholder="Why are you making this call?"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  maxLength={500}
                  value={reasoning}
                  onChangeText={setReasoning}
                  textAlignVertical="top"
                />
                <Text style={styles.reasoningCounter}>
                  {reasoning.length}/500
                </Text>
              </View>
            ) : null}

            {betError ? <Text style={styles.betError}>{betError}</Text> : null}

            {/* Primary commit CTA — GradientButton (brand gradient, highest-intent action) */}
            <GradientButton
              label={`${hasPosition ? "Increase Bet" : "Place Bet"}${betAmount >= 50 ? ` — ${betAmount} pts` : ""}`}
              onPress={handlePlaceBet}
              disabled={placing}
              loading={placing}
              style={styles.placeBetBtn}
            />
          </>
        )}
      </View>
    </Modal>
  );
}

// ─── MultiChoiceBettingSheet ──────────────────────────────────────────────────

type MultiChoiceBettingSheetProps = {
  visible: boolean;
  onClose: () => void;
  data: MarketResponse;
  marketId: string;
  onRefresh: () => void;
  onBetSuccess: () => void;
  bottomInset: number;
  walletBalance: number | null;
};

function MultiChoiceBettingSheet({
  visible,
  onClose,
  data,
  marketId,
  onRefresh,
  onBetSuccess,
  bottomInset,
  walletBalance,
}: MultiChoiceBettingSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const market = data.market;
  const options = market.options ?? [];
  const totalStaked = options.reduce((sum, o) => sum + o.totalStaked, 0);

  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [placing, setPlacing] = useState(false);
  const [betError, setBetError] = useState<string | null>(null);
  const [betSuccess, setBetSuccess] = useState(false);

  useEffect(() => {
    if (visible) {
      setSelectedOptionId(null);
      setAmount("");
      setCustomAmount("");
      setBetError(null);
      setBetSuccess(false);
    }
  }, [visible]);

  const betAmount = customAmount ? parseInt(customAmount, 10) : parseInt(amount, 10);

  async function handlePlaceBet() {
    if (placing) return;
    if (!selectedOptionId) {
      setBetError("Select an option.");
      return;
    }
    if (!betAmount || betAmount < 10) {
      setBetError("Minimum stake is 10 points.");
      return;
    }

    setPlacing(true);
    setBetError(null);
    try {
      const result = await mobileApi.placeMultiChoicePosition(marketId, {
        optionId: selectedOptionId,
        amount: betAmount,
      });
      setBetSuccess(true);
      onRefresh();

      const rewards = result?.questRewards ?? [];
      if (rewards.length > 0) {
        const totalPts = rewards.reduce((sum, r) => sum + r.reward, 0);
        Alert.alert(
          "Quest complete!",
          `You earned +${totalPts} pts from daily quests.`,
          [{ text: "Nice!" }]
        );
      }

      setTimeout(() => {
        onBetSuccess();
      }, 1200);
    } catch (err: unknown) {
      setBetError(err instanceof Error ? err.message : "Failed to place stake.");
    } finally {
      setPlacing(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={[styles.sheetContainer, { paddingBottom: Math.max(bottomInset, spacing.lg) }]}>
        <View style={styles.sheetHandle} />

        <View style={styles.sheetHeader}>
          <View style={styles.sheetTitleWrap}>
            <Text style={styles.sheetTitle}>Choose an Option</Text>
            {walletBalance != null && (
              <Text style={styles.sheetBalanceHint}>
                Available: {walletBalance.toLocaleString()} pts
              </Text>
            )}
          </View>
          <Pressable onPress={onClose} style={styles.sheetCloseBtn} hitSlop={12}>
            <Text style={styles.sheetCloseBtnText}>Done</Text>
          </Pressable>
        </View>

        {betSuccess ? (
          <View style={styles.sheetSuccessSection}>
            <Text style={styles.sheetSuccessTitle}>Stake placed!</Text>
            <Text style={styles.sheetSuccessText}>
              Your prediction has been recorded.
            </Text>
          </View>
        ) : (
          <>
            {/* Options list */}
            <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
              {options.map((option) => {
                const pct = totalStaked > 0 ? option.totalStaked / totalStaked : 0;
                const isSelected = selectedOptionId === option.id;
                return (
                  <Pressable
                    key={option.id}
                    style={[
                      styles.multiChoiceOption,
                      isSelected && styles.multiChoiceOptionSelected
                    ]}
                    onPress={() => setSelectedOptionId(option.id)}
                  >
                    <View style={styles.multiChoiceOptionRow}>
                      <Text
                        style={[
                          styles.multiChoiceOptionLabel,
                          isSelected && styles.multiChoiceOptionLabelSelected
                        ]}
                        numberOfLines={2}
                      >
                        {option.label}
                      </Text>
                      <Text style={styles.multiChoiceOptionPct}>
                        {Math.round(pct * 100)}%
                      </Text>
                    </View>
                    <View style={styles.multiChoiceBar}>
                      <View
                        style={[
                          styles.multiChoiceBarFill,
                          isSelected && styles.multiChoiceBarFillSelected,
                          { width: `${Math.round(pct * 100)}%` }
                        ]}
                      />
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Amount selection */}
            <Text style={[styles.inputLabel, { marginTop: spacing.md }]}>Amount</Text>
            <View style={styles.presetRow}>
              {[50, 100, 250, 500, 1000].map((preset) => (
                <Pressable
                  key={preset}
                  style={[
                    styles.presetPill,
                    amount === String(preset) && !customAmount && styles.presetPillActive,
                  ]}
                  onPress={() => {
                    setAmount(String(preset));
                    setCustomAmount("");
                  }}
                >
                  <Text
                    style={[
                      styles.presetText,
                      amount === String(preset) && !customAmount && styles.presetTextActive,
                    ]}
                  >
                    {preset}
                  </Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              style={styles.textInput}
              placeholder="Custom amount (min 10)"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={customAmount}
              onChangeText={(text) => {
                setCustomAmount(text);
                if (text) setAmount("");
              }}
            />

            {/* Low-balance warning (T2: S68) — informational only, does not block Submit */}
            {walletBalance != null && betAmount >= 50 && betAmount > walletBalance ? (
              <View style={styles.lowBalanceWarning}>
                <Ionicons name="warning-outline" size={14} color={colors.warning as string} />
                <Text style={styles.lowBalanceWarningText}>
                  You only have {walletBalance.toLocaleString()} pts available
                </Text>
              </View>
            ) : null}

            {betError ? <Text style={styles.betError}>{betError}</Text> : null}

            <Pressable
              style={[styles.placeBetBtn, placing && styles.btnDisabled]}
              onPress={handlePlaceBet}
              disabled={placing}
            >
              {placing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.placeBetText}>
                  Stake{betAmount >= 10 ? ` — ${betAmount} pts` : ""}
                </Text>
              )}
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}

// ─── ResolutionPayoffModal ────────────────────────────────────────────────────

type ResolutionPayoffModalProps = {
  modalData: ResolutionModalData;
  onClose: () => void;
};

function ResolutionPayoffModal({ modalData, onClose }: ResolutionPayoffModalProps) {
  const styles = useThemedStyles(makeStyles);
  const { won, winningSide, userSide, payout, marketTitle, marketId, positions } = modalData;
  const totalCommitted = positions.reduce((sum, p) => sum + p.amount, 0);

  // Entrance scale animation
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [scaleAnim, opacityAnim]);

  function handleClose() {
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 0.85,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  }

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={handleClose}
    >
      <Animated.View style={[styles.payoffBackdrop, { opacity: opacityAnim }]}>
        <Animated.View
          style={[
            styles.payoffCard,
            { transform: [{ scale: scaleAnim }] },
          ]}
        >
          {/* Icon */}
          <View
            style={[
              styles.payoffIconCircle,
              won ? styles.payoffIconCircleWin : styles.payoffIconCircleLoss,
            ]}
          >
            <Text style={styles.payoffIconText}>{won ? "✓" : "✕"}</Text>
          </View>

          {won ? (
            <>
              {/* Win content */}
              <Text style={styles.payoffHeadlineWin}>You won!</Text>
              <Text style={styles.payoffPointsDelta}>+{formatPoints(payout)} pts</Text>
              <Text style={styles.payoffSubtext}>
                Predicted {userSide} correctly on:
              </Text>
              <Text style={styles.payoffMarketTitle} numberOfLines={3}>
                {marketTitle}
              </Text>

              <View style={styles.payoffButtonRow}>
                <Pressable
                  style={[styles.payoffBtn, styles.payoffBtnShare]}
                  onPress={() => {
                    void shareMarketResult({
                      title: marketTitle,
                      side: userSide,
                      outcome: winningSide,
                      amount: totalCommitted,
                      marketId,
                    });
                  }}
                >
                  <Text style={styles.payoffBtnShareText}>Share Result</Text>
                </Pressable>
                <Pressable
                  style={[styles.payoffBtn, styles.payoffBtnClose]}
                  onPress={handleClose}
                >
                  <Text style={styles.payoffBtnCloseText}>Close</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              {/* Loss content */}
              <Text style={styles.payoffHeadlineLoss}>
                Market resolved {winningSide}
              </Text>
              <Text style={styles.payoffSubtext}>
                You predicted {userSide}
              </Text>
              <Text style={styles.payoffMarketTitle} numberOfLines={3}>
                {marketTitle}
              </Text>

              <Pressable
                style={[styles.payoffBtn, styles.payoffBtnClose, styles.payoffBtnCloseFull]}
                onPress={handleClose}
              >
                <Text style={styles.payoffBtnCloseText}>Close</Text>
              </Pressable>
            </>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ─── AnalystPositionsSection ──────────────────────────────────────────────────
// Shows top-5 positions with reasoning from other analysts, with upvote UI.

function AnalystPositionsSection({
  positions,
  currentUserId,
}: {
  positions: ApiAnalystPosition[];
  currentUserId: string | null;
}) {
  const analystPosStyles = useThemedStyles(makeAnalystPosStyles);
  const { colors } = useTheme();
  const [localPositions, setLocalPositions] = useState<ApiAnalystPosition[]>(positions);

  // Sync when parent re-renders with fresh data
  const positionsKey = positions.map((p) => `${p.id}:${p.reasoningUpvotes}`).join(",");
  const [lastKey, setLastKey] = useState(positionsKey);
  if (positionsKey !== lastKey) {
    setLocalPositions(positions);
    setLastKey(positionsKey);
  }

  const filtered = localPositions.filter((p) => p.reasoning != null);
  if (filtered.length === 0) return null;

  async function handleUpvote(positionId: string) {
    if (!currentUserId) return; // must be authenticated
    // Optimistic toggle
    setLocalPositions((prev) =>
      prev.map((p) => {
        if (p.id !== positionId) return p;
        const wasUpvoted = p.iUpvotedReasoning;
        return {
          ...p,
          iUpvotedReasoning: !wasUpvoted,
          reasoningUpvotes: wasUpvoted
            ? Math.max(0, p.reasoningUpvotes - 1)
            : p.reasoningUpvotes + 1,
        };
      })
    );

    try {
      await mobileApi.upvotePositionReasoning(positionId);
    } catch {
      // Revert on error
      setLocalPositions((prev) =>
        prev.map((p) => {
          if (p.id !== positionId) return p;
          const wasUpvoted = !p.iUpvotedReasoning; // reverted state
          return {
            ...p,
            iUpvotedReasoning: wasUpvoted,
            reasoningUpvotes: wasUpvoted
              ? p.reasoningUpvotes + 1
              : Math.max(0, p.reasoningUpvotes - 1),
          };
        })
      );
    }
  }

  return (
    <View style={analystPosStyles.card}>
      <Text style={analystPosStyles.title}>Analyst Reasoning</Text>
      {filtered.map((p) => {
        const isOwn = currentUserId != null && p.userId === currentUserId;
        return (
          <View key={p.id} style={analystPosStyles.row}>
            <View style={analystPosStyles.rowHeader}>
              <View style={[
                analystPosStyles.sidePill,
                p.side === "YES" ? analystPosStyles.pillYes : analystPosStyles.pillNo,
              ]}>
                <Text style={analystPosStyles.sidePillText}>{p.side ?? "?"}</Text>
              </View>
              <Text style={analystPosStyles.username} numberOfLines={1}>
                @{p.user.username}
              </Text>
            </View>
            <Text style={analystPosStyles.reasoning} numberOfLines={4}>
              {p.reasoning}
            </Text>
            {!isOwn && (
              <Pressable
                style={analystPosStyles.upvoteRow}
                onPress={() => void handleUpvote(p.id)}
                accessibilityRole="button"
                accessibilityLabel={p.iUpvotedReasoning ? "Remove upvote" : "Upvote reasoning"}
              >
                <Feather
                  name="thumbs-up"
                  size={13}
                  color={p.iUpvotedReasoning ? colors.accent : colors.textMuted}
                />
                {p.reasoningUpvotes > 0 && (
                  <Text style={[
                    analystPosStyles.upvoteCount,
                    p.iUpvotedReasoning && analystPosStyles.upvoteCountActive,
                  ]}>
                    {p.reasoningUpvotes}
                  </Text>
                )}
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

const makeAnalystPosStyles = (t: ThemeContextValue) => StyleSheet.create({
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.sm,
  },
  title: {
    fontSize: 13,
    fontWeight: "700",
    color: t.colors.text,
    marginBottom: spacing.md,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: {
    marginBottom: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.border,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  sidePill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  pillYes: { backgroundColor: t.colors.successSoft },
  pillNo: { backgroundColor: t.colors.dangerSoft },
  sidePillText: { fontSize: 11, fontWeight: "700", color: t.colors.text },
  username: {
    fontSize: 12,
    color: t.colors.textMuted,
    flex: 1,
  },
  reasoning: {
    fontSize: 13,
    color: t.colors.text,
    lineHeight: 19,
    marginBottom: spacing.xs,
  },
  upvoteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  upvoteCount: {
    fontSize: 12,
    color: t.colors.textMuted,
    fontWeight: "600",
  },
  upvoteCountActive: {
    color: t.colors.accent,
  },
});

// ─── MarketBody ───────────────────────────────────────────────────────────────
// Renders the scrollable content only — no betting panel; that's in the sticky bar.

function MarketBody({
  data,
  marketId,
  onRefresh,
  onOpenBetSheet,
}: {
  data: MarketResponse;
  marketId: string;
  onRefresh: () => void;
  onOpenBetSheet: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { session } = useSession();
  const market = data.market;
  const positions = data.userPositions ?? [];
  const hasPosition = positions.length > 0;
  const totalCommitted = positions.reduce((sum, p) => sum + p.amount, 0);

  const yesPool = market.yesPool ?? 0;
  const noPool = market.noPool ?? 0;
  const totalPool = yesPool + noPool;
  const resolvedSide = market.winningSide ?? market.outcome ?? null;
  const yesProbability =
    market.status === "RESOLVED" && resolvedSide === "YES" ? 1.0 :
    market.status === "RESOLVED" && resolvedSide === "NO" ? 0.0 :
    totalPool > 0 ? yesPool / totalPool :
    market.externalProbability ?? 0.5;

  const isOpen = market.status === "OPEN";
  const isClosed = !isOpen;
  const isNumeric = market.marketType === "NUMERIC";
  const isPoll = Boolean(market.storyId);

  const isPendingReview = market.status === "DRAFT" || market.status === "PENDING_REVIEW";
  const isCreatorViewing =
    market.creator?.username != null && market.creator.username === session?.username;
  const showPendingReviewBanner = isPendingReview && isCreatorViewing;

  // Host resolution panel visibility
  const isResolvable =
    (market.status === "CLOSED" || market.status === "AWAITING_RESOLUTION") &&
    market.creator?.username != null &&
    market.creator.username === session?.username;

  // Gate: host can only submit once resolveAt has passed. AWAITING_RESOLUTION
  // naturally implies resolveAt is in the past, so this is only meaningful for
  // CLOSED-but-pre-resolveAt markets.
  const canResolve = !market.resolveAt || new Date() >= new Date(market.resolveAt);

  // Animated probability bar
  const animatedProb = useRef(new Animated.Value(yesProbability)).current;

  useEffect(() => {
    Animated.timing(animatedProb, {
      toValue: yesProbability,
      duration: 300,
      useNativeDriver: false, // false required for width/layout animations
    }).start();
  }, [yesProbability]);

  // Probability history chart state (S27-T2). Re-fetches on bet placement so the
  // chart reflects the consensus shift live — keyed on positions length + total volume
  // so any change after a bet triggers a refresh.
  const [probHistory, setProbHistory] = useState<ApiProbabilityHistory | null>(null);
  const [probHistoryLoading, setProbHistoryLoading] = useState(false);
  const probHistoryFingerprint = `${data?.userPositions?.length ?? 0}-${market.totalVolume ?? 0}-${market.totalParticipants ?? 0}`;

  useEffect(() => {
    if (!marketId || market.marketType !== "BINARY") return;
    setProbHistoryLoading(true);
    mobileApi.getProbabilityHistory(marketId)
      .then((data) => setProbHistory(data))
      .catch(() => {
        // Non-fatal — chart simply won't render
        setProbHistory(null);
      })
      .finally(() => setProbHistoryLoading(false));
  }, [marketId, market.marketType, probHistoryFingerprint]);

  // Numeric poll vote state (for numeric polls that remain in scroll body)
  const existingVote = data.userVote ?? null;
  const [pollGuess, setPollGuess] = useState(
    existingVote?.numericValue != null ? String(existingVote.numericValue) : ""
  );
  const [pollSubmitting, setPollSubmitting] = useState(false);
  const [pollVoteError, setPollVoteError] = useState<string | null>(null);
  const [pollVoteSuccess, setPollVoteSuccess] = useState(false);
  const [submittedGuess, setSubmittedGuess] = useState<number | null>(
    existingVote?.numericValue ?? null
  );

  async function handlePollVote() {
    if (pollSubmitting) return;
    const val = parseFloat(pollGuess);
    if (!pollGuess || isNaN(val)) {
      setPollVoteError("Enter a valid number.");
      return;
    }
    setPollSubmitting(true);
    setPollVoteError(null);
    try {
      await mobileApi.castVote(marketId, { numericValue: val });
      setSubmittedGuess(val);
      setPollVoteSuccess(true);
      onRefresh();
    } catch (err: unknown) {
      setPollVoteError(err instanceof Error ? err.message : "Failed to submit guess.");
    } finally {
      setPollSubmitting(false);
    }
  }

  // Host resolution state
  const [resolveOutcome, setResolveOutcome] = useState<"YES" | "NO" | null>(null);
  const [resolveNumericValue, setResolveNumericValue] = useState("");
  const [resolveNote, setResolveNote] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveSuccess, setResolveSuccess] = useState(false);

  async function handleResolve() {
    if (resolving) return;
    if (!isNumeric && !resolveOutcome) {
      Alert.alert("Missing outcome", "Please select YES or NO.");
      return;
    }
    if (isNumeric) {
      const parsed = parseFloat(resolveNumericValue);
      if (!resolveNumericValue || isNaN(parsed)) {
        Alert.alert("Invalid value", "Enter a valid numeric outcome.");
        return;
      }
    }
    if (resolveNote.trim().length < 12) {
      Alert.alert("Note too short", "Resolution note must be at least 12 characters.");
      return;
    }
    setResolving(true);
    try {
      if (isNumeric) {
        await mobileApi.resolveMarket(marketId, {
          actualValue: parseFloat(resolveNumericValue),
          resolutionNote: resolveNote.trim(),
        });
      } else {
        await mobileApi.resolveMarket(marketId, {
          outcome: resolveOutcome ?? undefined,
          resolutionNote: resolveNote.trim(),
        });
      }
      setResolveSuccess(true);
      onRefresh();
    } catch (err: unknown) {
      Alert.alert(
        "Resolution failed",
        err instanceof Error ? err.message : "Unable to submit resolution."
      );
    } finally {
      setResolving(false);
    }
  }

  return (
    <View style={styles.container}>
      {showPendingReviewBanner ? (
        <View style={styles.pendingReviewBanner}>
          <Ionicons name="time-outline" size={18} color={colors.warning as string} />
          <Text style={styles.pendingReviewBannerText}>
            Pending review — only you and moderators can see this market until it&apos;s approved.
          </Text>
        </View>
      ) : null}
      {/* Market info */}
      <View style={styles.card}>
        <View style={styles.topRow}>
          <View style={[styles.badge, isOpen ? styles.badgeOpen : styles.badgeClosed]}>
            <Text style={[styles.badgeText, isOpen ? styles.badgeTextOpen : styles.badgeTextClosed]}>
              {market.status}
            </Text>
          </View>
          {market.category ? (
            <Text style={styles.categoryLabel}>{market.category}</Text>
          ) : null}
        </View>

        <Text style={styles.cardTitle}>{market.title}</Text>
        {market.description ? (
          <LinkifiedText
            text={market.description}
            style={styles.subtitle}
            linkStyle={{ color: colors.accent, textDecorationLine: "underline" }}
          />
        ) : null}

        {isNumeric ? (
          <View style={styles.numericAvgSection}>
            <Text style={styles.numericLabel}>Average Prediction</Text>
            <View style={styles.numericAvgRow}>
              <Text style={styles.numericAvgValue}>
                {market.averageNumericValue != null
                  ? `${Number(market.averageNumericValue).toLocaleString(undefined, { maximumFractionDigits: 2 })}${market.unit ? ` ${market.unit}` : ""}`
                  : "No guesses yet"}
              </Text>
              {(market.totalParticipants ?? 0) > 0 ? (
                <Text style={styles.numericGuessCount}>
                  {market.totalParticipants} {market.totalParticipants === 1 ? "guess" : "guesses"}
                </Text>
              ) : null}
            </View>
            {market.minValue != null && market.maxValue != null ? (
              <>
                <View style={styles.rangeTrack}>
                  {market.averageNumericValue != null ? (
                    <View
                      style={[
                        styles.rangeMarker,
                        {
                          left: `${Math.max(0, Math.min(100, ((market.averageNumericValue - market.minValue) / (market.maxValue - market.minValue)) * 100))}%`,
                        },
                      ]}
                    />
                  ) : null}
                </View>
                <View style={styles.rangeLabels}>
                  <Text style={styles.rangeLabelText}>{market.minValue}{market.unit ? ` ${market.unit}` : ""}</Text>
                  <Text style={styles.rangeLabelText}>{market.maxValue}{market.unit ? ` ${market.unit}` : ""}</Text>
                </View>
              </>
            ) : null}
          </View>
        ) : (
          <View style={styles.probabilitySection}>
            <View style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    width: animatedProb.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["6%", "100%"],
                      extrapolate: "clamp",
                    }),
                  },
                ]}
              />
            </View>
            <View style={styles.probRow}>
              <Text style={styles.probYes}>YES {formatPercent(yesProbability)}</Text>
              <Text style={styles.probNo}>NO {formatPercent(1 - yesProbability)}</Text>
            </View>
            {isOpen ? (
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            ) : null}
          </View>
        )}

        <View style={styles.infoGrid}>
          <InfoItem label="Volume" value={formatPoints(market.totalVolume ?? totalPool)} />
          <InfoItem label="Players" value={String(market.totalParticipants ?? 0)} />
          {market.closeAt ? <InfoItem label={new Date(market.closeAt).getTime() < Date.now() ? "Closed" : "Closes"} value={formatRelativeTime(market.closeAt)} /> : null}
          {market.resolveAt ? <InfoItem label={new Date(market.resolveAt).getTime() < Date.now() ? "Resolved" : "Resolves"} value={formatRelativeTime(market.resolveAt)} /> : null}
        </View>

        {/* Host line — shown for every market, native or admin-imported, so all
            content reads as fully in-house PredictFuture hosting (S-manifold-scrub). */}
        {market.creator?.username ? (
          <View style={styles.hostRow}>
            <Text style={styles.hostLabel}>Hosted by @{market.creator.username}</Text>
            {market.creator.isVerifiedAnalyst === true && <VerifiedBadge compact />}
          </View>
        ) : null}

        {isOpen ? (
          <Pressable
            style={styles.shareLink}
            onPress={() => shareOpenMarket(market.title, market.id)}
          >
            <Text style={styles.shareLinkText}>Share this market</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Existing positions / vote */}
      {hasPosition ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Your Position</Text>
          {positions.map((pos) => (
            <View key={pos.id} style={styles.positionRow}>
              {pos.side ? (
                <View style={[styles.sidePill, pos.side === "YES" ? styles.sidePillYes : styles.sidePillNo]}>
                  <Text style={styles.sidePillText}>{pos.side}</Text>
                </View>
              ) : pos.numericValue != null ? (
                <View style={[styles.sidePill, styles.sidePillNumeric]}>
                  <Text style={styles.sidePillText}>Guess: {pos.numericValue}</Text>
                </View>
              ) : null}
              <Text style={styles.positionAmount}>{formatPoints(pos.amount)} pts</Text>
              <Text style={styles.positionDate}>{formatRelativeTime(pos.createdAt)}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total committed</Text>
            <Text style={styles.totalValue}>{formatPoints(totalCommitted)} pts</Text>
          </View>
          {isOpen ? (
            <Pressable style={styles.addMoreBtn} onPress={onOpenBetSheet}>
              <Text style={styles.addMoreBtnText}>Add More</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Share Result button — resolved markets with a position */}
      {hasPosition && !isOpen && market.winningSide ? (
        <Pressable
          style={styles.shareBtn}
          onPress={() =>
            shareMarketResult({
              title: market.title,
              side: positions[0]?.side ?? null,
              outcome: market.winningSide ?? null,
              amount: totalCommitted,
              marketId,
            })
          }
        >
          <Text style={styles.shareBtnText}>Share Result</Text>
        </Pressable>
      ) : null}

      {/* Percentile rank — resolved markets where the user won */}
      {market.status === "RESOLVED" && data.userPercentileRank != null ? (
        <View style={styles.percentileCard}>
          <Text style={styles.percentileText}>
            {market.category === "FINANCE"
              ? `You beat ${100 - data.userPercentileRank}% of analysts on this call`
              : `You beat ${100 - data.userPercentileRank}% of predictors on this call`}
          </Text>
        </View>
      ) : null}

      {/* Poll notice — no staking for AI-generated polls */}
      {isPoll ? (
        <View style={[styles.card, styles.pollCard]}>
          <Text style={styles.pollTitle}>Community Poll</Text>
          <Text style={styles.pollText}>
            This is an AI-generated opinion poll. Votes are free — no points at stake.
          </Text>
        </View>
      ) : null}

      {/* Numeric poll vote input (stays in scroll body — sticky bar only handles binary polls) */}
      {isPoll && isNumeric && isOpen ? (
        pollVoteSuccess || submittedGuess != null ? (
          <View style={[styles.card, styles.successCard]}>
            <Text style={styles.successTitle}>Guess submitted!</Text>
            <Text style={styles.successText}>
              Your guess: {submittedGuess}{market.unit ? ` ${market.unit}` : ""}
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Enter Your Guess</Text>
            <TextInput
              style={styles.textInput}
              placeholder={
                market.minValue != null && market.maxValue != null
                  ? `Between ${market.minValue} and ${market.maxValue}${market.unit ? ` ${market.unit}` : ""}`
                  : `Enter your guess${market.unit ? ` (${market.unit})` : ""}`
              }
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={pollGuess}
              onChangeText={setPollGuess}
            />
            {pollVoteError ? (
              <Text style={styles.betError}>{pollVoteError}</Text>
            ) : null}
            <Pressable
              style={[styles.placeBetBtn, pollSubmitting && styles.btnDisabled]}
              onPress={handlePollVote}
              disabled={pollSubmitting}
            >
              {pollSubmitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.placeBetText}>Submit Guess</Text>
              )}
            </Pressable>
          </View>
        )
      ) : null}

      {/* Closed state — no position */}
      {!isPoll && isClosed && !hasPosition ? (
        <View style={[styles.card, styles.closedCard]}>
          <Text style={styles.closedText}>This market is no longer accepting bets.</Text>
        </View>
      ) : null}

      {/* Resolution info — always shown when the market has a description.
          A null resolutionRuleText means "same as description" (stored as null server-side). */}
      {market.description ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Resolution Rules</Text>
          {market.resolutionRuleText ? (
            <LinkifiedText
              text={market.resolutionRuleText}
              style={styles.subtitle}
              linkStyle={{ color: colors.accent, textDecorationLine: "underline" }}
            />
          ) : (
            <Text style={[styles.subtitle, { color: colors.textMuted, fontStyle: "italic" }]}>
              Same as description
            </Text>
          )}
        </View>
      ) : null}

      {/* Resolution details — shown only for RESOLVED markets */}
      {market.status === "RESOLVED" && market.resolution ? (
        <ResolutionSection
          resolution={market.resolution}
          winningSide={market.winningSide ?? null}
        />
      ) : null}

      {/* Probability chart — BINARY markets only, shown when snapshots are available (S27-T2) */}
      {market.marketType === "BINARY" && !probHistoryLoading ? (
        <ProbabilityChart
          history={probHistory}
          isResolved={market.status === "RESOLVED"}
          outcome={market.winningSide ?? null}
        />
      ) : null}

      {/* Related Markets rail (S31-T2) */}
      <RelatedMarketsRail currentMarketId={marketId} title={market.title} />

      {/* Analyst Reasoning section — top-5 other analysts' positions with reasoning (S30-T1) */}
      {(data.analystPositions ?? []).length > 0 ? (
        <AnalystPositionsSection
          positions={data.analystPositions ?? []}
          currentUserId={session?.userId ?? null}
        />
      ) : null}

      {/* Comments */}
      <CommentsSection marketId={marketId} isOpen={isOpen} session={session} />

      {/* Host resolution panel */}
      {isResolvable ? (
        resolveSuccess ? (
          <View style={[styles.card, styles.resolveSuccessCard]}>
            <Text style={styles.resolveSuccessTitle}>Market resolved — payouts are processing</Text>
          </View>
        ) : (
          <View style={[styles.card, styles.resolveCard]}>
            <Text style={styles.sectionTitle}>Resolve Market</Text>
            <Text style={styles.resolveHostHint}>
              You are the host. Submit the official outcome below.
            </Text>

            {/* Resolve window — shows when host can act */}
            {market.resolveAt ? (
              <View style={styles.resolveWindowRow}>
                <Ionicons name="time-outline" size={14} color={styles.resolveWindowText.color as string} />
                <Text style={styles.resolveWindowText}>
                  {market.finalResolutionDeadline
                    ? `Resolve window: ${formatDateTime(market.resolveAt)} → ${formatDateTime(market.finalResolutionDeadline)}`
                    : `You can resolve from ${formatDateTime(market.resolveAt)}`}
                </Text>
              </View>
            ) : null}

            {/* Commission preview */}
            {(market.hostCommissionBps ?? 0) > 0 ? (
              <View style={styles.commissionRow}>
                <Text style={styles.commissionLabel}>Your commission if resolved cleanly</Text>
                <Text style={styles.commissionValue}>
                  {formatPoints(
                    Math.floor(
                      ((market.totalVolume ?? 0) * (market.hostCommissionBps ?? 0)) / 10000
                    )
                  )}{" "}
                  pts
                </Text>
              </View>
            ) : null}

            {/* Binary outcome selection */}
            {!isNumeric ? (
              <View style={styles.sideRow}>
                <Pressable
                  style={[
                    styles.sideBtn,
                    styles.sideBtnYes,
                    resolveOutcome === "YES" && styles.sideBtnYesActive,
                  ]}
                  onPress={() => setResolveOutcome("YES")}
                >
                  <Text
                    style={[
                      styles.sideBtnText,
                      resolveOutcome === "YES" && styles.sideBtnTextActive,
                    ]}
                  >
                    YES
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.sideBtn,
                    styles.sideBtnNo,
                    resolveOutcome === "NO" && styles.sideBtnNoActive,
                  ]}
                  onPress={() => setResolveOutcome("NO")}
                >
                  <Text
                    style={[
                      styles.sideBtnText,
                      resolveOutcome === "NO" && styles.sideBtnTextActive,
                    ]}
                  >
                    NO
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {/* Numeric outcome input */}
            {isNumeric ? (
              <View style={styles.numericSection}>
                <Text style={styles.inputLabel}>
                  Actual outcome{market.unit ? ` (${market.unit})` : ""}
                </Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="Enter the actual value"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  value={resolveNumericValue}
                  onChangeText={setResolveNumericValue}
                />
              </View>
            ) : null}

            {/* Resolution note */}
            <Text style={[styles.inputLabel, { marginTop: spacing.lg }]}>
              Resolution note (min 12 chars)
            </Text>
            <TextInput
              style={[styles.textInput, styles.resolveNoteInput]}
              placeholder="Describe why the market resolves this way…"
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={3}
              value={resolveNote}
              onChangeText={setResolveNote}
            />

            <Pressable
              style={[styles.resolveConfirmBtn, (!canResolve || resolving) && styles.btnDisabled]}
              onPress={handleResolve}
              disabled={!canResolve || resolving}
            >
              {resolving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.resolveConfirmText}>Confirm Resolution</Text>
              )}
            </Pressable>

            {/* Timing hint — only shown when resolve time hasn't been reached yet */}
            {!canResolve && market.resolveAt ? (
              <Text style={styles.resolveNotYetHint}>
                Resolvable from {formatDateTime(market.resolveAt)}
              </Text>
            ) : null}
          </View>
        )
      ) : null}
    </View>
  );
}

// ─── ResolutionSection ───────────────────────────────────────────────────────

type ResolutionData = {
  rationale: string;
  resolvedBy: { username: string } | null;
  createdAt: string;
  wasOverturned: boolean;
};

function ResolutionSection({
  resolution,
  winningSide,
}: {
  resolution: ResolutionData;
  winningSide: string | null;
}) {
  const styles = useThemedStyles(makeStyles);
  const outcomeLabel = winningSide ? `Resolved ${winningSide}` : "Resolved";
  const isYes = winningSide === "YES";
  const isNo = winningSide === "NO";

  const resolvedDate = new Date(resolution.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Resolution</Text>

        {/* Outcome badge row */}
        <View style={styles.resolutionHeaderRow}>
          <View
            style={[
              styles.resolutionOutcomeBadge,
              isYes
                ? styles.resolutionOutcomeBadgeYes
                : isNo
                ? styles.resolutionOutcomeBadgeNo
                : styles.resolutionOutcomeBadgeNeutral,
            ]}
          >
            <Text
              style={[
                styles.resolutionOutcomeBadgeText,
                isYes
                  ? styles.resolutionOutcomeBadgeTextYes
                  : isNo
                  ? styles.resolutionOutcomeBadgeTextNo
                  : styles.resolutionOutcomeBadgeTextNeutral,
              ]}
            >
              {outcomeLabel}
            </Text>
          </View>

          {resolution.wasOverturned ? (
            <View style={styles.overturnedBadge}>
              <Text style={styles.overturnedBadgeText}>Overturned by admin</Text>
            </View>
          ) : null}
        </View>

        {/* Resolver identity and date */}
        <Text style={styles.resolutionMeta}>
          {resolution.resolvedBy
            ? `Resolved by @${resolution.resolvedBy.username} on ${resolvedDate}`
            : `Resolved on ${resolvedDate}`}
        </Text>
      </View>

      {/* Rationale card — only if non-empty */}
      {resolution.rationale.trim().length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Resolution Rationale</Text>
          <Text style={styles.subtitle}>{resolution.rationale}</Text>
        </View>
      ) : null}
    </>
  );
}

// ─── InfoItem ─────────────────────────────────────────────────────────────────

function InfoItem({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.infoItem}>
      <Text style={styles.infoValue}>{value}</Text>
      <Text style={styles.infoLabel}>{label}</Text>
    </View>
  );
}

// ─── RelatedMarketsRail (S31-T2) ─────────────────────────────────────────────

function RelatedMarketsRail({ currentMarketId, title }: { currentMarketId: string; title: string }) {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const relatedStyles = useThemedStyles(makeRelatedStyles);
  const [markets, setMarkets] = useState<ApiMarketSummary[]>([]);

  useEffect(() => {
    if (!title) return;
    const queryWords = title.split(/\s+/).slice(0, 3).join(" ");
    if (!queryWords) return;
    mobileApi.getPublicMarkets({ q: queryWords, limit: 6 })
      .then((res) => {
        // Exclude the current market from results
        const filtered = (res.markets ?? []).filter((m) => m.id !== currentMarketId);
        setMarkets(filtered);
      })
      .catch(() => setMarkets([]));
  }, [currentMarketId, title]);

  if (markets.length === 0) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Related Markets</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={relatedStyles.scrollContent}
      >
        {markets.map((m) => {
          const yesP = (m.yesPool ?? 0) + (m.noPool ?? 0) > 0
            ? (m.yesPool ?? 0) / ((m.yesPool ?? 0) + (m.noPool ?? 0))
            : m.externalProbability ?? 0.5;
          return (
            <Pressable
              key={m.id}
              style={({ pressed }) => [relatedStyles.card, pressed && { opacity: 0.8 }]}
              onPress={() => router.push(`/market/${m.id}`)}
            >
              {m.category ? (
                <View style={relatedStyles.catBadge}>
                  <Text style={relatedStyles.catText}>{m.category}</Text>
                </View>
              ) : null}
              <Text style={relatedStyles.title} numberOfLines={2}>{m.title}</Text>
              <View style={relatedStyles.probRow}>
                <View style={relatedStyles.probTrack}>
                  <View style={[relatedStyles.probFill, { width: `${Math.max(6, yesP * 100)}%` }]} />
                </View>
                <Text style={relatedStyles.probLabel}>YES {Math.round(yesP * 100)}%</Text>
              </View>
              <Text style={relatedStyles.players}>{m.totalParticipants ?? 0} players</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeRelatedStyles = (t: ThemeContextValue) => StyleSheet.create({
  scrollContent: { gap: 10, paddingVertical: 4 },
  card: {
    width: 160,
    backgroundColor: t.colors.background,
    borderRadius: radius.md,
    padding: 10,
    borderWidth: 1,
    borderColor: t.colors.border,
    gap: 6,
  },
  catBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: t.colors.surfaceMuted,
  },
  catText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.4,
    color: t.colors.accent,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 12,
    fontWeight: "700",
    color: t.colors.text,
    lineHeight: 17,
  },
  probRow: { gap: 4 },
  probTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: t.colors.dangerSoft,
    overflow: "hidden",
  },
  probFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: "#16A34A",
  },
  probLabel: { fontSize: 10, fontWeight: "700", color: "#16A34A" },
  players: { fontSize: 10, color: t.colors.textMuted },
});

// ─── ProbabilityChart (S27-T2 + interactive drag inspector) ──────────────────
// View-based consensus-line chart with Manifold/Robinhood-style interactive
// pan-to-inspect: drag finger across the chart to see probability + date at
// that point. Includes time-range filter pills (1D / 7D / 1M / All).
// Only shown for BINARY markets with >= 2 snapshots.

const CHART_HEIGHT = 140;
const CHART_LABEL_WIDTH = 32;
const CHART_PADDING_V = 14;

type RangeKey = "1D" | "7D" | "1M" | "ALL";
const RANGE_OPTIONS: { key: RangeKey; label: string; ms: number | null }[] = [
  { key: "1D", label: "1D", ms: 24 * 60 * 60 * 1000 },
  { key: "7D", label: "7D", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "1M", label: "1M", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "ALL", label: "All", ms: null },
];

function ProbabilityChart({
  history,
  isResolved,
  outcome,
}: {
  history: ApiProbabilityHistory | null;
  isResolved: boolean;
  outcome: string | null;
}) {
  const styles = useThemedStyles(makeStyles);
  const [chartWidth, setChartWidth] = useState(0);
  const [touchX, setTouchX] = useState<number | null>(null);
  const [range, setRange] = useState<RangeKey>("ALL");

  if (!history || history.snapshots.length < 2) {
    return (
      <View style={styles.probChartCard}>
        <Text style={styles.probChartTitle}>Consensus shift</Text>
        <Text style={styles.probChartEmpty}>Probability history not yet available</Text>
      </View>
    );
  }

  // Filter by selected range relative to the latest snapshot
  const allSnaps = history.snapshots;
  const latestAt = new Date(allSnaps[allSnaps.length - 1]!.at).getTime();
  const rangeMs = RANGE_OPTIONS.find((r) => r.key === range)?.ms ?? null;
  const filtered = rangeMs != null
    ? allSnaps.filter((s) => latestAt - new Date(s.at).getTime() <= rangeMs)
    : allSnaps;
  // Ensure at least 2 points; fall back to ALL if filter too tight
  const displayBase = filtered.length >= 2 ? filtered : allSnaps;

  const displayPoints = [...displayBase];
  if (isResolved && history.resolvedProbability !== null) {
    displayPoints.push({
      at: displayPoints[displayPoints.length - 1]?.at ?? new Date().toISOString(),
      probability: history.resolvedProbability,
    });
  }

  const n = displayPoints.length;
  const firstAt = new Date(displayPoints[0]!.at).getTime();
  const lastAt = new Date(displayPoints[n - 1]!.at).getTime();
  const totalDuration = Math.max(lastAt - firstAt, 1);

  const innerH = CHART_HEIGHT - CHART_PADDING_V * 2;
  const innerW = chartWidth - CHART_LABEL_WIDTH;

  function toXY(snap: { at: string; probability: number }, index: number) {
    const t = new Date(snap.at).getTime();
    const x =
      n <= 1
        ? (index === 0 ? 0 : innerW)
        : ((t - firstAt) / totalDuration) * innerW;
    const y = CHART_PADDING_V + (1 - snap.probability) * innerH;
    return { x, y };
  }

  const points = displayPoints.map((s, i) => ({ ...toXY(s, i), prob: s.probability, at: s.at }));

  const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push({
      x1: points[i]!.x,
      y1: points[i]!.y,
      x2: points[i + 1]!.x,
      y2: points[i + 1]!.y,
    });
  }

  const thresholdY = CHART_PADDING_V + (1 - 0.5) * innerH;

  // ── Interactive: find nearest point to touchX ──
  const inspected = touchX != null
    ? points.reduce((best, p) => (Math.abs(p.x - touchX) < Math.abs(best.x - touchX) ? p : best), points[0]!)
    : null;

  // PanResponder reads innerW via ref so it isn't captured stale when chartWidth was 0.
  const innerWRef = useRef(innerW);
  innerWRef.current = innerW;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 4,
      onMoveShouldSetPanResponderCapture: (_, gs) => Math.abs(gs.dx) > Math.abs(gs.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const x = e.nativeEvent.locationX;
        const w = innerWRef.current;
        if (typeof x === "number" && w > 0) setTouchX(Math.max(0, Math.min(w, x)));
      },
      onPanResponderMove: (e) => {
        const x = e.nativeEvent.locationX;
        const w = innerWRef.current;
        if (typeof x === "number" && w > 0) setTouchX(Math.max(0, Math.min(w, x)));
      },
      onPanResponderRelease: () => setTouchX(null),
      onPanResponderTerminate: () => setTouchX(null),
    })
  ).current;

  const firstDate = new Date(displayPoints[0]!.at).toLocaleDateString("en-IN", { month: "short", day: "numeric" });
  const lastDate = new Date(displayPoints[n - 1]!.at).toLocaleDateString("en-IN", { month: "short", day: "numeric" });

  const lastPoint = points[n - 1]!;
  const currentPct = Math.round((inspected?.prob ?? lastPoint.prob) * 100);
  const headlineDate = inspected
    ? new Date(inspected.at).toLocaleString("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : isResolved
      ? "Final"
      : "Latest";

  return (
    <View style={styles.probChartCard}>
      <View style={styles.probChartHeader}>
        <Text style={styles.probChartTitle}>Consensus shift</Text>
        <View style={styles.probChartHeadlineRow}>
          <Text style={styles.probChartHeadlinePct}>{currentPct}% YES</Text>
          <Text style={styles.probChartHeadlineDate}>{headlineDate}</Text>
        </View>
        {isResolved && outcome && !inspected ? (
          <View
            style={[
              styles.probChartFinalBadge,
              { backgroundColor: outcome === "YES" ? "rgba(22,163,74,0.12)" : "rgba(220,38,38,0.12)" },
            ]}
          >
            <Text
              style={[
                styles.probChartFinalBadgeText,
                { color: outcome === "YES" ? "#16a34a" : "#dc2626" },
              ]}
            >
              ✓ Resolved {outcome}
            </Text>
          </View>
        ) : null}
      </View>

      <View
        style={[styles.probChartArea, { height: CHART_HEIGHT + 24 }]}
        onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)}
      >
        <View style={[styles.probChartYLabels, { width: CHART_LABEL_WIDTH, height: CHART_HEIGHT }]}>
          <Text style={styles.probChartYLabel}>100%</Text>
          <Text style={[styles.probChartYLabel, { marginTop: "auto" }]}>0%</Text>
        </View>

        {chartWidth > 0 ? (
          <View
            style={[styles.probChartCanvas, { width: innerW, height: CHART_HEIGHT }]}
            {...panResponder.panHandlers}
          >
            {Array.from({ length: Math.floor(innerW / 10) }).map((_, i) => (
              <View key={`dash-${i}`} style={[styles.probChartDash, { left: i * 10, top: thresholdY - 0.5 }]} />
            ))}

            {segments.map((seg, i) => {
              const dx = seg.x2 - seg.x1;
              const dy = seg.y2 - seg.y1;
              const length = Math.sqrt(dx * dx + dy * dy);
              const angle = Math.atan2(dy, dx) * (180 / Math.PI);
              return (
                <View
                  key={`seg-${i}`}
                  style={[
                    styles.probChartSegment,
                    { left: seg.x1, top: seg.y1, width: length, transform: [{ rotate: `${angle}deg` }] },
                  ]}
                />
              );
            })}

            <View style={[styles.probChartDot, { left: (points[0]?.x ?? 0) - 3, top: (points[0]?.y ?? 0) - 3 }]} />
            <View style={[styles.probChartDot, { left: lastPoint.x - 3, top: lastPoint.y - 3 }]} />

            {/* Inspector hairline + dot when touched */}
            {inspected ? (
              <>
                <View style={[styles.probChartHairline, { left: inspected.x, height: CHART_HEIGHT }]} />
                <View
                  style={[
                    styles.probChartInspectDot,
                    { left: inspected.x - 5, top: inspected.y - 5 },
                  ]}
                />
              </>
            ) : null}

            {isResolved && outcome ? (
              <View
                style={[
                  styles.probChartOutcomeMarker,
                  {
                    left: Math.max(0, lastPoint.x - 20),
                    top: lastPoint.y - 22,
                    backgroundColor: outcome === "YES" ? "#16a34a" : "#dc2626",
                  },
                ]}
              >
                <Text style={styles.probChartOutcomeText}>{outcome}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={[styles.probChartXLabels, { paddingLeft: CHART_LABEL_WIDTH }]}>
        <Text style={styles.probChartXLabel}>{firstDate}</Text>
        <Text style={styles.probChartXLabel}>{lastDate}</Text>
      </View>

      {/* Time range pills */}
      <View style={styles.probChartRangeRow}>
        {RANGE_OPTIONS.map((opt) => {
          const active = range === opt.key;
          return (
            <Pressable
              key={opt.key}
              onPress={() => setRange(opt.key)}
              style={[styles.probChartRangePill, active && styles.probChartRangePillActive]}
            >
              <Text style={[styles.probChartRangeText, active && styles.probChartRangeTextActive]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── CommentsSection ──────────────────────────────────────────────────────────

type CommenterPosition =
  | { kind: "binary"; side: "YES" | "NO"; amount: number }
  | { kind: "multi-choice"; optionId: string; optionLabel: string; amount: number }
  | { kind: "numeric"; value: number; amount: number };

type CommentItem = {
  id: string;
  content: string;
  createdAt: string;
  tipsReceived: number;
  user: { id: string; username: string; isVerifiedAnalyst?: boolean };
  commenterPosition?: CommenterPosition | null;
};

/** Small pill badge showing commenter's market position ('skin in the game'). */
function PositionBadge({ pos }: { pos: CommenterPosition }) {
  const { colors, isDark } = useTheme();
  let label: string;
  let bgColor: string;
  let textColor: string;

  if (pos.kind === "binary") {
    label = `Holds ${pos.side} — ${pos.amount} pts`;
    bgColor = pos.side === "YES" ? colors.successSoft : colors.dangerSoft;
    textColor = pos.side === "YES" ? colors.success : colors.danger;
  } else if (pos.kind === "multi-choice") {
    label = `Holds ${pos.optionLabel} — ${pos.amount} pts`;
    bgColor = isDark ? "#1E1B38" : "#EDE9FE";
    textColor = isDark ? "#A78BFA" : "#4C1D95";
  } else {
    label = `Predicted ${pos.value} — ${pos.amount} pts`;
    bgColor = colors.accentSoft;
    textColor = colors.accent;
  }

  return (
    <View style={{ backgroundColor: bgColor, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, alignSelf: "flex-start", marginTop: 2 }}>
      <Text style={{ fontSize: 11, fontWeight: "600", color: textColor }}>{label}</Text>
    </View>
  );
}

const AVATAR_COLORS = ["#6366F1", "#EC4899", "#F59E0B", "#10B981", "#3B82F6", "#EF4444"];

function avatarColorForUsername(username: string): string {
  let hash = 0;
  for (let i = 0; i < Math.min(username.length, 7); i++) {
    hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] as string;
}

function CommentsSection({
  marketId,
  isOpen,
  session,
}: {
  marketId: string;
  isOpen: boolean;
  session: Session | null;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const fetcher = useCallback(
    () => mobileApi.getMarketComments(marketId),
    [marketId]
  );

  const { data, refetch } = useApiQuery<{ comments: CommentItem[] }>(fetcher, [marketId]);

  const [localComments, setLocalComments] = useState<CommentItem[]>([]);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tippingCommentId, setTippingCommentId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Sync local list from server data
  useEffect(() => {
    if (data?.comments) {
      setLocalComments(data.comments);
    }
  }, [data]);

  // Auto-dismiss toast after 2 seconds
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const canPost = isOpen && session != null;
  const charsLeft = 500 - commentText.length;

  async function handlePost() {
    if (submitting || !commentText.trim() || !session) return;

    const optimisticComment: CommentItem = {
      id: `optimistic-${Date.now()}`,
      content: commentText.trim(),
      createdAt: new Date().toISOString(),
      tipsReceived: 0,
      user: { id: session.userId, username: session.username, isVerifiedAnalyst: false },
    };

    const textToPost = commentText.trim();
    setLocalComments((prev) => [optimisticComment, ...prev]);
    setCommentText("");
    setSubmitting(true);

    try {
      await mobileApi.postMarketComment(marketId, { content: textToPost });
      void refetch();
    } catch {
      // Revert optimistic update
      setLocalComments((prev) => prev.filter((c) => c.id !== optimisticComment.id));
      setCommentText(textToPost);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTip(commentId: string) {
    if (!session || tippingCommentId === commentId) return;
    setTippingCommentId(commentId);
    try {
      const result = await mobileApi.tipComment(commentId, 5);
      if (result.ok) {
        // Update local tipsReceived count
        setLocalComments((prev) =>
          prev.map((c) =>
            c.id === commentId
              ? { ...c, tipsReceived: result.newTipsReceived }
              : c
          )
        );
        setToastMessage("+5 pts tipped!");
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Could not send tip.";
      if (message.toLowerCase().includes("daily tip limit")) {
        Alert.alert("Daily tip limit reached", "You've used all 50 tip pts for today.");
      } else {
        setToastMessage(message);
      }
    } finally {
      setTippingCommentId(null);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>
        Comments ({localComments.length})
      </Text>

      {/* Toast overlay */}
      {toastMessage != null && (
        <View style={styles.commentToast}>
          <Text style={styles.commentToastText}>{toastMessage}</Text>
        </View>
      )}

      {localComments.length === 0 ? (
        <Text style={styles.commentsEmpty}>No comments yet. Be the first!</Text>
      ) : (
        localComments.map((comment) => {
          // Show tip button only when: authenticated AND not the comment author
          const canTip = session != null && comment.user.id !== session.userId;
          const isTipping = tippingCommentId === comment.id;

          return (
            <View key={comment.id} style={styles.commentRow}>
              <View
                style={[
                  styles.commentAvatar,
                  { backgroundColor: avatarColorForUsername(comment.user.username) },
                ]}
              >
                <Text style={styles.commentAvatarText}>
                  {comment.user.username.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.commentBody}>
                <View style={styles.commentMeta}>
                  <View style={styles.commentAuthorRow}>
                    <Pressable
                      onPress={() => router.push(`/user/${comment.user.username}`)}
                      hitSlop={4}
                    >
                      <Text style={styles.commentUsername}>@{comment.user.username}</Text>
                    </Pressable>
                    {comment.user.isVerifiedAnalyst === true && <VerifiedBadge compact />}
                  </View>
                  <View style={styles.commentTimeRow}>
                    <Text style={styles.commentTime}>
                      {formatRelativeTime(comment.createdAt)}
                    </Text>
                    {canTip && (
                      <Pressable
                        style={[styles.tipBtn, isTipping && styles.tipBtnDisabled]}
                        onPress={() => { void handleTip(comment.id); }}
                        disabled={isTipping}
                        hitSlop={6}
                      >
                        {isTipping ? (
                          <ActivityIndicator size="small" color={colors.textMuted as string} />
                        ) : (
                          <Ionicons name="gift-outline" size={15} color={colors.textMuted as string} />
                        )}
                      </Pressable>
                    )}
                  </View>
                </View>
                {comment.commenterPosition != null && (
                  <PositionBadge pos={comment.commenterPosition} />
                )}
                <Text style={styles.commentContent}>{comment.content}</Text>
                {comment.tipsReceived > 0 && (
                  <Text style={styles.commentTipsLine}>
                    {`🎁 ${comment.tipsReceived} pts received`}
                  </Text>
                )}
              </View>
            </View>
          );
        })
      )}

      {canPost ? (
        <View style={styles.commentInputRow}>
          <TextInput
            style={styles.commentInput}
            placeholder="Add a comment..."
            placeholderTextColor={colors.textMuted}
            multiline={false}
            maxLength={500}
            value={commentText}
            onChangeText={setCommentText}
          />
          <Text style={styles.commentCharsLeft}>{charsLeft}</Text>
          <Pressable
            style={[
              styles.commentPostBtn,
              (!commentText.trim() || submitting) && styles.btnDisabled,
            ]}
            onPress={handlePost}
            disabled={!commentText.trim() || submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.commentPostText}>Post</Text>
            )}
          </Pressable>
        </View>
      ) : !isOpen ? (
        <Text style={styles.commentsClosedNote}>Predictions are closed</Text>
      ) : (
        <Text style={styles.commentsSignInNote}>Sign in to comment</Text>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  // Root layout
  root: {
    flex: 1,
    backgroundColor: t.colors.background,
  },
  screen: {
    flex: 1,
    backgroundColor: t.colors.background,
  },
  content: {
    padding: spacing.lg,
  },
  container: {
    gap: spacing.lg,
  },
  pendingReviewBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: t.colors.warningSoft,
    borderLeftWidth: 4,
    borderLeftColor: t.colors.warning,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  pendingReviewBannerText: {
    flex: 1,
    color: t.colors.warning,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  },
  centerState: {
    paddingTop: 100,
    alignItems: "center",
  },

  // ── Cards ──
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    ...t.shadows.card,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  badgeOpen: { backgroundColor: t.colors.successSoft },
  badgeClosed: { backgroundColor: t.colors.surfaceMuted },
  badgeText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  badgeTextOpen: { color: t.colors.success },
  badgeTextClosed: { color: t.colors.textMuted },
  categoryLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: t.colors.textMuted,
  },
  cardTitle: {
    marginTop: spacing.md,
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 28,
    color: t.colors.text,
  },
  subtitle: {
    marginTop: spacing.sm,
    fontSize: 15,
    lineHeight: 22,
    color: t.colors.textMuted,
  },

  // ── Numeric avg ──
  numericAvgSection: {
    marginTop: spacing.xl,
  },
  numericLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: t.colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  numericAvgRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 4,
  },
  numericAvgValue: {
    fontSize: 26,
    fontWeight: "800",
    color: t.colors.primary,
  },
  numericGuessCount: {
    fontSize: 13,
    color: t.colors.textMuted,
  },
  rangeTrack: {
    marginTop: spacing.md,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: t.colors.accentSoft,
    position: "relative",
    overflow: "visible",
  },
  rangeMarker: {
    position: "absolute",
    top: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: t.colors.primary,
    marginLeft: -8,
    borderWidth: 2,
    borderColor: t.colors.background,
  },
  rangeLabels: {
    marginTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rangeLabelText: {
    fontSize: 12,
    color: t.colors.textMuted,
  },

  // ── Probability bar ──
  probabilitySection: {
    marginTop: spacing.xl,
  },
  progressTrack: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: t.colors.dangerSoft,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: "#16A34A",
  },
  probRow: {
    marginTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  probYes: {
    fontSize: 14,
    fontWeight: "700",
    color: "#16A34A",
  },
  probNo: {
    fontSize: 14,
    fontWeight: "700",
    color: "#DC2626",
  },

  // ── Info grid ──
  infoGrid: {
    marginTop: spacing.xl,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
  },
  infoItem: {
    alignItems: "center",
    minWidth: 70,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: "700",
    color: t.colors.text,
  },
  infoLabel: {
    fontSize: 11,
    color: t.colors.textMuted,
    marginTop: 2,
  },
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.lg,
  },
  hostLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: t.colors.accent,
  },

  // ── Positions ──
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: t.colors.text,
    marginBottom: spacing.md,
  },
  positionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  sidePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  sidePillYes: { backgroundColor: t.colors.successSoft },
  sidePillNo: { backgroundColor: t.colors.dangerSoft },
  sidePillNumeric: { backgroundColor: t.colors.accentSoft },
  sidePillText: {
    fontSize: 13,
    fontWeight: "700",
    color: t.colors.text,
  },
  positionAmount: {
    fontSize: 14,
    fontWeight: "700",
    color: t.colors.text,
    flex: 1,
  },
  positionDate: {
    fontSize: 12,
    color: t.colors.textMuted,
  },
  totalRow: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: t.colors.textMuted,
  },
  totalValue: {
    fontSize: 16,
    fontWeight: "800",
    color: t.colors.text,
  },
  addMoreBtn: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: t.colors.primary,
  },
  addMoreBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: t.colors.primary,
  },

  // ── Betting panel (inside sheet) ──
  sideRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  sideBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: radius.md,
    alignItems: "center",
    borderWidth: 2,
  },
  sideBtnYes: {
    borderColor: "#16A34A",
    backgroundColor: "#16A34A",
  },
  sideBtnYesActive: {
    borderColor: "#15803D",
    backgroundColor: "#15803D",
  },
  sideBtnNo: {
    borderColor: "#DC2626",
    backgroundColor: "#DC2626",
  },
  sideBtnNoActive: {
    borderColor: "#B91C1C",
    backgroundColor: "#B91C1C",
  },
  sideBtnText: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 1,
    color: "#FFFFFF",
  },
  sideBtnTextActive: {
    color: "#FFFFFF",
  },
  sideProb: {
    marginTop: 4,
    fontSize: 13,
    // Sits on the solid green/red button, so a dimmed white reads in both modes
    // (was textMuted grey → invisible on the colored fill).
    color: "rgba(255,255,255,0.9)",
    fontWeight: "600",
  },
  lockedSideRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  lockedLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: t.colors.text,
  },
  lockedValue: {
    fontSize: 16,
    fontWeight: "700",
    color: t.colors.primary,
  },
  lockedHint: {
    fontSize: 13,
    color: t.colors.textMuted,
  },
  numericSection: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: t.colors.text,
    marginBottom: spacing.sm,
  },
  textInput: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: t.colors.text,
    backgroundColor: t.colors.surface,
  },
  presetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  presetPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: t.colors.surfaceMuted,
  },
  presetPillActive: {
    backgroundColor: t.colors.accent,
  },
  presetText: {
    fontSize: 14,
    fontWeight: "700",
    color: t.colors.text,
  },
  presetTextActive: {
    color: "#FFFFFF",
  },
  estimatedReturnRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.md,
  },
  estimatedReturnLabel: {
    fontSize: 14,
    color: t.colors.textMuted,
  },
  estimatedReturnValue: {
    fontSize: 14,
    fontWeight: "700",
    color: t.colors.text,
  },
  betError: {
    marginTop: spacing.sm,
    fontSize: 13,
    color: t.colors.danger,
  },
  reasoningToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.border,
  },
  reasoningToggleLabel: {
    flex: 1,
    fontSize: 13,
    color: t.colors.textMuted,
  },
  reasoningInputWrapper: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  reasoningInput: {
    fontSize: 14,
    color: t.colors.text,
    minHeight: 72,
    lineHeight: 20,
  },
  reasoningCounter: {
    fontSize: 11,
    color: t.colors.textMuted,
    textAlign: "right",
    marginTop: spacing.xs,
  },
  placeBetBtn: {
    marginTop: spacing.lg,
  },
  placeBetText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#fff",
  },
  btnDisabled: {
    opacity: 0.5,
  },

  // ── Success state ──
  successCard: {
    backgroundColor: t.colors.successSoft,
    borderWidth: 1,
    borderColor: t.colors.success,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: t.colors.success,
  },
  successText: {
    marginTop: spacing.sm,
    fontSize: 14,
    lineHeight: 20,
    color: t.colors.success,
  },

  // ── Poll notice ──
  pollCard: {
    backgroundColor: t.colors.accentSoft,
    borderWidth: 1,
    borderColor: t.isDark ? t.colors.accentDeep : "#BFDBFE",
  },
  pollTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: t.colors.accent,
    marginBottom: spacing.sm,
  },
  pollText: {
    fontSize: 14,
    lineHeight: 20,
    color: t.colors.accent,
  },

  // ── Closed ──
  closedCard: {
    backgroundColor: t.colors.surfaceMuted,
  },
  closedText: {
    fontSize: 15,
    fontWeight: "600",
    color: t.colors.textMuted,
    textAlign: "center",
  },

  // ── Share ──
  shareBtn: {
    marginTop: spacing.sm,
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: t.colors.accent,
    alignItems: "center",
  },
  shareBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: t.colors.accent,
  },
  shareLink: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
  },
  shareLinkText: {
    fontSize: 13,
    fontWeight: "600",
    color: t.colors.accent,
    textDecorationLine: "underline",
  },

  // ── Live badge ──
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginTop: spacing.sm,
    gap: 5,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#16A34A",
  },
  liveText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    color: "#16A34A",
    textTransform: "uppercase",
  },

  // ── Error / retry ──
  error: {
    color: t.colors.danger,
  },
  retryBtn: {
    marginTop: spacing.lg,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: t.colors.accent,
  },
  retryLabel: {
    color: t.colors.surface,
    fontWeight: "700",
    fontSize: 14,
  },

  // ── Resolution section (resolved market display) ──
  resolutionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  resolutionOutcomeBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  resolutionOutcomeBadgeYes: {
    backgroundColor: t.colors.successSoft,
    borderWidth: 1,
    borderColor: t.colors.success,
  },
  resolutionOutcomeBadgeNo: {
    backgroundColor: t.colors.dangerSoft,
    borderWidth: 1,
    borderColor: t.colors.danger,
  },
  resolutionOutcomeBadgeNeutral: {
    backgroundColor: t.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  resolutionOutcomeBadgeText: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  resolutionOutcomeBadgeTextYes: {
    color: t.colors.success,
  },
  resolutionOutcomeBadgeTextNo: {
    color: t.isDark ? t.colors.danger : "#DC2626",
  },
  resolutionOutcomeBadgeTextNeutral: {
    color: t.colors.textMuted,
  },
  overturnedBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: t.colors.warningSoft,
    borderWidth: 1,
    borderColor: t.colors.warning,
  },
  overturnedBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: t.colors.warning,
  },
  resolutionMeta: {
    fontSize: 14,
    lineHeight: 20,
    color: t.colors.textMuted,
    fontWeight: "500",
  },

  // ── Host resolution panel ──
  resolveCard: {
    borderWidth: 1.5,
    borderColor: t.colors.warning,
    backgroundColor: t.colors.warningSoft,
  },
  resolveHostHint: {
    fontSize: 14,
    color: t.colors.warning,
    marginBottom: spacing.lg,
  },
  commissionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: t.isDark ? "rgba(245,158,11,0.12)" : "#FEF3C7",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  commissionLabel: {
    fontSize: 13,
    color: t.colors.warning,
    flex: 1,
    marginRight: spacing.sm,
  },
  commissionValue: {
    fontSize: 14,
    fontWeight: "800",
    color: t.colors.warning,
  },
  resolveNoteInput: {
    height: 80,
    paddingTop: spacing.sm,
    textAlignVertical: "top",
  },
  resolveWindowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.md,
    paddingVertical: spacing.xs,
  },
  resolveWindowText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
    color: t.colors.warning,
    lineHeight: 18,
  },
  resolveNotYetHint: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: t.colors.textMuted,
    textAlign: "center",
  },
  resolveConfirmBtn: {
    marginTop: spacing.lg,
    paddingVertical: 16,
    borderRadius: radius.md,
    backgroundColor: t.colors.warning,
    alignItems: "center",
  },
  resolveConfirmText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#fff",
  },
  resolveSuccessCard: {
    backgroundColor: t.colors.successSoft,
    borderWidth: 1,
    borderColor: t.colors.success,
  },
  resolveSuccessTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: t.colors.success,
    textAlign: "center",
  },

  // ── Comments ──
  commentsEmpty: {
    fontSize: 14,
    color: t.colors.textMuted,
    textAlign: "center",
    paddingVertical: spacing.md,
  },
  commentRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
  },
  commentAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  commentAvatarText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
  commentBody: {
    flex: 1,
  },
  commentMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  commentAuthorRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  commentUsername: {
    fontSize: 13,
    fontWeight: "700",
    color: t.colors.text,
  },
  commentTime: {
    fontSize: 12,
    color: t.colors.textMuted,
  },
  commentContent: {
    fontSize: 14,
    lineHeight: 20,
    color: t.colors.text,
  },
  commentInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
  },
  commentInput: {
    flex: 1,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    color: t.colors.text,
    backgroundColor: t.colors.surface,
  },
  commentCharsLeft: {
    fontSize: 12,
    color: t.colors.textMuted,
    minWidth: 28,
    textAlign: "right",
  },
  commentPostBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: t.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 52,
  },
  commentPostText: {
    fontSize: 14,
    fontWeight: "700",
    color: t.colors.background,
  },
  commentsClosedNote: {
    marginTop: spacing.md,
    fontSize: 13,
    color: t.colors.textMuted,
    textAlign: "center",
  },
  commentsSignInNote: {
    marginTop: spacing.md,
    fontSize: 13,
    color: t.colors.textMuted,
    textAlign: "center",
  },
  commentTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  tipBtn: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 22,
    minHeight: 22,
  },
  tipBtnDisabled: {
    opacity: 0.5,
  },
  commentTipsLine: {
    fontSize: 11,
    color: t.colors.textMuted,
    marginTop: 4,
  },
  commentToast: {
    backgroundColor: "#1F2937",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignSelf: "center",
    marginBottom: spacing.sm,
  },
  commentToastText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },

  // ── Sticky betting bar ──
  stickyBar: {
    backgroundColor: t.colors.surface,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    ...t.shadows.card,
  },
  stickyBarInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: STICKY_BAR_HEIGHT - spacing.md,
    gap: spacing.md,
  },
  stickyBarLeft: {
    flex: 1,
    gap: spacing.xs,
  },
  stickyProbLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: t.colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  stickyProbValue: {
    fontSize: 20,
    fontWeight: "800",
    color: "#16A34A",
  },
  stickyPositionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: 2,
  },
  stickyPosPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  stickyPosPillYes: { backgroundColor: t.colors.successSoft },
  stickyPosPillNo: { backgroundColor: t.colors.dangerSoft },
  stickyPosPillNumeric: { backgroundColor: t.colors.accentSoft },
  stickyPosPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: t.colors.text,
  },
  stickyPositionAmount: {
    fontSize: 13,
    fontWeight: "600",
    color: t.colors.textMuted,
  },
  stickyPositionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: t.colors.textMuted,
  },
  predictBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: t.colors.primary,
    alignItems: "center",
    minWidth: 110,
  },
  predictBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: t.colors.background,
  },

  // ── Sticky poll bar ──
  stickyPollQuestion: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: t.colors.text,
  },
  stickyPollBtns: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  stickyPollBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: "center",
    minWidth: 64,
  },
  stickyPollBtnYes: {
    backgroundColor: "#16A34A",
  },
  stickyPollBtnNo: {
    backgroundColor: "#DC2626",
  },
  stickyPollBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#fff",
  },
  stickyPollSubtext: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginLeft: spacing.sm,
  },
  stickyError: {
    fontSize: 12,
    color: t.colors.danger,
    marginTop: 2,
  },

  // ── Voted chip ──
  votedChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  votedChipYes: { backgroundColor: t.colors.successSoft },
  votedChipNo: { backgroundColor: t.colors.dangerSoft },
  votedChipText: {
    fontSize: 14,
    fontWeight: "700",
    color: t.colors.text,
  },

  // ── Outcome pill (resolved bar) ──
  outcomePill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  outcomePillYes: { backgroundColor: t.colors.successSoft },
  outcomePillNo: { backgroundColor: t.colors.dangerSoft },
  outcomePillText: {
    fontSize: 14,
    fontWeight: "700",
    color: t.colors.text,
  },
  stickyShareBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: t.colors.accent,
    alignItems: "center",
  },
  stickyShareBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: t.colors.accent,
  },

  // ── Bottom sheet ──
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheetContainer: {
    backgroundColor: t.colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    maxHeight: "88%",
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.colors.border,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xl,
  },
  sheetTitleWrap: {
    flex: 1,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: t.colors.text,
  },
  sheetBalanceHint: {
    marginTop: 3,
    fontSize: 13,
    color: t.colors.textMuted,
  },
  sheetCloseBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sheetCloseBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: t.colors.accent,
  },
  lowBalanceWarning: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.sm,
    backgroundColor: t.colors.warningSoft,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  lowBalanceWarningText: {
    flex: 1,
    fontSize: 13,
    color: t.colors.warning,
    fontWeight: "600",
  },
  sheetSuccessSection: {
    paddingVertical: spacing.xl,
    alignItems: "center",
  },
  sheetSuccessTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: t.colors.success,
    marginBottom: spacing.sm,
  },
  sheetSuccessText: {
    fontSize: 15,
    lineHeight: 22,
    color: t.colors.success,
    textAlign: "center",
  },

  // ── Resolution payoff modal ──
  payoffBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  payoffCard: {
    backgroundColor: t.colors.surface,
    borderRadius: 24,
    paddingHorizontal: spacing.xl,
    paddingVertical: 36,
    alignItems: "center",
    width: "100%",
    maxWidth: 360,
    ...t.shadows.card,
  },
  payoffIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  payoffIconCircleWin: {
    backgroundColor: t.colors.successSoft,
    borderWidth: 3,
    borderColor: t.colors.success,
  },
  payoffIconCircleLoss: {
    backgroundColor: t.colors.dangerSoft,
    borderWidth: 3,
    borderColor: t.colors.danger,
  },
  payoffIconText: {
    fontSize: 36,
    fontWeight: "900",
    lineHeight: 44,
  },
  payoffHeadlineWin: {
    fontSize: 28,
    fontWeight: "900",
    color: t.colors.success,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  payoffHeadlineLoss: {
    fontSize: 22,
    fontWeight: "800",
    color: t.colors.danger,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  payoffPointsDelta: {
    fontSize: 40,
    fontWeight: "900",
    color: t.colors.success,
    textAlign: "center",
    marginBottom: spacing.md,
    letterSpacing: -1,
  },
  payoffSubtext: {
    fontSize: 15,
    color: t.colors.textMuted,
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  payoffMarketTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: t.colors.text,
    textAlign: "center",
    marginBottom: spacing.xl,
    lineHeight: 22,
  },
  payoffButtonRow: {
    flexDirection: "row",
    gap: spacing.md,
    width: "100%",
  },
  payoffBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
  },
  payoffBtnShare: {
    backgroundColor: t.colors.primary,
  },
  payoffBtnShareText: {
    fontSize: 15,
    fontWeight: "800",
    color: t.colors.background,
  },
  payoffBtnClose: {
    backgroundColor: t.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  payoffBtnCloseFull: {
    width: "100%",
  },
  payoffBtnCloseText: {
    fontSize: 15,
    fontWeight: "700",
    color: t.colors.text,
  },

  // ── Multi-choice options ──
  multiChoiceOption: {
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: t.colors.surface,
  },
  multiChoiceOptionSelected: {
    borderColor: t.colors.accent,
    backgroundColor: t.colors.surfaceMuted,
  },
  multiChoiceOptionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  multiChoiceOptionLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: t.colors.text,
  },
  multiChoiceOptionLabelSelected: {
    color: t.colors.accent,
  },
  multiChoiceOptionPct: {
    fontSize: 13,
    fontWeight: "700",
    color: t.colors.textMuted,
    marginLeft: spacing.sm,
  },
  multiChoiceBar: {
    height: 4,
    backgroundColor: t.colors.border,
    borderRadius: 2,
    overflow: "hidden",
  },
  multiChoiceBarFill: {
    height: "100%",
    backgroundColor: t.colors.textMuted,
    borderRadius: 2,
  },
  multiChoiceBarFillSelected: {
    backgroundColor: t.colors.accent,
  },

  // ── Percentile rank (S25-T4) ──
  percentileCard: {
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderLeftWidth: 3,
    borderLeftColor: t.colors.accent,
    ...t.shadows.card,
  },
  percentileText: {
    fontSize: 13,
    fontWeight: "600",
    color: t.colors.accent,
    letterSpacing: 0.1,
  },

  // ── Probability Chart (S27-T2) ──
  probChartCard: {
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    ...t.shadows.card,
  },
  probChartTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: t.colors.text,
    marginBottom: spacing.sm,
    letterSpacing: 0.2,
  },
  probChartEmpty: {
    fontSize: 13,
    color: t.colors.textMuted,
    textAlign: "center",
    paddingVertical: spacing.md,
  },
  probChartArea: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  probChartYLabels: {
    flexDirection: "column",
    justifyContent: "space-between",
    paddingVertical: 0,
  },
  probChartYLabel: {
    fontSize: 10,
    color: t.colors.textMuted,
  },
  probChartCanvas: {
    position: "relative",
    overflow: "hidden",
    flex: 1,
  },
  probChartDash: {
    position: "absolute",
    width: 5,
    height: 1,
    backgroundColor: t.colors.textMuted,
    opacity: 0.4,
  },
  probChartSegment: {
    position: "absolute",
    height: 2,
    backgroundColor: t.colors.accent,
    borderRadius: 1,
    transformOrigin: "left center",
  },
  probChartDot: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: t.colors.accent,
  },
  probChartOutcomeMarker: {
    position: "absolute",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  probChartOutcomeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#ffffff",
  },
  probChartXLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  probChartXLabel: {
    fontSize: 10,
    color: t.colors.textMuted,
  },
  probChartHeader: {
    marginBottom: spacing.sm,
  },
  probChartHeadlineRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 2,
  },
  probChartHeadlinePct: {
    fontSize: 22,
    fontWeight: "800",
    color: t.colors.text,
    letterSpacing: -0.3,
  },
  probChartHeadlineDate: {
    fontSize: 11,
    color: t.colors.textMuted,
    fontWeight: "500",
  },
  probChartHairline: {
    position: "absolute",
    top: 0,
    width: 1,
    backgroundColor: t.colors.text,
    opacity: 0.35,
  },
  probChartInspectDot: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: t.colors.accent,
  },
  probChartRangeRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: spacing.sm,
    paddingLeft: 32,
  },
  probChartRangePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  probChartRangePillActive: {
    backgroundColor: t.colors.accent,
    borderColor: t.colors.accent,
  },
  probChartRangeText: {
    fontSize: 11,
    fontWeight: "700",
    color: t.colors.textMuted,
  },
  probChartRangeTextActive: {
    color: "#FFFFFF",
  },
  probChartFinalBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.xs,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  probChartFinalBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});
