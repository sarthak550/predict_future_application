/**
 * SectionHelp — a compact "?" badge that opens a HelpSheet for a given content key.
 *
 * Design: 18×18 circle with a 1px outline border, "?" at 11/600.
 *   variant="default" — uses colors.textMuted for both border and text (for use on
 *                       light/surface backgrounds).
 *   variant="light"   — uses rgba(255,255,255,0.6) (for use on the gradient header).
 *
 * Self-contained: each SectionHelp renders its own HelpSheet with local `visible`
 * state, so callers don't need to manage modal state.
 */

import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/providers/theme-provider";
import { HELP_CONTENT } from "@/constants/help-content";
import { HelpSheet } from "@/components/help-sheet";

type Props = {
  helpKey: string;
  variant?: "default" | "light";
};

export function SectionHelp({ helpKey, variant = "default" }: Props) {
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);

  const content = HELP_CONTENT[helpKey];
  const accessibilityLabel = content ? `Help: ${content.title}` : "Help";

  const borderColor =
    variant === "light" ? "rgba(255,255,255,0.6)" : colors.textMuted;
  const textColor =
    variant === "light" ? "rgba(255,255,255,0.6)" : colors.textMuted;

  return (
    <>
      <Pressable
        onPress={() => setVisible(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        <View style={[styles.circle, { borderColor }]}>
          <Text style={[styles.mark, { color: textColor }]}>?</Text>
        </View>
      </Pressable>

      <HelpSheet
        visible={visible}
        helpKey={helpKey}
        onClose={() => setVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  mark: {
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 14,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
});
