import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import type { ApiNotification } from "@predict-future/types";
import { formatRelativeTime } from "@predict-future/utils";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { useInterval } from "@/hooks/useInterval";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";

function TypeIcon({ type }: { type: string }) {
  if (type === "RESOLUTION") {
    return <Feather name="check-circle" size={20} color="#16A34A" />;
  }
  if (type === "CHALLENGE") {
    return <Feather name="alert-circle" size={20} color="#D97706" />;
  }
  return <Feather name="bell" size={20} color={colors.textMuted} />;
}

export default function NotificationsTabScreen() {
  const router = useRouter();
  const { status: authStatus } = useSession();
  const fetcher = useCallback(() => mobileApi.getNotifications(), []);
  const { data, loading, error, refetch } = useApiQuery<{ notifications: ApiNotification[]; unreadCount: number }>(
    fetcher, [], { enabled: authStatus === "authenticated" }
  );

  useInterval(refetch, 60_000, authStatus === "authenticated");

  const notifications = data?.notifications ?? [];

  async function markAllRead() {
    try {
      await mobileApi.markNotificationsRead();
      refetch();
    } catch { /* ignore */ }
  }

  return (
    <View style={styles.screen}>
      {authStatus !== "authenticated" ? (
        <View style={styles.center}><Text style={styles.muted}>Sign in to see notifications.</Text></View>
      ) : loading && notifications.length === 0 ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={refetch} style={styles.retry}><Text style={styles.retryLabel}>Retry</Text></Pressable>
        </View>
      ) : (
        <>
          {notifications.some(n => !n.isRead) && (
            <Pressable onPress={markAllRead} style={styles.markRead}>
              <Text style={styles.markReadLabel}>Mark all as read</Text>
            </Pressable>
          )}
          <FlatList
            data={notifications}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={colors.accent} />}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.card, !item.isRead && styles.cardUnread, pressed && styles.cardPressed]}
                onPress={() => {
                  if (item.marketId) {
                    router.push(`/market/${item.marketId}`);
                  }
                }}
              >
                <View style={styles.cardInner}>
                  <View style={styles.iconWrap}>
                    {!item.isRead && <View style={styles.unreadDot} />}
                    <TypeIcon type={item.type} />
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.notifTitle}>{item.title}</Text>
                    <Text style={styles.notifBody}>{item.body}</Text>
                    <Text style={styles.notifTime}>{formatRelativeTime(item.createdAt)}</Text>
                  </View>
                </View>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={styles.muted}>No notifications yet.</Text>}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  list: { padding: spacing.xl, gap: spacing.sm },
  card: { padding: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.md },
  cardUnread: { borderLeftWidth: 3, borderLeftColor: colors.accent },
  cardPressed: { opacity: 0.75 },
  cardInner: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  iconWrap: { alignItems: "center", justifyContent: "flex-start", paddingTop: 2, minWidth: 24 },
  unreadDot: {
    position: "absolute",
    top: -4,
    left: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  cardBody: { flex: 1 },
  notifTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  notifBody: { marginTop: spacing.xs, fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  notifTime: { marginTop: spacing.sm, fontSize: 12, color: colors.textMuted },
  muted: { textAlign: "center", color: colors.textMuted, paddingVertical: spacing.xl },
  errorText: { color: colors.danger },
  retry: { marginTop: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.accent },
  retryLabel: { color: colors.surface, fontWeight: "700" },
  markRead: { alignSelf: "flex-end", marginHorizontal: spacing.xl, marginTop: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  markReadLabel: { fontSize: 13, fontWeight: "600", color: colors.accent },
});
