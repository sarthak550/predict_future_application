import { Stack } from "expo-router";
import { useCallback, useEffect } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import type { ApiNotification } from "@predict-future/types";
import { formatRelativeTime } from "@predict-future/utils";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";

export default function NotificationsScreen() {
  const { status: authStatus } = useSession();
  const fetcher = useCallback(() => mobileApi.getNotifications(), []);
  const { data, loading, error, refetch } = useApiQuery<{ notifications: ApiNotification[] }>(
    fetcher, [], { enabled: authStatus === "authenticated" }
  );

  const notifications = data?.notifications ?? [];

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    mobileApi.markNotificationsRead().catch(() => {});
  }, [authStatus]);

  async function markAllRead() {
    try {
      await mobileApi.markNotificationsRead();
      refetch();
    } catch { /* ignore */ }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Notifications" }} />
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
                <View style={[styles.card, !item.isRead && styles.cardUnread]}>
                  <Text style={styles.notifTitle}>{item.title}</Text>
                  <Text style={styles.notifBody}>{item.body}</Text>
                  <Text style={styles.notifTime}>{formatRelativeTime(item.createdAt)}</Text>
                </View>
              )}
              ListEmptyComponent={<Text style={styles.muted}>No notifications yet.</Text>}
            />
          </>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  list: { padding: spacing.xl, gap: spacing.sm },
  card: { padding: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.md },
  cardUnread: { borderLeftWidth: 3, borderLeftColor: colors.accent },
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
