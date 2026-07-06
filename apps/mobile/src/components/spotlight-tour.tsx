/**
 * SpotlightTour
 *
 * A reusable guided tour overlay. Each step:
 *  1. Calls scrollIntoView() so the target is visible.
 *  2. After a 350ms settle delay, calls measure() to get the on-screen rect.
 *  3. Draws a pulsing highlight ring around that rect.
 *  4. Shows a caption card (title/body/step dots/Skip/Next) either above or
 *     below the highlighted element so it never covers the thing it explains.
 *
 * Visual style mirrors OnboardingWalkthrough exactly: same dark backdrop, same
 * card tokens (surface bg, accent dots, etc.). Theme-aware except the intentional
 * dark overlay and white highlight.
 *
 * Usage:
 *   import { SpotlightTour, makeTourStep } from "@/components/spotlight-tour";
 *
 *   const ref = useRef<View>(null);
 *   const scrollRef = useRef<ScrollView>(null);
 *   const steps = [
 *     makeTourStep("feed-intro", ref, {
 *       scrollIntoView: () => scrollRef.current?.scrollTo({ y: 0, animated: true }),
 *     }),
 *   ];
 */

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

import { radius, spacing } from "@predict-future/ui-tokens";
import { useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";
import { HELP_CONTENT } from "@/constants/help-content";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ElementRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TourStep = {
  helpKey: string;
  measure: () => Promise<ElementRect | null>;
  scrollIntoView?: () => void;
};

export type SpotlightTourProps = {
  visible: boolean;
  steps: TourStep[];
  onClose: () => void;
};

// ── Helper: build a TourStep from a React ref ──────────────────────────────────

/**
 * makeTourStep — convenience factory that creates a TourStep from a ref.
 *
 * @param helpKey  Key into HELP_CONTENT.
 * @param ref      A ref attached to the section View.
 * @param opts     Optional scrollIntoView callback.
 */
export function makeTourStep(
  helpKey: string,
  ref: React.RefObject<View | null>,
  opts?: { scrollIntoView?: () => void }
): TourStep {
  return {
    helpKey,
    measure: () =>
      new Promise((resolve) => {
        if (!ref.current) {
          resolve(null);
          return;
        }
        try {
          ref.current.measureInWindow((x, y, width, height) => {
            if (width === 0 && height === 0) {
              resolve(null);
            } else {
              resolve({ x, y, width, height });
            }
          });
        } catch {
          resolve(null);
        }
      }),
    scrollIntoView: opts?.scrollIntoView,
  };
}

// ── Constants ──────────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

/** How long to wait after scrollIntoView before measuring (ms) */
const SCROLL_SETTLE_MS = 350;

/** Padding around the highlighted rect (makes ring larger than element) */
const RING_PADDING = 8;

/** Estimated card height for initial layout (updated once card renders) */
const CARD_APPROX_HEIGHT = 200;

/** Card horizontal margin */
const CARD_H_MARGIN = spacing.xl;

// ── Styles ─────────────────────────────────────────────────────────────────────

const makeStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    // Full-screen dark overlay — intentionally static (no theme)
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.72)",
    },
    // Pulsing highlight ring around the target element
    ring: {
      position: "absolute",
      // Intentional translucent white highlight on dark overlay — keep static
      backgroundColor: "rgba(255,255,255,0.12)",
      borderWidth: 2,
      borderColor: "rgba(255,255,255,0.72)",
      borderRadius: radius.lg,
    },
    // Caption card
    card: {
      position: "absolute",
      left: CARD_H_MARGIN,
      right: CARD_H_MARGIN,
      backgroundColor: t.colors.surface,
      borderRadius: radius.lg,
      padding: spacing.xl,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.3,
      shadowRadius: 20,
      elevation: 12,
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
      backgroundColor: t.colors.border,
    },
    stepDotActive: {
      backgroundColor: t.colors.accent,
      width: 20,
    },
    cardTitle: {
      fontSize: 20,
      fontWeight: "800",
      color: t.colors.text,
      marginBottom: spacing.sm,
    },
    cardBody: {
      fontSize: 15,
      lineHeight: 22,
      color: t.colors.textMuted,
      marginBottom: spacing.lg,
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
      color: t.colors.textMuted,
    },
    nextBtn: {
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.xl,
      backgroundColor: t.colors.accent,
      borderRadius: radius.pill,
    },
    nextText: {
      fontSize: 15,
      fontWeight: "700",
      color: "#FFFFFF",
    },
  });

// ── Component ──────────────────────────────────────────────────────────────────

