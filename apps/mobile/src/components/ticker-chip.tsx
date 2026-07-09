import { StyleSheet, Text, View } from "react-native";

import type { AppMarketMoveTickerType } from "@predict-future/types";
import { radius, spacing } from "@predict-future/ui-tokens";
import { useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

/**
 * Market Pulse — the ticker/symbol chip shown as the first-class, leading
 * element on every announcement and mover card (CEO hard requirement: the
 * ticker must never be buried in body text). STOCK and INDEX get distinct
 * colors so an index-level item (e.g. "NIFTY 200 rebalancing") is never
 * mistaken for a single tradeable stock:
 *   - STOCK: Pillar B (emerald) — this app's existing "Markets" pillar color.
 *   - INDEX: Pillar A (blue) — this app's existing "Analysts" pillar color,
 *     plus a small "INDEX" caption so the distinction reads even for users
 *     who don't have the pillar-color convention memorized yet.
 */
export function TickerChip({
  symbol,
  tickerType,
  size = "md",
}: {
  symbol: string;
  tickerType: AppMarketMoveTickerType;
  size?: "sm" | "md";
}) {
  const styles = useThemedStyles(makeTickerChipStyles);
  const isIndex = tickerType === "INDEX";

  return (
    <View
      style={[
        styles.chip,
        isIndex ? styles.chipIndex : styles.chipStock,
        size === "sm" && styles.chipSm,
      ]}
    >
      <Text
        style={[
          styles.symbol,
          isIndex ? styles.symbolIndex : styles.symbolStock,
          size === "sm" && styles.symbolSm,
        ]}
        numberOfLines={1}
      >
        {symbol}
      </Text>
      {isIndex && <Text style={styles.indexCaption}>INDEX</Text>}
    </View>
  );
}

const makeTickerChipStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    chip: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.sm,
      borderWidth: 1,
      gap: 5,
    },
    chipSm: {
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    chipStock: {
      backgroundColor: t.colors.pillarBSoft,
      borderColor: t.colors.pillarB,
    },
    chipIndex: {
      backgroundColor: t.colors.pillarASoft,
      borderColor: t.colors.pillarA,
    },
    symbol: {
      fontSize: 13,
      fontWeight: "800" as const,
      letterSpacing: 0.2,
    },
    symbolSm: {
      fontSize: 11,
    },
    symbolStock: {
      color: t.colors.pillarBDeep,
    },
    symbolIndex: {
      color: t.colors.pillarADeep,
    },
    indexCaption: {
      fontSize: 8,
      fontWeight: "700" as const,
      color: t.colors.pillarA,
      letterSpacing: 0.5,
    },
  });
