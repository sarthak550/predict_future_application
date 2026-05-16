/**
 * StreakReminder
 *
 * Fires once per calendar day when the authenticated user has a streak >= 3
 * and has not yet made a prediction today.
 *
 * Also surfaces a one-time "streak reset" banner when the user's streak
 * drops to 0 (compared against a previously-persisted value).
 *
 * AsyncStorage keys:
 *   streak_reminder_shown_date  — ISO date string (YYYY-MM-DD), prevents showing > once/day
 *   streak_last_known           — previous streak integer, used to detect resets
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "@predict-future/ui-tokens";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";

const REMINDER_DATE_KEY = "streak_reminder_shown_date";
const LAST_STREAK_KEY = "streak_last_known";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function hasPredictedToday(lastPredictionAt: string | null | undefined): boolean {
  if (!lastPredictionAt) return false;
  const predDate = new Date(lastPredictionAt).toISOString().slice(0, 10);
  return predDate === todayISO();
}

type ModalVariant = "reminder" | "reset" | null;

export function StreakReminder() {
  const { session, status } = useSession();
  const router = useRouter();
  const [variant, setVariant] = useState<ModalVariant>(null);
  const [streak, setStreak] = useState(0);
  const [fadeAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (status !== "authenticated" || !session) return;

    void (async () => {
      try {
        const profile = await mobileApi.getMyProfile();
        const currentStreak = profile.user.streak ?? 0;
        const lastPredAt = profile.user.lastPredictionAt ?? null;

        // Read previously persisted streak to detect reset
        const lastKnownRaw = await AsyncStorage.getItem(LAST_STREAK_KEY);
        const lastKnown = lastKnownRaw != null ? parseInt(lastKnownRaw, 10) : null;

        // Persist current streak for next comparison
        await AsyncStorage.setItem(LAST_STREAK_KEY, String(currentStreak));

        // Check if streak just reset
        if (lastKnown != null && lastKnown > 0 && currentStreak === 0) {
          setStreak(0);
          setVariant("reset");
          fadeIn();
          return;
        }

        // Check streak reminder
        if (currentStreak >= 3 && !hasPredictedToday(lastPredAt)) {
          const shownDate = await AsyncStorage.getItem(REMINDER_DATE_KEY);
          if (shownDate !== todayISO()) {
            await AsyncStorage.setItem(REMINDER_DATE_KEY, todayISO());
            setStreak(currentStreak);
            setVariant("reminder");
            fadeIn();
          }
        }
      } catch {
        // Best-effort — never surface streak errors to the user
      }
    })();
  // Intentionally runs once per mount (session becoming authenticated)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function fadeIn() {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }

  function dismiss() {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setVariant(null));
  }

  function goPredict() {
    dismiss();
    // Small delay so modal animates out before navigation
    setTimeout(() => {
      router.replace("/(tabs)/feed");
    }, 220);
  }

  if (!variant) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={dismiss}
    >
      <Animated.View style={[sStyles.overlay, { opacity: fadeAnim }]}>
        <View style={sStyles.card}>
          {variant === "reminder" ? (
            <>
              <Text style={sStyles.emoji}>🔥</Text>
              <Text style={sStyles.title}>
                {streak >= 7
                  ? `${streak}-day Weekly Streak!`
                  : `Your ${streak}-day streak is at risk!`}
              </Text>
              <Text style={sStyles.body}>
                Make a prediction today to keep it alive.
              </Text>
              <Pressable
                style={[sStyles.primaryBtn, streak >= 7 && sStyles.goldBtn]}
                onPress={goPredict}
              >
                <Text style={sStyles.primaryBtnText}>Go Predict</Text>
              </Pressable>
              <Pressable onPress={dismiss} style={sStyles.laterBtn}>
                <Text style={sStyles.laterText}>Later</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={sStyles.emoji}>💔</Text>
              <Text style={sStyles.title}>Streak Reset</Text>
              <Text style={sStyles.body}>
                Your streak reset. Start a new one today!
              </Text>
              <Pressable style={sStyles.primaryBtn} onPress={goPredict}>
                <Text style={sStyles.primaryBtnText}>Start Fresh</Text>
              </Pressable>
              <Pressable onPress={dismiss} style={sStyles.laterBtn}>
                <Text style={sStyles.laterText}>Dismiss</Text>
              </Pressable>
            </>
          )}
        </View>
      </Animated.View>
    </Modal>
  );
}

// ── Streak badge (shown inline in Feed header) ────────────────────────────────

type StreakBadgeProps = {
  streak: number;
  onPress: () => void;
};

export function StreakBadge({ streak, onPress }: StreakBadgeProps) {
  if (streak < 2) return null;

  const isWeekly = streak >= 7;
  return (
    <Pressable
      onPress={onPress}
      style={[sStyles.badge, isWeekly && sStyles.badgeGold]}
      hitSlop={8}
    >
      <Text style={sStyles.badgeEmoji}>🔥</Text>
      <Text style={[sStyles.badgeText, isWeekly && sStyles.badgeTextGold]}>
        {streak}
      </Text>
    </Pressable>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const sStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    width: "100%",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
  },
  emoji: {
    fontSize: 52,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
    textAlign: "center",
    marginBottom: spacing.xl,
  },
  primaryBtn: {
    width: "100%",
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  goldBtn: {
    backgroundColor: "#D97706",
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  laterBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  laterText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
  },
  // Feed header badge
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: "rgba(251,191,36,0.15)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.3)",
  },
  badgeGold: {
    backgroundColor: "rgba(217,119,6,0.15)",
    borderColor: "#D97706",
  },
  badgeEmoji: {
    fontSize: 13,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#D97706",
  },
  badgeTextGold: {
    color: "#B45309",
  },
});
