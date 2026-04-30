import { Link } from "expo-router";
import { useRef, useState } from "react";
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

import type { ApiNewsFeedItem } from "@predict-future/types";
import { formatPercent, formatRelativeTime } from "@predict-future/utils";
import { colors, radius, shadows, spacing } from "@predict-future/ui-tokens";

import { mobileApi } from "@/lib/api";
import { useWatchlist } from "@/providers/watchlist-provider";

type Props = {
  item: ApiNewsFeedItem;
  viewportHeight: number;
  showHint?: boolean;
  onVoted?: () => void;
};

export function NewsFeedCard({ item, viewportHeight, showHint, onVoted }: Props) {
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

            <Pressable
              onPress={() => Linking.openURL(item.sourceUrl)}
              style={styles.metaRow}
            >
              <Text style={styles.source}>{item.sourceName}</Text>
              <Text style={styles.readMore}>Read more →</Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.published}>{formatRelativeTime(item.publishedAt)}</Text>
            </Pressable>

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
