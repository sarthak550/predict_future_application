import { Ionicons } from "@expo/vector-icons";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  type AppStateStatus,
  Modal,
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

import type { ApiMarketDetail, ApiProbabilityHistory } from "@predict-future/types";
import { formatPercent, formatPoints, formatRelativeTime } from "@predict-future/utils";
import { colors, radius, shadows, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { useInterval } from "@/hooks/useInterval";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";
import { VerifiedBadge } from "@/components/verified-badge";

type UserPosition = {
  id: string;
  side: string | null;
  amount: number;
  numericValue: number | null;
  createdAt: string;
};

type UserVote = {
  side: string | null;
  numericValue: number | null;
};

type MarketResponse = ApiMarketDetail & { userPositions?: UserPosition[]; userVote?: UserVote | null };

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

  const fetcher = useCallback(
    () => mobileApi.getMarketById(id as string),
    [id]
  );

  const { data, status, error, refetch } = useApiQuery<MarketResponse>(fetcher, [id], {
    enabled: Boolean(id),
    errorFallback: "Unable to load market.",
  });

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
};

function StickyBettingBar({
  data,
  marketId,
  betSheetOpen,
  onOpenBetSheet,
  onCloseBetSheet,
  onRefresh,
  bottomInset,
}: StickyBettingBarProps) {
  const market = data.market;
  const positions = data.userPositions ?? [];
  const hasPosition = positions.length > 0;
  const totalCommitted = positions.reduce((sum, p) => sum + p.amount, 0);

  const yesPool = market.yesPool ?? 0;
  const noPool = market.noPool ?? 0;
  const totalPool = yesPool + noPool;
  const yesProbability = totalPool > 0 ? yesPool / totalPool : 0.5;

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
              <Text style={styles.predictBtnText}>
                {hasPosition ? "Stake More" : "Predict"}
              </Text>
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
            <Text style={styles.predictBtnText}>
              {hasPosition ? "Add More" : "Predict"}
            </Text>
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
};

function BettingSheet({
  visible,
  onClose,
  data,
  marketId,
  onRefresh,
  onBetSuccess,
  bottomInset,
}: BettingSheetProps) {
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

  // Reset form when sheet opens
  useEffect(() => {
    if (visible) {
      setSelectedSide(null);
      setNumericGuess("");
      setAmount("");
      setCustomAmount("");
      setBetError(null);
      setBetSuccess(false);
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
      const result = await mobileApi.placePosition(marketId, {
        side: isNumeric ? undefined : hasPosition ? (existingSide ?? undefined) : (selectedSide ?? undefined),
        numericValue: isNumeric
          ? hasPosition
            ? (positions[0]?.numericValue ?? undefined)
            : parseFloat(numericGuess)
          : undefined,
        amount: betAmount,
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
          <Text style={styles.sheetTitle}>
            {hasPosition ? "Increase Your Bet" : "Place Your Bet"}
          </Text>
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
                  {hasPosition ? "Increase Bet" : "Place Bet"}{" "}
                  {betAmount >= 50 ? `— ${betAmount} pts` : ""}
                </Text>
              )}
            </Pressable>
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
};

function MultiChoiceBettingSheet({
  visible,
  onClose,
  data,
  marketId,
  onRefresh,
  onBetSuccess,
  bottomInset,
}: MultiChoiceBettingSheetProps) {
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
        amount: betAmount
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
          <Text style={styles.sheetTitle}>Choose an Option</Text>
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
  const { session } = useSession();
  const market = data.market;
  const positions = data.userPositions ?? [];
  const hasPosition = positions.length > 0;
  const totalCommitted = positions.reduce((sum, p) => sum + p.amount, 0);

  const yesPool = market.yesPool ?? 0;
  const noPool = market.noPool ?? 0;
  const totalPool = yesPool + noPool;
  const yesProbability = totalPool > 0 ? yesPool / totalPool : 0.5;

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

  // Animated probability bar
  const animatedProb = useRef(new Animated.Value(yesProbability)).current;

  useEffect(() => {
    Animated.timing(animatedProb, {
      toValue: yesProbability,
      duration: 300,
      useNativeDriver: false, // false required for width/layout animations
    }).start();
  }, [yesProbability]);

  // Probability history chart state (S27-T2)
  const [probHistory, setProbHistory] = useState<ApiProbabilityHistory | null>(null);
  const [probHistoryLoading, setProbHistoryLoading] = useState(false);

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
  }, [marketId, market.marketType]);

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
          <Ionicons name="time-outline" size={18} color="#92400E" />
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
          <Text style={styles.subtitle}>{market.description}</Text>
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
          {market.closeAt ? <InfoItem label="Closes" value={formatRelativeTime(market.closeAt)} /> : null}
          {market.resolveAt ? <InfoItem label="Resolves" value={formatRelativeTime(market.resolveAt)} /> : null}
        </View>

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

      {/* Existing positions */}
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

      {/* Resolution info */}
      {market.resolutionRuleText ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Resolution Rules</Text>
          <Text style={styles.subtitle}>{market.resolutionRuleText}</Text>
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
              style={[styles.resolveConfirmBtn, resolving && styles.btnDisabled]}
              onPress={handleResolve}
              disabled={resolving}
            >
              {resolving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.resolveConfirmText}>Confirm Resolution</Text>
              )}
            </Pressable>
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
  return (
    <View style={styles.infoItem}>
      <Text style={styles.infoValue}>{value}</Text>
      <Text style={styles.infoLabel}>{label}</Text>
    </View>
  );
}

