import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { AppMarketType, AppVoteSide } from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";

type UserVote = {
  id: string;
  side: string | null;
  numericValue?: number | null;
};

type Props = {
  marketId: string;
  marketType?: AppMarketType;
  yesCount: number;
  noCount: number;
  totalVotes: number;
  status: string;
  unit?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  precision?: number | null;
  userVote?: UserVote | null;
};

export function QuickPredict({
  marketId,
  marketType = "BINARY",
  yesCount,
  noCount,
  totalVotes,
  status,
  unit,
  minValue,
  maxValue,
  userVote,
}: Props) {
  const { session, status: authStatus } = useSession();
  const [loading, setLoading] = useState(false);
  const [localVote, setLocalVote] = useState<{ side: AppVoteSide | null; numericValue?: number } | null>(null);
  const [guess, setGuess] = useState("");

  const hasVoted = Boolean(userVote || localVote);
  const votedSide = localVote?.side ?? (userVote?.side as AppVoteSide | null);
  const votedNumeric = localVote?.numericValue ?? userVote?.numericValue;

  const total = totalVotes + (localVote ? 1 : 0);
  const adjustedYes = yesCount + (localVote?.side === "YES" ? 1 : 0);
  const adjustedNo = noCount + (localVote?.side === "NO" ? 1 : 0);
  const yesPct = total > 0 ? Math.round((adjustedYes / total) * 100) : 50;

  // ---- Closed state ----
  if (status !== "OPEN") {
    if (marketType === "NUMERIC") {
      return (
        <View style={styles.closedContainer}>
          <View style={styles.numericClosedBox}>
            <Feather name="hash" size={16} color={colors.textMuted} />
            <Text style={styles.closedStatus}>{status}</Text>
          </View>
          {unit ? <Text style={styles.numericUnit}>Unit: {unit}</Text> : null}
        </View>
      );
    }
    return (
      <View style={styles.closedContainer}>
        <View style={styles.barTrack}>
          <View style={[styles.barYes, { flex: yesPct }]} />
          <View style={[styles.barNo, { flex: 100 - yesPct }]} />
        </View>
        <View style={styles.closedRow}>
          <Text style={styles.closedLabel}>YES {yesPct}%</Text>
          <Text style={styles.closedStatus}>{status}</Text>
          <Text style={styles.closedLabel}>NO {100 - yesPct}%</Text>
        </View>
        <Text style={styles.voteCount}>{total} {total === 1 ? "vote" : "votes"}</Text>
      </View>
    );
  }

  // ---- Vote handler ----
  async function vote(side: AppVoteSide | null, numericValue?: number) {
    if (authStatus !== "authenticated" || !session) {
      Alert.alert("Sign in required", "You need to sign in to vote.");
      return;
    }
    setLoading(true);
    try {
      await mobileApi.castVote(marketId, {
        ...(side ? { side } : {}),
        ...(numericValue !== undefined ? { numericValue } : {}),
      });
      setLocalVote({ side, numericValue });
    } catch (e) {
      Alert.alert("Vote failed", e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  // ---- NUMERIC poll ----
  if (marketType === "NUMERIC") {
    const min = minValue ?? 0;
    const max = maxValue ?? 999999;

    if (hasVoted) {
      return (
        <View style={styles.container}>
          <View style={styles.votedBox}>
            <Feather name="check-circle" size={16} color={colors.success} />
            <Text style={styles.votedText}>
              Your guess: {votedNumeric} {unit ?? ""}
            </Text>
          </View>
          <Text style={styles.voteCount}>{total} {total === 1 ? "vote" : "votes"}</Text>
        </View>
      );
    }

    function handleSubmitGuess() {
      const val = parseFloat(guess);
      if (isNaN(val)) {
        Alert.alert("Invalid guess", "Please enter a valid number.");
        return;
      }
      if (val < min || val > max) {
        Alert.alert("Out of range", `Your guess must be between ${min} and ${max}.`);
        return;
      }
      vote(null, val);
    }

    return (
      <View style={styles.container}>
        <View style={styles.numericHeader}>
          <Feather name="hash" size={14} color={colors.accent} />
          <Text style={styles.numericLabel}>GUESS THE NUMBER</Text>
        </View>
        <View style={styles.numericRangeRow}>
          <Text style={styles.numericRange}>{min}</Text>
          <View style={styles.numericRangeBar}>
            <View style={styles.numericRangeFill} />
          </View>
          <Text style={styles.numericRange}>{max}</Text>
        </View>
        {unit ? <Text style={styles.numericUnit}>Unit: {unit}</Text> : null}

        <View style={styles.numericInputRow}>
          <TextInput
            style={styles.numericInput}
            value={guess}
            onChangeText={setGuess}
            keyboardType="decimal-pad"
            placeholder={`Enter your guess (${min}\u2013${max})`}
            placeholderTextColor={colors.textMuted}
            selectTextOnFocus
          />
        </View>

        <Pressable
          style={({ pressed }) => [styles.numericSubmitBtn, pressed && styles.btnPressed]}
          onPress={handleSubmitGuess}
          disabled={loading || !guess}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Text style={styles.numericSubmitLabel}>Submit Guess</Text>
          )}
        </Pressable>
        <Text style={styles.hint}>{total} {total === 1 ? "vote" : "votes"} so far</Text>
      </View>
    );
  }

  // ---- BINARY poll: already voted ----
  if (hasVoted) {
    return (
      <View style={styles.container}>
        <View style={styles.barTrack}>
          <View style={[styles.barYes, { flex: yesPct }]} />
          <View style={[styles.barNo, { flex: 100 - yesPct }]} />
        </View>
        <View style={styles.resultRow}>
          <Text style={styles.resultLabel}>YES {yesPct}%</Text>
          <Text style={styles.resultLabel}>NO {100 - yesPct}%</Text>
        </View>
        <View style={styles.votedBox}>
          <Feather name="check-circle" size={16} color={colors.success} />
          <Text style={styles.votedText}>You voted {votedSide}</Text>
        </View>
        <Text style={styles.voteCount}>{total} {total === 1 ? "vote" : "votes"}</Text>
      </View>
    );
  }

  // ---- BINARY poll: voting UI ----
  return (
    <View style={styles.container}>
      <View style={styles.barTrack}>
        <View style={[styles.barYes, { flex: yesPct }]} />
        <View style={[styles.barNo, { flex: 100 - yesPct }]} />
      </View>

      <View style={styles.btnRow}>
        <Pressable
          style={({ pressed }) => [styles.yesBtn, pressed && styles.btnPressed]}
          onPress={() => vote("YES")}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#059669" />
          ) : (
            <>
              <Text style={styles.yesBtnLabel}>YES</Text>
              <Text style={styles.yesBtnPct}>{yesPct}%</Text>
            </>
          )}
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.noBtn, pressed && styles.btnPressed]}
          onPress={() => vote("NO")}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#e11d48" />
          ) : (
            <>
              <Text style={styles.noBtnLabel}>NO</Text>
              <Text style={styles.noBtnPct}>{100 - yesPct}%</Text>
            </>
          )}
        </Pressable>
      </View>
      <Text style={styles.hint}>{total} {total === 1 ? "vote" : "votes"} so far</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: spacing.lg },

  // Probability bar
  barTrack: { flexDirection: "row", height: 8, borderRadius: radius.pill, overflow: "hidden" },
  barYes: { backgroundColor: "#10b981", height: "100%" },
  barNo: { backgroundColor: "#fb7185", height: "100%" },

  // Binary buttons
  btnRow: { marginTop: spacing.md, flexDirection: "row", gap: spacing.sm },
  yesBtn: { flex: 1, alignItems: "center", paddingVertical: spacing.lg, borderRadius: radius.md, backgroundColor: "#ecfdf5", borderWidth: 1, borderColor: "#a7f3d0" },
  noBtn: { flex: 1, alignItems: "center", paddingVertical: spacing.lg, borderRadius: radius.md, backgroundColor: "#fff1f2", borderWidth: 1, borderColor: "#fecdd3" },
  btnPressed: { opacity: 0.7 },
  yesBtnLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5, color: "#059669" },
  yesBtnPct: { fontSize: 24, fontWeight: "700", color: "#059669", marginTop: 2 },
  noBtnLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5, color: "#e11d48" },
  noBtnPct: { fontSize: 24, fontWeight: "700", color: "#e11d48", marginTop: 2 },
  hint: { marginTop: spacing.sm, textAlign: "center", fontSize: 12, color: colors.textMuted },

  // Result row
  resultRow: { marginTop: spacing.sm, flexDirection: "row", justifyContent: "space-between" },
  resultLabel: { fontSize: 13, fontWeight: "600", color: colors.textMuted },

  // Voted state
  votedBox: { marginTop: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "#ecfdf5", paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: "#a7f3d0" },
  votedText: { fontSize: 14, fontWeight: "600", color: "#059669" },
  voteCount: { marginTop: spacing.sm, textAlign: "center", fontSize: 12, color: colors.textMuted },

  // Closed market
  closedContainer: { marginTop: spacing.lg },
  closedRow: { marginTop: spacing.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  closedLabel: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
  closedStatus: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", color: colors.textMuted, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted, overflow: "hidden" },

  // Numeric poll
  numericHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginBottom: spacing.sm },
  numericLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8, color: colors.accent },
  numericRangeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  numericRange: { fontSize: 13, fontWeight: "700", color: colors.textMuted },
  numericRangeBar: { flex: 1, height: 6, borderRadius: radius.pill, backgroundColor: colors.border },
  numericRangeFill: { width: "100%", height: "100%", borderRadius: radius.pill, backgroundColor: colors.accent, opacity: 0.3 },
  numericUnit: { marginTop: spacing.xs, fontSize: 12, color: colors.textMuted },
  numericInputRow: { marginTop: spacing.md },
  numericInput: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, borderWidth: 2, borderColor: colors.accent, fontSize: 20, fontWeight: "700", color: colors.text, textAlign: "center" },
  numericSubmitBtn: { marginTop: spacing.md, alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.accent },
  numericSubmitLabel: { fontSize: 15, fontWeight: "700", color: "#FFF" },
  numericClosedBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
});
