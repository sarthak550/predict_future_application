import { router } from "expo-router";
import { Stack } from "expo-router";
import { useRef, useState } from "react";
import {
  FlatList,
  ListRenderItemInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { radius, spacing, typography } from "@predict-future/ui-tokens";
import { useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SlideId = "intro" | "how-it-works" | "host";

interface Slide {
  id: SlideId;
  index: number;
}

const SLIDES: Slide[] = [
  { id: "intro", index: 0 },
  { id: "how-it-works", index: 1 },
  { id: "host", index: 2 },
];

// ---------------------------------------------------------------------------
// Styles factory (shared across all sub-components)
// ---------------------------------------------------------------------------

const PROGRESS_TRACK_HEIGHT = 8;

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.colors.background,
  },
  skipButton: {
    position: "absolute",
    top: spacing["2xl"] + spacing.lg,
    right: spacing.xl,
    zIndex: 10,
  },
  skipText: {
    fontSize: 14,
    color: t.colors.textMuted,
    fontWeight: "500",
  },
  flatList: {
    flex: 1,
  },

  // Slide layout
  slide: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing["2xl"] * 2,
    paddingBottom: spacing.xl,
    justifyContent: "center",
  },

  // Intro illustration
  illustrationBox: {
    width: 120,
    height: 120,
    borderRadius: radius.lg,
    backgroundColor: t.colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: spacing["2xl"],
  },
  illustrationEmoji: {
    fontSize: 56,
  },

  // Shared slide text
  slideTitle: {
    fontSize: typography.title,
    fontWeight: "700",
    color: t.colors.text,
    marginBottom: spacing.lg,
    textAlign: "center",
  },
  slideBody: {
    fontSize: typography.body,
    color: t.colors.textMuted,
    lineHeight: 26,
    textAlign: "center",
  },

  // How it works — step rows
  stepList: {
    marginTop: spacing["2xl"],
    gap: spacing.xl,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: t.colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  stepEmoji: {
    fontSize: 28,
    lineHeight: 36,
  },
  stepText: {
    flex: 1,
  },
  stepLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: t.colors.text,
    marginBottom: spacing.xs,
  },
  stepDescription: {
    fontSize: 14,
    color: t.colors.textMuted,
    lineHeight: 20,
  },

  // Host slide — progress card
  progressCard: {
    marginTop: spacing["2xl"],
    backgroundColor: t.colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  progressCardTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: t.colors.textMuted,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // Progress bar rows
  progressRow: {
    gap: spacing.sm,
  },
  progressLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: t.colors.text,
  },
  progressValue: {
    fontSize: 13,
    color: t.colors.textMuted,
  },
  progressTrack: {
    height: PROGRESS_TRACK_HEIGHT,
    backgroundColor: t.colors.border,
    borderRadius: radius.pill,
    flexDirection: "row",
    overflow: "hidden",
  },
  progressFill: {
    height: PROGRESS_TRACK_HEIGHT,
    backgroundColor: t.colors.accent,
    borderRadius: radius.pill,
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing["2xl"] + spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.lg,
    backgroundColor: t.colors.background,
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    backgroundColor: t.colors.accent,
  },
  dotInactive: {
    backgroundColor: t.colors.border,
  },

  // Primary action button
  primaryButton: {
    backgroundColor: t.colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md + 2,
    alignItems: "center",
    justifyContent: "center",
  },
  accentButton: {
    backgroundColor: t.colors.success,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
});

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function IntroSlide({ width }: { width: number }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.slide, { width }]}>
      <View style={styles.illustrationBox}>
        <Text style={styles.illustrationEmoji}>🔮</Text>
      </View>
      <Text style={styles.slideTitle}>Predict the Future</Text>
      <Text style={styles.slideBody}>
        Make predictions on today's news. Earn virtual points when you're right.
        No real money — just your instincts vs the crowd.
      </Text>
    </View>
  );
}

