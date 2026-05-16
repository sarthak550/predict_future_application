/**
 * LeagueBanner
 *
 * One-time promotion/relegation banner shown on app open when the user's
 * current league tier differs from the last tier they saw. Reads from
 * `getMyCurrentLeague()` and compares against AsyncStorage key
 * `lastSeenLeagueTier_<userId>`. After dismiss, writes the new tier.
 *
 * Usage: render once inside the root layout (or AppProviders). The component
 * is invisible until a tier change is detected.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { AppLeagueTier } from "@predict-future/types";
import { radius, spacing } from "@predict-future/ui-tokens";

import { TIER_COLORS } from "@/app/leagues";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";

// ── AsyncStorage key ──────────────────────────────────────────────────────────

function bannerSeenKey(userId: string, month: string): string {
  return `league_banner_${userId}_${month}`;
}

// ── Banner type ───────────────────────────────────────────────────────────────

type BannerKind = "promotion" | "relegation";

interface BannerState {
  kind: BannerKind;
  tier: AppLeagueTier;
  month: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LeagueBanner() {
  const { session, status: sessionStatus } = useSession();
  const userId = session?.userId ?? null;

  const [banner, setBanner] = useState<BannerState | null>(null);
  const translateY = useState(() => new Animated.Value(-120))[0];
  const opacity = useState(() => new Animated.Value(0))[0];

  useEffect(() => {
    if (sessionStatus !== "authenticated" || !userId) return;

    void (async () => {
      try {
        const entry = await mobileApi.getMyCurrentLeague();
        const currentTier = entry.tier;
        const currentMonth = entry.month;

        const key = bannerSeenKey(userId, currentMonth);
        const alreadySeen = await AsyncStorage.getItem(key);

        if (alreadySeen) {
          // Banner already dismissed for this tier+month combination.
          return;
        }

        // Tiers are ordered; determine promotion vs relegation by comparing
        // against startingTier if available, otherwise show banner if promoted/relegated.
        // We detect tier change by checking if the user was promoted or relegated
        // this month (entry.promoted / entry.relegated). If neither, no banner.
        // Since ApiLeagueEntry doesn't expose promoted/relegated flags directly,
        // we use a simpler heuristic: store the tier seen per-month and compare.
        // First visit this month — record current tier silently; no banner.
        await AsyncStorage.setItem(key, currentTier);

        // We cannot detect a mid-month tier change here without a prior stored value.
        // The banner fires next month if tier changed: we compare last month's stored
        // tier to current. To do that we check the previous month's key.
        const [year, mon] = currentMonth.split("-").map(Number);
        const prevMonthDate = new Date(year!, mon! - 1, 1);
        const prevMonth = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
        const prevKey = bannerSeenKey(userId, prevMonth);
        const prevTierRaw = await AsyncStorage.getItem(prevKey);

        if (!prevTierRaw) {
          // No prior month data — can't determine direction; no banner.
          return;
        }

        const prevTier = prevTierRaw as AppLeagueTier;
        if (prevTier === currentTier) {
          // No tier change across months — nothing to show.
          return;
        }

        const tierOrder: AppLeagueTier[] = ["BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND"];
        const prevIdx = tierOrder.indexOf(prevTier);
        const currIdx = tierOrder.indexOf(currentTier);

        const kind: BannerKind = currIdx > prevIdx ? "promotion" : "relegation";
        setBanner({ kind, tier: currentTier, month: currentMonth });
      } catch {
        // Best-effort — banner failure must never surface to the user.
      }
    })();
  }, [userId, sessionStatus]);

  // Animate in when banner becomes visible.
  useEffect(() => {
    if (!banner) return;
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 14,
        stiffness: 120,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [banner, translateY, opacity]);

  async function handleDismiss() {
    if (!userId || !banner) return;

    // Animate out.
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -120,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => setBanner(null));

    // Persist dismissal so this month's banner doesn't fire again.
    try {
      await AsyncStorage.setItem(bannerSeenKey(userId, banner.month), banner.tier);
    } catch {
      // Ignore storage errors.
    }
  }

  if (!banner) return null;

  const tierColor = TIER_COLORS[banner.tier];
  const isPromotion = banner.kind === "promotion";

  // Choose legible text color based on tier brightness.
  const textLight = banner.tier === "BRONZE" || banner.tier === "GOLD";
  const textColor = textLight ? "#FFFFFF" : "#1A1A2E";

  const headline = isPromotion
    ? `You've been promoted to ${banner.tier}!`
    : `Relegated to ${banner.tier}`;
  const subtext = isPromotion
    ? "Keep it up — earn more points to stay in the top tier."
    : "Earn more points next month to climb back up.";

  return (
    <Animated.View
      style={[
        bannerStyles.container,
        { backgroundColor: tierColor, transform: [{ translateY }], opacity },
      ]}
      pointerEvents="box-none"
    >
      <View style={bannerStyles.content}>
        <View style={bannerStyles.textBlock}>
          <Text style={[bannerStyles.headline, { color: textColor }]}>{headline}</Text>
          <Text style={[bannerStyles.subtext, { color: textColor, opacity: 0.8 }]}>
            {subtext}
          </Text>
        </View>
        <Pressable
          onPress={handleDismiss}
          hitSlop={12}
          style={({ pressed }) => [bannerStyles.dismissBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={[bannerStyles.dismissText, { color: textColor }]}>Dismiss</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const bannerStyles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 8,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  textBlock: {
    flex: 1,
  },
  headline: {
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 20,
  },
  subtext: {
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 16,
    marginTop: 3,
  },
  dismissBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  dismissText: {
    fontSize: 13,
    fontWeight: "700",
  },
});
