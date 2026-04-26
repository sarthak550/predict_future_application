import { Link } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { ApiNewsFeedItem } from "@predict-future/types";
import { formatPercent, formatPoints, formatRelativeTime } from "@predict-future/utils";
import { colors, radius, shadows, spacing } from "@predict-future/ui-tokens";

import { mobileApi } from "@/lib/api";
import { env } from "@/lib/env";

type Props = {
  item: ApiNewsFeedItem;
  viewportHeight: number;
};

export function NewsFeedCard({ item, viewportHeight }: Props) {
  const market = item.market;
  const poll = item.poll;
  const totalPool = (market?.yesPool ?? 0) + (market?.noPool ?? 0);
  const yesProbability = totalPool > 0 ? (market?.yesPool ?? 0) / totalPool : 0.5;

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

  const pollClosed =
    poll?.status === "CLOSED" ||
    poll?.status === "RESOLVED" ||
    (poll?.closeAt && new Date(poll.closeAt) <= new Date());

  async function handleVote(side?: string, numericValue?: number) {
    if (!market || voting) return;
    setVoting(true);
    setError(null);
    try {
      await mobileApi.castVote(
        market.id,
        { side, numericValue },
        { userId: env.demoUserId }
      );
      setVoted(side ?? String(numericValue));
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Vote failed";
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
          {hasImage && (
            <Image
              source={{ uri: item.imageUrl! }}
              style={styles.heroImage}
              resizeMode="cover"
            />
          )}

          <View style={styles.content}>
            <Text style={styles.category}>{item.category}</Text>
            <Text style={[styles.headline, hasImage && styles.headlineCompact]}>
              {item.headline}
            </Text>
            <Text style={styles.summary}>{item.summary}</Text>

            <View style={styles.metaRow}>
              <Text style={styles.source}>{item.sourceName}</Text>
              <Text style={styles.published}>
                {formatRelativeTime(item.publishedAt)}
              </Text>
            </View>

            {market ? (
              <View style={styles.marketBlock}>
                <Text style={styles.marketTitle}>{market.title}</Text>

                {/* Progress bar */}
                {poll && poll.totalVotes > 0 ? (
                  <>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${Math.max(8, (poll.yesCount / poll.totalVotes) * 100)}%`,
                          },
                        ]}
                      />
                    </View>
                    <View style={styles.poolRow}>
                      <Text style={styles.poolLabel}>
                        YES {formatPercent(poll.yesCount / poll.totalVotes)}
                      </Text>
                      <Text style={styles.poolLabel}>
                        {poll.totalVotes} votes
                      </Text>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${Math.max(8, yesProbability * 100)}%` },
                        ]}
                      />
                    </View>
                    <View style={styles.poolRow}>
                      <Text style={styles.poolLabel}>
                        YES {formatPercent(yesProbability)}
                      </Text>
                      <Text style={styles.poolLabel}>
                        {formatPoints(market.totalVolume ?? totalPool)} pts
                      </Text>
                    </View>
                  </>
                )}

                {/* Inline voting */}
                {pollClosed ? (
                  <View style={styles.closedBanner}>
                    <Text style={styles.closedText}>Poll closed</Text>
                  </View>
                ) : voted ? (
                  <View style={styles.votedBanner}>
                    <Text style={styles.votedText}>
                      {voted === "YES" || voted === "NO"
                        ? `You voted ${voted}`
                        : `Your guess: ${voted}${poll?.unit ? ` ${poll.unit}` : ""}`}
                    </Text>
                  </View>
                ) : poll ? (
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
                          if (!isNaN(val)) handleVote(undefined, val);
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
                        onPress={() => handleVote("YES")}
                        disabled={voting}
                      >
                        {voting ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.yesBtnText}>YES</Text>
                        )}
                      </Pressable>
                      <Pressable
                        style={[styles.noBtn, voting && styles.btnDisabled]}
                        onPress={() => handleVote("NO")}
                        disabled={voting}
                      >
                        {voting ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.noBtnText}>NO</Text>
                        )}
                      </Pressable>
                    </View>
                  )
                ) : (
                  <Link href={`/market/${market.id}`} style={styles.link}>
                    Predict →
                  </Link>
                )}

                {error ? (
                  <Text style={styles.errorText}>{error}</Text>
                ) : null}
              </View>
            ) : (
              <View style={styles.marketBlock}>
                <Text style={styles.marketTitle}>Poll attaching</Text>
                <Text style={styles.summary}>
                  This story is live in the feed while poll generation catches
                  up.
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  heroImage: {
    width: "100%",
    height: 200,
  },
  content: {
    flex: 1,
    padding: spacing.xl,
    justifyContent: "center",
  },
  category: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.accent,
  },
  headline: {
    marginTop: spacing.sm,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "700",
    color: colors.text,
  },
  headlineCompact: {
    fontSize: 24,
    lineHeight: 30,
  },
  summary: {
    marginTop: spacing.md,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
  },
  metaRow: {
    marginTop: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  source: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  published: {
    fontSize: 13,
    color: colors.textMuted,
  },
  marketBlock: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  marketTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.text,
  },
  progressTrack: {
    marginTop: spacing.md,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: "#DCE3F2",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  poolRow: {
    marginTop: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  poolLabel: {
    fontSize: 13,
    color: colors.textMuted,
  },
  // Binary vote buttons
  binaryVoteRow: {
    marginTop: spacing.md,
    flexDirection: "row",
    gap: spacing.md,
  },
  yesBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: "#16A34A",
    alignItems: "center",
    justifyContent: "center",
  },
  yesBtnText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 1,
  },
  noBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
  },
  noBtnText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 1,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  // Numeric vote
  numericVoteRow: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  numericInput: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: "#fff",
  },
  unitLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
  },
  submitBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
  // Voted state
  votedBanner: {
    marginTop: spacing.md,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: "#E0F2FE",
    alignItems: "center",
  },
  votedText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0369A1",
  },
  // Closed state
  closedBanner: {
    marginTop: spacing.md,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
  },
  closedText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#6B7280",
  },
  errorText: {
    marginTop: spacing.sm,
    fontSize: 13,
    color: "#DC2626",
  },
  link: {
    marginTop: spacing.lg,
    fontSize: 15,
    fontWeight: "700",
    color: colors.primary,
  },
});
