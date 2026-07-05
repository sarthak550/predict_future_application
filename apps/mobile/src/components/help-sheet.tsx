/**
 * HelpSheet — bottom sheet that displays help content for a given key.
 *
 * Standalone mode (no tourKeys): shows title + body + "Got it" button.
 * Tour mode (tourKeys provided): walks through a sequence of keys with a
 * progress bar and Back / Next buttons. "Next" becomes "Finish" on the last step.
 *
 * All colours come from useTheme() — fully dark-mode aware.
 */

import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { radius, spacing } from "@predict-future/ui-tokens";
import { useTheme } from "@/providers/theme-provider";
import { HELP_CONTENT } from "@/constants/help-content";

type Props = {
  visible: boolean;
  helpKey: string;
  onClose: () => void;
  /** When provided, renders in tour mode and steps through these keys in order. */
  tourKeys?: string[];
};

export function HelpSheet({ visible, helpKey, onClose, tourKeys }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // In tour mode, currentKey tracks which step we're on.
  // Reset to helpKey whenever visible becomes true so re-opening starts fresh.
  const [currentKey, setCurrentKey] = useState(helpKey);
  useEffect(() => {
    if (visible) {
      setCurrentKey(helpKey);
    }
  }, [visible, helpKey]);

  const isTour = Array.isArray(tourKeys) && tourKeys.length > 0;
  const stepIndex = isTour ? (tourKeys!.indexOf(currentKey) >= 0 ? tourKeys!.indexOf(currentKey) : 0) : 0;
  const totalSteps = isTour ? tourKeys!.length : 1;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === totalSteps - 1;

  const content = HELP_CONTENT[currentKey] ?? { title: currentKey, body: "" };

  function handleBack() {
    if (isFirst || !isTour) return;
    setCurrentKey(tourKeys![stepIndex - 1]!);
  }

  function handleNext() {
    if (!isTour) {
      onClose();
      return;
    }
    if (isLast) {
      onClose();
    } else {
      setCurrentKey(tourKeys![stepIndex + 1]!);
    }
  }

  const s = makeStyles(colors, insets.bottom);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      {/* Backdrop — tapping outside closes the sheet */}
      <Pressable style={s.backdrop} onPress={onClose} />

      <View style={s.panel}>
        {/* Drag handle */}
        <View style={s.handle} />

        {/* Tour progress (only in tour mode) */}
        {isTour && (
          <View style={s.progressWrap}>
            <Text style={s.stepLabel}>
              Step {stepIndex + 1} of {totalSteps}
            </Text>
            <View style={s.progressTrack}>
              <View
                style={[
                  s.progressFill,
                  { width: `${((stepIndex + 1) / totalSteps) * 100}%` },
                ]}
              />
            </View>
          </View>
        )}

        {/* Title */}
        <Text style={s.title}>{content.title}</Text>

        {/* Body */}
        <Text style={s.body}>{content.body}</Text>

        {/* Actions */}
        {isTour ? (
          <View style={s.tourActions}>
            <Pressable
              style={[s.backBtn, isFirst && s.btnDisabled]}
              onPress={handleBack}
              disabled={isFirst}
              accessibilityLabel="Previous step"
            >
              <Text style={[s.backBtnText, isFirst && s.backBtnTextDisabled]}>
                Back
              </Text>
            </Pressable>
            <Pressable
              style={s.nextBtn}
              onPress={handleNext}
              accessibilityLabel={isLast ? "Finish tour" : "Next step"}
            >
              <Text style={s.nextBtnText}>{isLast ? "Finish" : "Next"}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={s.gotItBtn}
            onPress={onClose}
            accessibilityLabel="Got it"
          >
            <Text style={s.gotItBtnText}>Got it</Text>
          </Pressable>
        )}
      </View>
    </Modal>
  );
}

// Styles are built inline (not via useThemedStyles) so we can pass colors +
// insets without the factory pattern needing the full ThemeContextValue.
function makeStyles(
  colors: ReturnType<typeof useTheme>["colors"],
  bottomInset: number
) {
  return StyleSheet.create({
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    panel: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      paddingBottom: Math.max(bottomInset, 16) + 16,
    },
    handle: {
      alignSelf: "center",
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderMuted,
      marginBottom: spacing.lg,
    },
    progressWrap: {
      marginBottom: spacing.md,
      gap: spacing.xs,
    },
    stepLabel: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.textMuted,
      letterSpacing: 0.3,
    },
    progressTrack: {
      height: 3,
      borderRadius: 2,
      backgroundColor: colors.borderMuted,
      overflow: "hidden",
    },
    progressFill: {
      height: "100%",
      borderRadius: 2,
      backgroundColor: colors.accent,
    },
    title: {
      fontSize: 18,
      fontWeight: "800",
      color: colors.text,
      marginBottom: spacing.md,
      lineHeight: 24,
    },
    body: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.textMuted,
      marginBottom: spacing.xl,
    },
    gotItBtn: {
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
      paddingVertical: 14,
      alignItems: "center",
    },
    gotItBtnText: {
      fontSize: 15,
      fontWeight: "700",
      color: "#FFFFFF",
    },
    tourActions: {
      flexDirection: "row",
      gap: spacing.md,
    },
    backBtn: {
      flex: 1,
      borderRadius: radius.pill,
      paddingVertical: 14,
      alignItems: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },
    backBtnText: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.text,
    },
    backBtnTextDisabled: {
      color: colors.textMuted,
    },
    btnDisabled: {
      opacity: 0.4,
    },
    nextBtn: {
      flex: 2,
      borderRadius: radius.pill,
      paddingVertical: 14,
      alignItems: "center",
      backgroundColor: colors.accent,
    },
    nextBtnText: {
      fontSize: 15,
      fontWeight: "700",
      color: "#FFFFFF",
    },
  });
}
