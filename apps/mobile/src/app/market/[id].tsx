import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { ApiMarketDetail } from "@predict-future/types";
import { formatPercent, formatPoints, formatRelativeTime } from "@predict-future/utils";
import { colors, radius, shadows, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";
import { env } from "@/lib/env";

type UserPosition = {
  id: string;
  side: string | null;
  amount: number;
  numericValue: number | null;
  createdAt: string;
};

type MarketResponse = ApiMarketDetail & { userPositions?: UserPosition[] };

function normalizeParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" && value.length > 0 ? value : null;
}

const BET_PRESETS = [50, 100, 250, 500, 1000];

export default function MarketDetailScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = normalizeParam(params.id);

  const fetcher = useCallback(
    () => mobileApi.getMarketById(id as string, { userId: env.demoUserId }),
    [id]
  );

  const { data, status, error, refetch } = useApiQuery<MarketResponse>(fetcher, [id], {
    enabled: Boolean(id),
    errorFallback: "Unable to load market.",
  });

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Market" }} />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
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
          <MarketBody data={data} marketId={id} onRefresh={refetch} />
        ) : (
          <Text style={styles.error}>Market not found.</Text>
        )}
      </ScrollView>
    </>
  );
}

function MarketBody({
  data,
  marketId,
  onRefresh,
}: {
  data: MarketResponse;
  marketId: string;
  onRefresh: () => void;
}) {
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

  // Bet state
  const [selectedSide, setSelectedSide] = useState<"YES" | "NO" | null>(null);
  const [numericGuess, setNumericGuess] = useState("");
  const [amount, setAmount] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [placing, setPlacing] = useState(false);
  const [betError, setBetError] = useState<string | null>(null);
  const [betSuccess, setBetSuccess] = useState(false);

  const betAmount = customAmount ? parseInt(customAmount, 10) : parseInt(amount, 10);

  async function handlePlaceBet() {
    if (placing) return;
    if (!betAmount || betAmount < 50) {
      setBetError("Minimum bet is 50 points.");
      return;
    }
    if (!isNumeric && !selectedSide) {
      setBetError("Pick YES or NO.");
      return;
    }
    if (isNumeric && !numericGuess) {
      setBetError("Enter your guess.");
      return;
    }

    setPlacing(true);
    setBetError(null);
    try {
      await mobileApi.placePosition(
        marketId,
        {
          side: isNumeric ? undefined : (selectedSide ?? undefined),
          numericValue: isNumeric ? parseFloat(numericGuess) : undefined,
          amount: betAmount,
        },
        { userId: env.demoUserId }
      );
      setBetSuccess(true);
      onRefresh();
    } catch (err: unknown) {
      setBetError(err instanceof Error ? err.message : "Failed to place bet.");
    } finally {
      setPlacing(false);
    }
  }

  async function handleIncreaseBet() {
    if (placing) return;
    if (!betAmount || betAmount < 50) {
      setBetError("Minimum additional bet is 50 points.");
      return;
    }

    const existingSide = positions[0]?.side as "YES" | "NO" | null;

    setPlacing(true);
    setBetError(null);
    try {
      await mobileApi.placePosition(
        marketId,
        {
          side: isNumeric ? undefined : (existingSide ?? undefined),
          numericValue: isNumeric ? (positions[0]?.numericValue ?? undefined) : undefined,
          amount: betAmount,
        },
        { userId: env.demoUserId }
      );
      setBetSuccess(true);
      setCustomAmount("");
      setAmount("");
      onRefresh();
    } catch (err: unknown) {
      setBetError(err instanceof Error ? err.message : "Failed to increase bet.");
    } finally {
      setPlacing(false);
    }
  }

  return (
    <View style={styles.container}>
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
              <View style={[styles.progressFill, { width: `${Math.max(6, yesProbability * 100)}%` }]} />
            </View>
            <View style={styles.probRow}>
              <Text style={styles.probYes}>YES {formatPercent(yesProbability)}</Text>
              <Text style={styles.probNo}>NO {formatPercent(1 - yesProbability)}</Text>
            </View>
          </View>
        )}

        <View style={styles.infoGrid}>
          <InfoItem label="Volume" value={formatPoints(market.totalVolume ?? totalPool)} />
          <InfoItem label="Players" value={String(market.totalParticipants ?? 0)} />
          {market.closeAt ? <InfoItem label="Closes" value={formatRelativeTime(market.closeAt)} /> : null}
          {market.resolveAt ? <InfoItem label="Resolves" value={formatRelativeTime(market.resolveAt)} /> : null}
        </View>

        {market.creator?.username ? (
          <Text style={styles.hostLabel}>Hosted by @{market.creator.username}</Text>
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
        </View>
      ) : null}

      {/* Betting panel */}
      {isOpen && !betSuccess ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>
            {hasPosition ? "Increase Your Bet" : "Place Your Bet"}
          </Text>

          {/* Side selection (binary only, new position only) */}
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
              <View style={[styles.sidePill, positions[0]?.side === "YES" ? styles.sidePillYes : styles.sidePillNo]}>
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

          {betError ? <Text style={styles.betError}>{betError}</Text> : null}

          <Pressable
            style={[
              styles.placeBetBtn,
              placing && styles.btnDisabled,
            ]}
            onPress={hasPosition ? handleIncreaseBet : handlePlaceBet}
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
        </View>
      ) : null}

      {/* Success state */}
      {betSuccess ? (
        <View style={[styles.card, styles.successCard]}>
          <Text style={styles.successTitle}>Bet placed!</Text>
          <Text style={styles.successText}>
            Your position has been recorded. You can increase your bet but cannot change your side.
          </Text>
          <Pressable
            style={styles.anotherBtn}
            onPress={() => {
              setBetSuccess(false);
              setCustomAmount("");
              setAmount("");
            }}
          >
            <Text style={styles.anotherBtnText}>Add More</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Closed state */}
      {isClosed && !hasPosition ? (
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
    </View>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoItem}>
      <Text style={styles.infoValue}>{value}</Text>
      <Text style={styles.infoLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 100,
  },
  container: {
    gap: spacing.lg,
  },
  centerState: {
    paddingTop: 100,
    alignItems: "center",
  },
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
  hostLabel: {
    marginTop: spacing.lg,
    fontSize: 14,
    fontWeight: "600",
    color: colors.accent,
  },
  // Positions
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
  // Betting
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
  // Success
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
  anotherBtn: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: "#16A34A",
  },
  anotherBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  // Closed
  closedCard: {
    backgroundColor: "#F9FAFB",
  },
  closedText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#6B7280",
    textAlign: "center",
  },
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
});
