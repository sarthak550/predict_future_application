/**
 * Settings screen (S65-T1)
 *
 * Auto-registered at /settings by expo-router (apps/mobile/src/app/settings.tsx).
 * The root _layout.tsx uses headerShown: false globally, so this screen renders
 * its own back button via router.back().
 *
 * Sections (top → bottom):
 *  - Appearance: ThemeToggleRow
 *  - Replay Tutorial
 *  - Privacy:   AnonymousToggleCard
 *  - Notifications: GroupNotifDefaultCard
 *  - Log Out
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { radius, spacing } from "@predict-future/ui-tokens";
import type { AppUserDisplayMode, GroupNotifLevel } from "@predict-future/types";

import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";
import { useSession } from "@/providers/session-provider";
import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";
import { ThemeToggleRow } from "@/components/theme-toggle";
import { AnonymousToggleCard } from "@/components/anonymous-toggle-card";
import { GroupNotifDefaultCard } from "@/components/group-notif-default-card";
import { resetOnboarding } from "@/components/onboarding-walkthrough";
import type { ApiMyProfile } from "@predict-future/types";

export default function SettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { session, status: sessionStatus, signOut } = useSession();
  const userId = session?.userId;

  // ── Anonymous mode toggle state ──
  const [displayMode, setDisplayModeState] = useState<AppUserDisplayMode>("USERNAME");
  const displayModeSynced = useRef(false);

  // ── Group notification default state ──
  const GROUPS_NOTIF_KEY = "@groups_notif_default";
  const [groupNotifDefault, setGroupNotifDefaultState] = useState<GroupNotifLevel>("ALL");
  const notifMigrated = useRef(false);

  const enabled = sessionStatus === "authenticated" && Boolean(userId);

  const fetcher = useCallback(() => mobileApi.getMyProfile(), []);
  const { data } = useApiQuery<ApiMyProfile>(fetcher, [userId], { enabled });

  // ── Sync displayMode from server on first data load ──
  useEffect(() => {
    if (displayModeSynced.current) return;
    const serverMode = data?.user?.displayMode as AppUserDisplayMode | undefined;
    if (serverMode) {
      setDisplayModeState(serverMode);
      displayModeSynced.current = true;
    }
  }, [data]);

  // ── S59-T2: Server-authoritative group notification default ──
  // Migration path: if server is ALL (schema default) AND AsyncStorage has a
  // non-ALL value, PATCH the server with the stored value and delete the key.
  useEffect(() => {
    if (notifMigrated.current) return;
    const serverLevel = (data?.user as { defaultGroupNotificationLevel?: GroupNotifLevel } | undefined)
      ?.defaultGroupNotificationLevel;
    if (!serverLevel) return;

    notifMigrated.current = true;
    setGroupNotifDefaultState(serverLevel);

    if (serverLevel === "ALL") {
      AsyncStorage.getItem(GROUPS_NOTIF_KEY).then(async (stored) => {
        if (stored === "MENTIONS_ONLY" || stored === "NONE") {
          try {
            await mobileApi.updateUserNotificationDefaults({
              defaultGroupNotificationLevel: stored as GroupNotifLevel,
            });
            setGroupNotifDefaultState(stored as GroupNotifLevel);
          } catch {
            // Migration failure is non-fatal — server value stays ALL.
          } finally {
            await AsyncStorage.removeItem(GROUPS_NOTIF_KEY).catch(() => { /* ignore */ });
          }
        } else if (stored !== null) {
          await AsyncStorage.removeItem(GROUPS_NOTIF_KEY).catch(() => { /* ignore */ });
        }
      }).catch(() => { /* ignore AsyncStorage errors */ });
    }
  }, [data]);

  function handleLogOut() {
    Alert.alert("Sign out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: () => {
          signOut();
          router.replace("/(auth)/sign-in");
        },
      },
    ]);
  }

  return (
    <View style={styles.screen}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        {/* Spacer keeps title centered */}
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.scrollBody}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Appearance ── */}
        <Text style={styles.sectionLabel}>Appearance</Text>
        <View style={styles.card}>
          <ThemeToggleRow />
        </View>

        {/* ── Replay Tutorial ── */}
        <View style={[styles.card, styles.cardMt]}>
          <Pressable
            style={({ pressed }) => [styles.actionRow, pressed && { opacity: 0.7 }]}
            onPress={async () => {
              await resetOnboarding();
              Alert.alert(
                "Tutorial reset",
                "Re-open the app or switch tabs to see the walkthrough again.",
                [{ text: "OK" }]
              );
            }}
          >
            <Ionicons name="help-circle-outline" size={20} color={colors.text} />
            <View style={styles.actionTextWrap}>
              <Text style={styles.actionLabel}>Replay Tutorial</Text>
              <Text style={styles.actionSublabel}>Re-run the first-run walkthrough</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* ── Privacy ── */}
        <Text style={[styles.sectionLabel, styles.sectionLabelMt]}>Privacy</Text>
        <AnonymousToggleCard
          displayMode={displayMode}
          userId={userId ?? ""}
          onToggle={async (enabled) => {
            const newMode: AppUserDisplayMode = enabled ? "ANONYMOUS" : "USERNAME";
            setDisplayModeState(newMode);
            try {
              await mobileApi.setDisplayMode(newMode);
            } catch {
              setDisplayModeState(enabled ? "USERNAME" : "ANONYMOUS");
              Alert.alert(
                "Could not update",
                "Failed to change display mode. Please try again.",
                [{ text: "OK" }]
              );
            }
          }}
        />

        {/* ── Notifications ── */}
        <Text style={[styles.sectionLabel, styles.sectionLabelMt]}>Notifications</Text>
        <GroupNotifDefaultCard
          current={groupNotifDefault}
          onChange={async (level) => {
            const previous = groupNotifDefault;
            setGroupNotifDefaultState(level);
            try {
              await mobileApi.updateUserNotificationDefaults({
                defaultGroupNotificationLevel: level,
              });
            } catch {
              setGroupNotifDefaultState(previous);
              Alert.alert("Could not save", "Failed to save group notification preference.");
            }
          }}
        />

        {/* ── Log Out ── */}
        <Pressable
          style={({ pressed }) => [styles.logoutBtn, pressed && styles.logoutPressed]}
          onPress={handleLogOut}
        >
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={styles.logoutText}>Log Out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: t.colors.background,
  },

  // ── Header ──
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.border,
    backgroundColor: t.colors.background,
  },
  backBtn: {
    width: 40,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: t.colors.text,
  },

  // ── Body ──
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: 60,
  },

  // ── Section labels ──
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: t.colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  sectionLabelMt: {
    marginTop: spacing.xl,
  },

  // ── Generic card ──
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.colors.border,
  },
  cardMt: {
    marginTop: spacing.md,
  },

  // ── Action row (Replay Tutorial) ──
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.lg,
    gap: spacing.md,
  },
  actionTextWrap: {
    flex: 1,
  },
  actionLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: t.colors.text,
  },
  actionSublabel: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 2,
  },

  // ── Log Out ──
  logoutBtn: {
    marginTop: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  logoutPressed: {
    opacity: 0.7,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: "600",
    color: t.colors.danger,
  },
});
