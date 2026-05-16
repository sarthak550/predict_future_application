/**
 * OnboardingWalkthrough
 *
 * A 4-step modal-overlay tooltip sequence shown exactly once per installation.
 * Persisted via AsyncStorage key "onboarding_complete".
 *
 * Each step uses a full-screen semi-transparent backdrop with a
 * highlighted "spotlight" region that visually draws the user's eye to
 * the relevant tab/element. No native spotlight library required.
 *
 * Export:
 *   - OnboardingWalkthrough  — renders the overlay; call from root _layout or
 *                              tabs _layout after auth resolves.
 *   - resetOnboarding()      — clears the AsyncStorage key; used by "Replay tutorial"
 *                              in Profile settings.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { colors, radius, spacing } from "@predict-future/ui-tokens";

// ── Constants ─────────────────────────────────────────────────────────────────

export const ONBOARDING_KEY = "onboarding_complete";

export async function resetOnboarding(): Promise<void> {
  await AsyncStorage.removeItem(ONBOARDING_KEY);
}

type Step = {
  step: number;
  title: string;
  body: string;
  /** Which tab bar item to highlight (0-indexed left-to-right). null = no highlight */
  tabIndex: number | null;
  /** Icon emoji shown in the spotlight cutout */
  spotlightEmoji: string;
};

const STEPS: Step[] = [
  {
    step: 1,
    title: "Today's News",
    body: "Swipe up through today's news. Every story has a prediction attached.",
    tabIndex: 0,
    spotlightEmoji: "📰",
  },
  {
    step: 2,
    title: "Cast Your Vote",
    body: "Tap YES or NO to vote. Your accuracy score improves with each correct prediction.",
    tabIndex: 0,
    spotlightEmoji: "✅",
  },
  {
    step: 3,
    title: "Stake Points",
    body: "Stake virtual points on outcomes you believe in. Top predictors earn reputation and badges.",
    tabIndex: 3,
    spotlightEmoji: "📈",
  },
  {
    step: 4,
    title: "Your Profile",
    body: "Track your points, accuracy, and streak here.",
    tabIndex: 4,
    spotlightEmoji: "👤",
  },
];

const TAB_COUNT = 5; // Feed, Sports, Create, Markets, Profile
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const TAB_BAR_HEIGHT = 72;
const TAB_WIDTH = SCREEN_WIDTH / TAB_COUNT;

// ── Component ─────────────────────────────────────────────────────────────────

export function OnboardingWalkthrough() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Check AsyncStorage once on mount
  useEffect(() => {
    void AsyncStorage.getItem(ONBOARDING_KEY).then((val) => {
      if (val !== "true") {
        setVisible(true);
      }
    });
  }, []);

  // Fade in when visible
  useEffect(() => {
    if (visible) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, fadeAnim]);

  // Pulse animation for spotlight
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.18,
          duration: 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulseAnim, stepIdx]);

  async function complete() {
    await AsyncStorage.setItem(ONBOARDING_KEY, "true");
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setVisible(false));
  }

  async function handleNext() {
    const nextIdx = stepIdx + 1;
    if (nextIdx >= STEPS.length) {
      await complete();
      return;
    }
    // Navigate to the relevant tab when the step changes
    const nextStep = STEPS[nextIdx];
    if (nextStep.tabIndex === 3) {
      router.replace("/(tabs)/markets");
    } else if (nextStep.tabIndex === 4) {
      router.replace("/(tabs)/profile");
    } else {
      router.replace("/(tabs)/feed");
    }
    // Reset pulse
    pulseAnim.setValue(1);
    setStepIdx(nextIdx);
  }

  async function handleSkip() {
    await complete();
  }

  if (!visible) return null;

  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;

  // Compute spotlight position in the tab bar
  let spotlightX: number | null = null;
  let spotlightY: number | null = null;
  if (step.tabIndex !== null) {
    spotlightX = step.tabIndex * TAB_WIDTH + TAB_WIDTH / 2;
    spotlightY = SCREEN_HEIGHT - TAB_BAR_HEIGHT / 2;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleSkip}
    >
      <Animated.View style={[walkStyles.overlay, { opacity: fadeAnim }]}>
        {/* Tab-bar spotlight */}
        {spotlightX !== null && spotlightY !== null && (
          <Animated.View
            style={[
              walkStyles.spotlight,
              {
                left: spotlightX - 28,
                top: spotlightY - 28,
                transform: [{ scale: pulseAnim }],
              },
            ]}
          >
            <Text style={walkStyles.spotlightEmoji}>{step.spotlightEmoji}</Text>
          </Animated.View>
        )}

        {/* Tooltip card — positioned in upper-center for steps 1-2 or mid-screen */}
        <View
          style={[
            walkStyles.card,
            stepIdx < 2 ? walkStyles.cardTop : walkStyles.cardMid,
          ]}
        >
          {/* Step indicator */}
          <View style={walkStyles.stepRow}>
            {STEPS.map((_, i) => (
              <View
                key={i}
                style={[
                  walkStyles.stepDot,
                  i === stepIdx && walkStyles.stepDotActive,
                ]}
              />
            ))}
          </View>

          <Text style={walkStyles.cardTitle}>{step.title}</Text>
          <Text style={walkStyles.cardBody}>{step.body}</Text>

          {/* Arrow pointing down toward tab bar for steps 3 & 4 */}
          {step.tabIndex !== null && stepIdx >= 2 && (
            <View style={walkStyles.arrowDown} />
          )}

          {/* Arrow pointing down from card to feed content for steps 1-2 */}
          {stepIdx < 2 && (
            <View style={walkStyles.arrowDownFromCard} />
          )}

          {/* Actions */}
          <View style={walkStyles.actionRow}>
            <Pressable onPress={handleSkip} style={walkStyles.skipBtn}>
              <Text style={walkStyles.skipText}>Skip</Text>
            </Pressable>
            <Pressable onPress={handleNext} style={walkStyles.nextBtn}>
              <Text style={walkStyles.nextText}>
                {isLast ? "Done" : "Next"}
              </Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const walkStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  spotlight: {
    position: "absolute",
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  spotlightEmoji: {
    fontSize: 22,
  },
  card: {
    position: "absolute",
    left: spacing.xl,
    right: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 12,
  },
  cardTop: {
    top: 120,
  },
  cardMid: {
    top: SCREEN_HEIGHT * 0.3,
  },
  stepRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: spacing.md,
  },
  stepDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  stepDotActive: {
    backgroundColor: colors.accent,
    width: 20,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  cardBody: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  arrowDown: {
    width: 0,
    height: 0,
    alignSelf: "center",
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderTopWidth: 14,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: colors.accent,
    marginBottom: spacing.md,
  },
  arrowDownFromCard: {
    width: 0,
    height: 0,
    alignSelf: "center",
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderTopWidth: 14,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: colors.border,
    marginBottom: spacing.md,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  skipBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  skipText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
  },
  nextBtn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
  },
  nextText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
