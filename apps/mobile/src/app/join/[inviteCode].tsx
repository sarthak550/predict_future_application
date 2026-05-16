import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";

type GroupPreview = {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
};

export default function JoinGroupScreen() {
  const { inviteCode } = useLocalSearchParams<{ inviteCode: string }>();
  const router = useRouter();
  const { status: sessionStatus } = useSession();

  const [preview, setPreview] = useState<GroupPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);

  useEffect(() => {
    if (!inviteCode) return;

    setLoadingPreview(true);
    setLoadError(null);

    mobileApi
      .getGroupPreview(inviteCode)
      .then((data) => {
        setPreview(data);
      })
      .catch(() => {
        setLoadError("This invite link is invalid or has expired.");
      })
      .finally(() => {
        setLoadingPreview(false);
      });
  }, [inviteCode]);

  async function handleJoin() {
    if (!inviteCode) return;

    if (sessionStatus !== "authenticated") {
      // Redirect to sign-in and come back after auth
      router.push(`/(auth)/sign-in?returnTo=/join/${inviteCode}`);
      return;
    }

    setJoining(true);
    setJoinError(null);

    try {
      const result = await mobileApi.joinGroup({ inviteCode });
      router.replace(`/group/${result.group.id}`);
    } catch (err) {
      setJoinError(
        err instanceof Error ? err.message : "Unable to join group. Please try again."
      );
      setJoining(false);
    }
  }

  if (loadingPreview) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Loading invite...</Text>
      </View>
    );
  }

  if (loadError || !preview) {
    return (
      <View style={[styles.screen, styles.center]}>
        <View style={styles.errorCard}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.danger} />
          <Text style={styles.errorTitle}>Invalid Invite Link</Text>
          <Text style={styles.errorBody}>
            {loadError ?? "This invite code could not be found."}
          </Text>
          <Pressable
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}
            onPress={() => router.replace("/(tabs)/groups")}
          >
            <Text style={styles.backBtnText}>Go to Groups</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        {/* Group icon */}
        <View style={styles.groupIcon}>
          <Ionicons name="people" size={40} color={colors.accent} />
        </View>

        {/* Invite label */}
        <Text style={styles.inviteLabel}>You're invited to join</Text>

        {/* Group name */}
        <Text style={styles.groupName}>{preview.name}</Text>

        {/* Description */}
        {preview.description ? (
          <Text style={styles.groupDescription}>{preview.description}</Text>
        ) : null}

        {/* Member count */}
        <View style={styles.memberCountRow}>
          <Ionicons name="person-outline" size={14} color={colors.textMuted} />
          <Text style={styles.memberCountText}>
            {preview.memberCount.toLocaleString()}{" "}
            {preview.memberCount === 1 ? "member" : "members"}
          </Text>
        </View>

        {/* Join error */}
        {joinError ? (
          <View style={styles.joinErrorBanner}>
            <Text style={styles.joinErrorText}>{joinError}</Text>
          </View>
        ) : null}

        {/* CTA */}
        <Pressable
          style={({ pressed }) => [
            styles.joinBtn,
            (joining || sessionStatus === "loading") && styles.joinBtnDisabled,
            pressed && { opacity: 0.85 },
          ]}
          onPress={handleJoin}
          disabled={joining || sessionStatus === "loading"}
        >
          {joining ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="enter-outline" size={18} color="#FFFFFF" />
              <Text style={styles.joinBtnText}>
                {sessionStatus === "authenticated" ? "Join Group" : "Sign in to Join"}
              </Text>
            </>
          )}
        </Pressable>

        {/* Secondary: go back */}
        <Pressable
          style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
          onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/groups")}
        >
          <Text style={styles.cancelBtnText}>Maybe later</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: 14,
    color: colors.textMuted,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    paddingBottom: 80,
  },
  groupIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
    borderWidth: 2,
    borderColor: colors.accent + "33",
  },
  inviteLabel: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: "500",
    letterSpacing: 0.3,
    marginBottom: spacing.sm,
  },
  groupName: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
    lineHeight: 34,
    marginBottom: spacing.md,
  },
  groupDescription: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: spacing.md,
    maxWidth: 300,
  },
  memberCountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: spacing.xl,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  memberCountText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: "500",
  },
  joinErrorBanner: {
    backgroundColor: "#FFF1F2",
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    width: "100%",
    maxWidth: 340,
  },
  joinErrorText: {
    fontSize: 13,
    color: "#DC2626",
    textAlign: "center",
    lineHeight: 18,
  },
  joinBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.accent,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl * 2,
    borderRadius: radius.pill,
    width: "100%",
    maxWidth: 340,
    marginBottom: spacing.md,
  },
  joinBtnDisabled: {
    opacity: 0.6,
  },
  joinBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  cancelBtn: {
    paddingVertical: spacing.md,
  },
  cancelBtnText: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: "500",
  },
  errorCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    maxWidth: 320,
    gap: spacing.md,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
  },
  errorBody: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
  backBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  backBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
});
