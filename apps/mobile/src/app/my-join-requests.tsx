/**
 * S56: My Join Requests screen.
 *
 * Shows the calling user's own join requests across all groups:
 *   - All PENDING requests
 *   - APPROVED / REJECTED requests decided within the last 30 days
 *
 * Accessed from the "Pending requests (N)" row in the Groups tab "My Groups" section.
 * Screen path: /my-join-requests
 */

import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { radius, spacing } from "@predict-future/ui-tokens";
import { formatRelativeTime } from "@predict-future/utils";
import type { ApiGroupJoinRequest } from "@predict-future/types";

import { mobileApi } from "@/lib/api";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

// ── Status badge ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "PENDING" | "APPROVED" | "REJECTED" }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  // Semantic status colours mapped to theme-aware soft/strong tokens
  const cfg = {
    PENDING: { bg: colors.accentSoft, text: colors.accentDeep, label: "Pending" },
    APPROVED: { bg: colors.successSoft, text: colors.success, label: "Approved" },
    REJECTED: { bg: colors.dangerSoft, text: colors.danger, label: "Declined" }
  }[status];

  return (
    <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.statusBadgeText, { color: cfg.text }]}>{cfg.label}</Text>
    </View>
  );
}

// ── Style factory ─────────────────────────────────────────────────────

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: t.colors.background
  },
  listContent: {
    padding: spacing.md,
    paddingBottom: 40
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
    minHeight: 200
  },
  errorText: {
    fontSize: 14,
    color: t.colors.danger,
    textAlign: "center"
  },
  emptyText: {
    fontSize: 14,
    color: t.colors.textMuted,
    fontStyle: "italic"
  },

  // Request row
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: t.colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.xs,
    gap: spacing.md,
    ...t.shadows.card
  },
  groupAvatar: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: t.colors.accent + "20",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0
  },
  groupAvatarLetter: {
    fontSize: 16,
    fontWeight: "700",
    color: t.colors.accent
  },
  requestInfo: {
    flex: 1,
    gap: 2
  },
  groupName: {
    fontSize: 14,
    fontWeight: "700",
    color: t.colors.text
  },
  requestedAt: {
    fontSize: 11,
    color: t.colors.textMuted
  },
  decisionNote: {
    fontSize: 11,
    color: t.colors.textMuted,
    fontStyle: "italic",
    marginTop: 2
  },

  // Status badge
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 100,
    flexShrink: 0
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "700"
  }
});

// ── Screen ────────────────────────────────────────────────────────────

export default function MyJoinRequestsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [requests, setRequests] = useState<ApiGroupJoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await mobileApi.getMyGroupJoinRequests();
        if (!cancelled) setRequests(res.requests);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load requests.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const renderItem = ({ item }: { item: ApiGroupJoinRequest }) => (
    <Pressable
      style={styles.requestRow}
      onPress={() => router.push(`/group/${item.groupId}`)}
    >
      {/* Group avatar placeholder */}
      <View style={styles.groupAvatar}>
        <Text style={styles.groupAvatarLetter}>
          {item.groupName.charAt(0).toUpperCase()}
        </Text>
      </View>

      {/* Info */}
      <View style={styles.requestInfo}>
        <Text style={styles.groupName} numberOfLines={1}>{item.groupName}</Text>
        <Text style={styles.requestedAt}>
          Requested {formatRelativeTime(item.requestedAt)}
        </Text>
        {item.status === "REJECTED" && item.decisionNote ? (
          <Text style={styles.decisionNote} numberOfLines={2}>
            {item.decisionNote}
          </Text>
        ) : null}
      </View>

      {/* Status badge */}
      <StatusBadge status={item.status} />
    </Pressable>
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "My Join Requests"
        }}
      />
      <View style={styles.screen}>
        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
        ) : error ? (
          <View style={styles.centerState}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          <FlatList
            data={requests}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.centerState}>
                <Ionicons name="checkmark-circle-outline" size={40} color={colors.textMuted} />
                <Text style={styles.emptyText}>No join requests yet.</Text>
              </View>
            }
          />
        )}
      </View>
    </>
  );
}