export function SpotlightTour({ visible, steps, onClose }: SpotlightTourProps) {
  const s = useThemedStyles(makeStyles);

  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<ElementRect | null>(null);

  // Animated values
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Mount guard — prevents state updates after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Measured card height (updated via onLayout)
  const cardHeightRef = useRef(CARD_APPROX_HEIGHT);

  // ── Fade in/out when visibility changes ──────────────────────────────────────

  useEffect(() => {
    if (visible) {
      setStepIdx(0);
      setRect(null);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ── Measure the active step's element after scroll settles ──────────────────

  useEffect(() => {
    if (!visible || steps.length === 0) return;

    const step = steps[stepIdx];
    if (!step) return;

    // Start scrolling — measurement happens after settle delay
    step.scrollIntoView?.();

    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled || !mountedRef.current) return;
      const measured = await step.measure();
      if (!cancelled && mountedRef.current) {
        setRect(measured);
        // Reset + restart pulse on each step
        pulseAnim.setValue(1);
      }
    }, SCROLL_SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, stepIdx]);

  // ── Pulse animation ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.04,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, stepIdx]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleNext() {
    const next = stepIdx + 1;
    if (next >= steps.length) {
      onClose();
      return;
    }
    setRect(null);
    pulseAnim.setValue(1);
    setStepIdx(next);
  }

  function handleSkip() {
    onClose();
  }

  // ── Early exits ───────────────────────────────────────────────────────────────

  if (!visible || steps.length === 0) return null;

  const step = steps[stepIdx];
  if (!step) return null;

  const content = HELP_CONTENT[step.helpKey];
  const title = content?.title ?? step.helpKey;
  const body = content?.body ?? "";
  const isLast = stepIdx === steps.length - 1;

  // ── Highlight ring geometry ───────────────────────────────────────────────────

  let ringLeft = 0;
  let ringTop = 0;
  let ringWidth = SCREEN_WIDTH;
  let ringHeight = 80;

  if (rect) {
    ringLeft = rect.x - RING_PADDING;
    ringTop = rect.y - RING_PADDING;
    ringWidth = rect.width + RING_PADDING * 2;
    ringHeight = rect.height + RING_PADDING * 2;
  }

  const ringBorderRadius = Math.min(radius.lg, ringHeight / 2);

  // ── Card vertical positioning ─────────────────────────────────────────────────

  // If the element's centre is in the lower half of the screen → card above it.
  // Otherwise card below. Clamp within screen bounds.
  const elementCentreY = rect ? rect.y + rect.height / 2 : SCREEN_HEIGHT / 2;
  const cardInLowerHalf = elementCentreY > SCREEN_HEIGHT / 2;

  const CARD_MARGIN = 16;

  let cardTop: number;
  if (cardInLowerHalf) {
    // Place card above the ring
    cardTop = ringTop - cardHeightRef.current - CARD_MARGIN;
    if (cardTop < 24) cardTop = 24; // clamp at top
  } else {
    // Place card below the ring
    cardTop = ringTop + ringHeight + CARD_MARGIN;
    // Clamp so card doesn't overflow bottom
    const maxBottom = SCREEN_HEIGHT - cardHeightRef.current - 24;
    if (cardTop > maxBottom) cardTop = maxBottom;
  }

  // If there's no rect yet (still measuring), centre the card vertically
  if (!rect) {
    cardTop = SCREEN_HEIGHT * 0.35;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleSkip}
    >
      <Animated.View style={[s.overlay, { opacity: fadeAnim }]}>

        {/* Highlight ring around target element */}
        {rect ? (
          <Animated.View
            style={[
              s.ring,
              {
                left: ringLeft,
                top: ringTop,
                width: ringWidth,
                height: ringHeight,
                borderRadius: ringBorderRadius,
                transform: [{ scale: pulseAnim }],
              },
            ]}
          />
        ) : null}

        {/* Caption card */}
        <View
          style={[s.card, { top: cardTop }]}
          onLayout={(e) => {
            cardHeightRef.current = e.nativeEvent.layout.height;
          }}
        >
          {/* Step dots */}
          <View style={s.stepRow}>
            {steps.map((_, i) => (
              <View
                key={i}
                style={[s.stepDot, i === stepIdx && s.stepDotActive]}
              />
            ))}
          </View>

          <Text style={s.cardTitle}>{title}</Text>
          <Text style={s.cardBody}>{body}</Text>

          <View style={s.actionRow}>
            <Pressable onPress={handleSkip} style={s.skipBtn} hitSlop={8}>
              <Text style={s.skipText}>Skip</Text>
            </Pressable>
            <Pressable onPress={handleNext} style={s.nextBtn} hitSlop={8}>
              <Text style={s.nextText}>{isLast ? "Done" : "Next"}</Text>
            </Pressable>
          </View>
        </View>

      </Animated.View>
    </Modal>
  );
}