// ─── ProbabilityChart (S27-T2) ────────────────────────────────────────────────
// Pure View-based consensus-line chart. No external charting library.
// Renders a segmented polyline using absolutely positioned Views in a fixed 120px container.
// Only shown for BINARY markets with >= 2 snapshots.

const CHART_HEIGHT = 120;
const CHART_LABEL_WIDTH = 30; // px reserved for Y-axis labels
const CHART_PADDING_V = 12; // vertical breathing room

function ProbabilityChart({
  history,
  isResolved,
  outcome,
}: {
  history: ApiProbabilityHistory | null;
  isResolved: boolean;
  outcome: string | null;
}) {
  const [chartWidth, setChartWidth] = useState(0);

  if (!history || history.snapshots.length < 2) {
    return (
      <View style={styles.probChartCard}>
        <Text style={styles.probChartTitle}>Consensus shift</Text>
        <Text style={styles.probChartEmpty}>Probability history not yet available</Text>
      </View>
    );
  }

  // Build display snapshots — if resolved, append the final outcome point
  const displayPoints = [...history.snapshots];
  if (isResolved && history.resolvedProbability !== null) {
    // Append final outcome point with the same timestamp as the last snapshot
    // (it will be rendered as a special marker at the right edge)
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

  // Convert snapshots to X/Y in chart coordinate space
  function toXY(snap: { at: string; probability: number }, index: number) {
    const t = new Date(snap.at).getTime();
    const x =
      n <= 1
        ? (index === 0 ? 0 : innerW)
        : ((t - firstAt) / totalDuration) * innerW;
    // Y: probability 1.0 = top of chart (y=0 in absolute), 0.0 = bottom
    const y = CHART_PADDING_V + (1 - snap.probability) * innerH;
    return { x, y };
  }

  const points = displayPoints.map((s, i) => ({ ...toXY(s, i), prob: s.probability }));

  // Build line segments
  const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push({
      x1: points[i]!.x,
      y1: points[i]!.y,
      x2: points[i + 1]!.x,
      y2: points[i + 1]!.y,
    });
  }

  // 50% threshold line Y position
  const thresholdY = CHART_PADDING_V + (1 - 0.5) * innerH;

  const firstDate = new Date(displayPoints[0]!.at).toLocaleDateString("en-IN", {
    month: "short",
    day: "numeric",
  });
  const lastDate = new Date(displayPoints[n - 1]!.at).toLocaleDateString("en-IN", {
    month: "short",
    day: "numeric",
  });

  const lastPoint = points[n - 1]!;

  return (
    <View style={styles.probChartCard}>
      <Text style={styles.probChartTitle}>Consensus shift</Text>

      <View
        style={[styles.probChartArea, { height: CHART_HEIGHT + 24 }]}
        onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)}
      >
        {/* Y-axis labels */}
        <View
          style={[
            styles.probChartYLabels,
            { width: CHART_LABEL_WIDTH, height: CHART_HEIGHT },
          ]}
        >
          <Text style={styles.probChartYLabel}>100%</Text>
          <Text style={[styles.probChartYLabel, { marginTop: "auto" }]}>0%</Text>
        </View>

        {/* Chart canvas */}
        {chartWidth > 0 ? (
          <View
            style={[
              styles.probChartCanvas,
              { width: innerW, height: CHART_HEIGHT },
            ]}
          >
            {/* 50% dashed threshold line */}
            {Array.from({ length: Math.floor(innerW / 10) }).map((_, i) => (
              <View
                key={`dash-${i}`}
                style={[
                  styles.probChartDash,
                  { left: i * 10, top: thresholdY - 0.5 },
                ]}
              />
            ))}

            {/* Line segments */}
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
                    {
                      left: seg.x1,
                      top: seg.y1,
                      width: length,
                      transform: [{ rotate: `${angle}deg` }],
                    },
                  ]}
                />
              );
            })}

            {/* Data dots — only first and last */}
            <View
              style={[
                styles.probChartDot,
                { left: (points[0]?.x ?? 0) - 3, top: (points[0]?.y ?? 0) - 3 },
              ]}
            />
            <View
              style={[
                styles.probChartDot,
                { left: lastPoint.x - 3, top: lastPoint.y - 3 },
              ]}
            />

            {/* Resolved outcome marker */}
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

      {/* X-axis labels */}
      <View style={[styles.probChartXLabels, { paddingLeft: CHART_LABEL_WIDTH }]}>
        <Text style={styles.probChartXLabel}>{firstDate}</Text>
        <Text style={styles.probChartXLabel}>{lastDate}</Text>
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
  let label: string;
  let bgColor: string;
  let textColor: string;

  if (pos.kind === "binary") {
    label = `Holds ${pos.side} — ${pos.amount} pts`;
    bgColor = pos.side === "YES" ? "#D1FAE5" : "#FEE2E2";
    textColor = pos.side === "YES" ? "#065F46" : "#991B1B";
  } else if (pos.kind === "multi-choice") {
    label = `Holds ${pos.optionLabel} — ${pos.amount} pts`;
    bgColor = "#EDE9FE";
    textColor = "#4C1D95";
  } else {
    label = `Predicted ${pos.value} — ${pos.amount} pts`;
    bgColor = "#E0F2FE";
    textColor = "#0C4A6E";
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

const styles = StyleSheet.create({
  // Root layout
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
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
    backgroundColor: "#FEF3C7",
    borderLeftWidth: 4,
    borderLeftColor: "#D97706",
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  pendingReviewBannerText: {
    flex: 1,
    color: "#92400E",
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
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    ...shadows.card,
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
  badgeOpen: { backgroundColor: "#DCFCE7" },
  badgeClosed: { backgroundColor: "#F3F4F6" },
  badgeText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  badgeTextOpen: { color: "#16A34A" },
  badgeTextClosed: { color: "#6B7280" },
  categoryLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: colors.textMuted,
  },
  cardTitle: {
    marginTop: spacing.md,
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 28,
    color: colors.text,
  },
  subtitle: {
    marginTop: spacing.sm,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
  },

  // ── Numeric avg ──
  numericAvgSection: {
    marginTop: spacing.xl,
  },
  numericLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
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
    color: colors.primary,
  },
  numericGuessCount: {
    fontSize: 13,
    color: colors.textMuted,
  },
  rangeTrack: {
    marginTop: spacing.md,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: "#E0E7FF",
    position: "relative",
    overflow: "visible",
  },
  rangeMarker: {
    position: "absolute",
    top: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    marginLeft: -8,
    borderWidth: 2,
    borderColor: "#fff",
  },
  rangeLabels: {
    marginTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rangeLabelText: {
    fontSize: 12,
    color: colors.textMuted,
  },

  // ── Probability bar ──
  probabilitySection: {
    marginTop: spacing.xl,
  },
  progressTrack: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: "#FEE2E2",
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
    color: colors.text,
  },
  infoLabel: {
    fontSize: 11,
    color: colors.textMuted,
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
    color: colors.accent,
  },

  // ── Positions ──
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
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
  sidePillYes: { backgroundColor: "#DCFCE7" },
  sidePillNo: { backgroundColor: "#FEE2E2" },
  sidePillNumeric: { backgroundColor: "#DBEAFE" },
  sidePillText: {
    fontSize: 13,
    fontWeight: "700",
  },
  positionAmount: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
    flex: 1,
  },
  positionDate: {
    fontSize: 12,
    color: colors.textMuted,
  },
  totalRow: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
  },
  totalValue: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
  },
  addMoreBtn: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  addMoreBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.primary,
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
    borderColor: "#BBF7D0",
    backgroundColor: "#F0FDF4",
  },
  sideBtnYesActive: {
    borderColor: "#16A34A",
    backgroundColor: "#DCFCE7",
  },
  sideBtnNo: {
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
  },
  sideBtnNoActive: {
    borderColor: "#DC2626",
    backgroundColor: "#FEE2E2",
  },
  sideBtnText: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 1,
    color: colors.text,
  },
  sideBtnTextActive: {
    color: colors.text,
  },
  sideProb: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textMuted,
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
    color: colors.text,
  },
  lockedValue: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.primary,
  },
  lockedHint: {
    fontSize: 13,
    color: colors.textMuted,
  },
  numericSection: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  textInput: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: "#fff",
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
    backgroundColor: "#F3F4F6",
  },
  presetPillActive: {
    backgroundColor: colors.primary,
  },
  presetText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  presetTextActive: {
    color: "#fff",
  },
  estimatedReturnRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.md,
  },
  estimatedReturnLabel: {
    fontSize: 14,
    color: colors.textMuted,
  },
  estimatedReturnValue: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  betError: {
    marginTop: spacing.sm,
    fontSize: 13,
    color: "#DC2626",
  },
  placeBetBtn: {
    marginTop: spacing.lg,
    paddingVertical: 16,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
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
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#BBF7D0",
  },
  successTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#16A34A",
  },
  successText: {
    marginTop: spacing.sm,
    fontSize: 14,
    lineHeight: 20,
    color: "#15803D",
  },

  // ── Poll notice ──
  pollCard: {
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  pollTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1D4ED8",
    marginBottom: spacing.sm,
  },
  pollText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#1E40AF",
  },

  // ── Closed ──
  closedCard: {
    backgroundColor: "#F9FAFB",
  },
  closedText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#6B7280",
    textAlign: "center",
  },

  // ── Share ──
  shareBtn: {
    marginTop: spacing.sm,
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: "center",
  },
  shareBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.accent,
  },
  shareLink: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
  },
  shareLinkText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.accent,
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
    color: colors.danger,
  },
  retryBtn: {
    marginTop: spacing.lg,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  retryLabel: {
    color: colors.surface,
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
    backgroundColor: "#DCFCE7",
    borderWidth: 1,
    borderColor: "#86EFAC",
  },
  resolutionOutcomeBadgeNo: {
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  resolutionOutcomeBadgeNeutral: {
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#D1D5DB",
  },
  resolutionOutcomeBadgeText: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  resolutionOutcomeBadgeTextYes: {
    color: "#15803D",
  },
  resolutionOutcomeBadgeTextNo: {
    color: "#DC2626",
  },
  resolutionOutcomeBadgeTextNeutral: {
    color: "#6B7280",
  },
  overturnedBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FCD34D",
  },
  overturnedBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#92400E",
  },
  resolutionMeta: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
    fontWeight: "500",
  },

  // ── Host resolution panel ──
  resolveCard: {
    borderWidth: 1.5,
    borderColor: "#FDE68A",
    backgroundColor: "#FFFBEB",
  },
  resolveHostHint: {
    fontSize: 14,
    color: "#92400E",
    marginBottom: spacing.lg,
  },
  commissionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#FEF3C7",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  commissionLabel: {
    fontSize: 13,
    color: "#92400E",
    flex: 1,
    marginRight: spacing.sm,
  },
  commissionValue: {
    fontSize: 14,
    fontWeight: "800",
    color: "#78350F",
  },
  resolveNoteInput: {
    height: 80,
    paddingTop: spacing.sm,
    textAlignVertical: "top",
  },
  resolveConfirmBtn: {
    marginTop: spacing.lg,
    paddingVertical: 16,
    borderRadius: radius.md,
    backgroundColor: "#D97706",
    alignItems: "center",
  },
  resolveConfirmText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#fff",
  },
  resolveSuccessCard: {
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#BBF7D0",
  },
  resolveSuccessTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#16A34A",
    textAlign: "center",
  },

  // ── Comments ──
  commentsEmpty: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    paddingVertical: spacing.md,
  },
  commentRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
    color: colors.text,
  },
  commentTime: {
    fontSize: 12,
    color: colors.textMuted,
  },
  commentContent: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  commentInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  commentInput: {
    flex: 1,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    paddingHorizontal: spacing.md,
    fontSize: 14,
    color: colors.text,
    backgroundColor: "#fff",
  },
  commentCharsLeft: {
    fontSize: 12,
    color: colors.textMuted,
    minWidth: 28,
    textAlign: "right",
  },
  commentPostBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 52,
  },
  commentPostText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  commentsClosedNote: {
    marginTop: spacing.md,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: "center",
  },
  commentsSignInNote: {
    marginTop: spacing.md,
    fontSize: 13,
    color: colors.textMuted,
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
    color: colors.textMuted,
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
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    ...shadows.card,
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
    color: colors.textMuted,
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
  stickyPosPillYes: { backgroundColor: "#DCFCE7" },
  stickyPosPillNo: { backgroundColor: "#FEE2E2" },
  stickyPosPillNumeric: { backgroundColor: "#DBEAFE" },
  stickyPosPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.text,
  },
  stickyPositionAmount: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
  },
  stickyPositionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
  },
  predictBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    minWidth: 110,
  },
  predictBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#fff",
  },

  // ── Sticky poll bar ──
  stickyPollQuestion: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
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
    color: colors.textMuted,
    marginLeft: spacing.sm,
  },
  stickyError: {
    fontSize: 12,
    color: "#DC2626",
    marginTop: 2,
  },

  // ── Voted chip ──
  votedChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  votedChipYes: { backgroundColor: "#DCFCE7" },
  votedChipNo: { backgroundColor: "#FEE2E2" },
  votedChipText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },

  // ── Outcome pill (resolved bar) ──
  outcomePill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  outcomePillYes: { backgroundColor: "#DCFCE7" },
  outcomePillNo: { backgroundColor: "#FEE2E2" },
  outcomePillText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  stickyShareBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: "center",
  },
  stickyShareBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.accent,
  },

  // ── Bottom sheet ──
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheetContainer: {
    backgroundColor: colors.surface,
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
    backgroundColor: "#D1D5DB",
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xl,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
  },
  sheetCloseBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sheetCloseBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.accent,
  },
  sheetSuccessSection: {
    paddingVertical: spacing.xl,
    alignItems: "center",
  },
  sheetSuccessTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#16A34A",
    marginBottom: spacing.sm,
  },
  sheetSuccessText: {
    fontSize: 15,
    lineHeight: 22,
    color: "#15803D",
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
    backgroundColor: colors.surface,
    borderRadius: 24,
    paddingHorizontal: spacing.xl,
    paddingVertical: 36,
    alignItems: "center",
    width: "100%",
    maxWidth: 360,
    ...shadows.card,
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
    backgroundColor: "#DCFCE7",
    borderWidth: 3,
    borderColor: "#16A34A",
  },
  payoffIconCircleLoss: {
    backgroundColor: "#FEE2E2",
    borderWidth: 3,
    borderColor: "#DC2626",
  },
  payoffIconText: {
    fontSize: 36,
    fontWeight: "900",
    lineHeight: 44,
  },
  payoffHeadlineWin: {
    fontSize: 28,
    fontWeight: "900",
    color: "#16A34A",
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  payoffHeadlineLoss: {
    fontSize: 22,
    fontWeight: "800",
    color: "#DC2626",
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  payoffPointsDelta: {
    fontSize: 40,
    fontWeight: "900",
    color: "#16A34A",
    textAlign: "center",
    marginBottom: spacing.md,
    letterSpacing: -1,
  },
  payoffSubtext: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  payoffMarketTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
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
    backgroundColor: colors.primary,
  },
  payoffBtnShareText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#fff",
  },
  payoffBtnClose: {
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: colors.border,
  },
  payoffBtnCloseFull: {
    width: "100%",
  },
  payoffBtnCloseText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },

  // ── Multi-choice options ──
  multiChoiceOption: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  multiChoiceOptionSelected: {
    borderColor: colors.accent,
    backgroundColor: "#EFF6FF",
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
    color: colors.text,
  },
  multiChoiceOptionLabelSelected: {
    color: colors.accent,
  },
  multiChoiceOptionPct: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
    marginLeft: spacing.sm,
  },
  multiChoiceBar: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: "hidden",
  },
  multiChoiceBarFill: {
    height: "100%",
    backgroundColor: colors.textMuted,
    borderRadius: 2,
  },
  multiChoiceBarFillSelected: {
    backgroundColor: colors.accent,
  },

  // ── Percentile rank (S25-T4) ──
  percentileCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    ...shadows.card,
  },
  percentileText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.accent,
    letterSpacing: 0.1,
  },

  // ── Probability Chart (S27-T2) ──
  probChartCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  probChartTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.sm,
    letterSpacing: 0.2,
  },
  probChartEmpty: {
    fontSize: 13,
    color: colors.textMuted,
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
    color: colors.textMuted,
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
    backgroundColor: colors.textMuted,
    opacity: 0.4,
  },
  probChartSegment: {
    position: "absolute",
    height: 2,
    backgroundColor: colors.accent,
    borderRadius: 1,
    transformOrigin: "left center",
  },
  probChartDot: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
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
    color: colors.textMuted,
  },
});