function HowItWorksSlide({ width }: { width: number }) {
  const styles = useThemedStyles(makeStyles);
  const steps: { emoji: string; label: string; description: string }[] = [
    {
      emoji: "📰",
      label: "Read the news",
      description: "Browse today's headlines. Each story has a prediction question.",
    },
    {
      emoji: "🎯",
      label: "Pick YES or NO",
      description: "Vote on the outcome. The crowd's odds update in real time.",
    },
    {
      emoji: "🏆",
      label: "Win points",
      description: "If you're right, you earn from the pool. Build your reputation.",
    },
  ];

  return (
    <View style={[styles.slide, { width }]}>
      <Text style={styles.slideTitle}>How It Works</Text>
      <View style={styles.stepList}>
        {steps.map((step) => (
          <View key={step.label} style={styles.stepRow}>
            <Text style={styles.stepEmoji}>{step.emoji}</Text>
            <View style={styles.stepText}>
              <Text style={styles.stepLabel}>{step.label}</Text>
              <Text style={styles.stepDescription}>{step.description}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

interface ProgressBarRowProps {
  label: string;
  current: number;
  target: number;
  unit?: string;
}

function ProgressBarRow({ label, current, target, unit = "" }: ProgressBarRowProps) {
  const styles = useThemedStyles(makeStyles);
  const fill = target > 0 ? Math.min(current / target, 1) : 0;

  return (
    <View style={styles.progressRow}>
      <View style={styles.progressLabelRow}>
        <Text style={styles.progressLabel}>{label}</Text>
        <Text style={styles.progressValue}>
          {current} / {target}
          {unit ? ` ${unit}` : ""}
        </Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { flex: fill }]} />
        <View style={{ flex: 1 - fill }} />
      </View>
    </View>
  );
}

function HostSlide({ width }: { width: number }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.slide, { width }]}>
      <Text style={styles.slideTitle}>Become a Host</Text>
      <Text style={styles.slideBody}>
        Create your own prediction markets. Earn a commission when others
        participate. Unlock Trusted Host status as you build your track record.
      </Text>
      <View style={styles.progressCard}>
        <Text style={styles.progressCardTitle}>Your path to Trusted Host</Text>
        <ProgressBarRow label="Account age" current={0} target={14} unit="days" />
        <ProgressBarRow label="Markets resolved" current={0} target={2} />
        <ProgressBarRow label="Trust score" current={0} target={55} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Dot indicators
// ---------------------------------------------------------------------------

function DotIndicators({
  count,
  activeIndex,
}: {
  count: number;
  activeIndex: number;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={[styles.dot, i === activeIndex ? styles.dotActive : styles.dotInactive]}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function OnboardingScreen() {
  const { width } = useWindowDimensions();
  const flatListRef = useRef<FlatList<Slide>>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const styles = useThemedStyles(makeStyles);

  function handleSkip() {
    router.replace("/(tabs)/feed");
  }

  function handleNext() {
    const next = activeIndex + 1;
    if (next < SLIDES.length) {
      flatListRef.current?.scrollToIndex({ index: next, animated: true });
      setActiveIndex(next);
    }
  }

  function handleComplete() {
    router.replace("/(tabs)/feed");
  }

  function renderSlide({ item }: ListRenderItemInfo<Slide>) {
    switch (item.id) {
      case "intro":
        return <IntroSlide width={width} />;
      case "how-it-works":
        return <HowItWorksSlide width={width} />;
      case "host":
        return <HostSlide width={width} />;
    }
  }

  const isLastSlide = activeIndex === SLIDES.length - 1;

  return (
    <View style={styles.container}>
      {/* Hide the default expo-router stack header */}
      <Stack.Screen options={{ headerShown: false }} />

      {/* Skip button — always top-right */}
      <Pressable
        onPress={handleSkip}
        style={styles.skipButton}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.skipText}>Skip</Text>
      </Pressable>

      {/* Slides */}
      <FlatList
        ref={flatListRef}
        data={SLIDES}
        keyExtractor={(item) => item.id}
        renderItem={renderSlide}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => {
          const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
          setActiveIndex(newIndex);
        }}
        style={styles.flatList}
        getItemLayout={(_, index) => ({
          length: width,
          offset: width * index,
          index,
        })}
      />

      {/* Bottom controls */}
      <View style={styles.bottomBar}>
        <DotIndicators count={SLIDES.length} activeIndex={activeIndex} />

        {isLastSlide ? (
          <Pressable style={[styles.primaryButton, styles.accentButton]} onPress={handleComplete}>
            <Text style={styles.primaryButtonText}>Get Started</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.primaryButton} onPress={handleNext}>
            <Text style={styles.primaryButtonText}>Next →</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
