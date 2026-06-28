import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Stack } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import type { ApiNotification } from "@predict-future/types";
import { formatRelativeTime } from "@predict-future/utils";
import { radius, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

/** Parse an href like /markets/abc123 or /groups/abc123 into a mobile route. */
function resolveHref(href: string | null | undefined): string | null {
  if (!href) return null;

  const marketsMatch = href.match(/^\/markets\/([^/]+)$/);
  if (marketsMatch) return `/market/${marketsMatch[1]}`;

  const groupsMatch = href.match(/^\/groups\/([^/]+)$/);
  if (groupsMatch) return `/group/${groupsMatch[1]}`;

  return null;
}

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  list: { padding: spacing.xl, gap: spacing.sm },
  card: {
    padding: spacing.lg,
    backgroundColor: t.colors.surface,
    borderRadius: radius.md,
  },
  cardUnread: { borderLeftWidth: 3, borderLeftColor: t.colors.accent },
  cardPressed: { opacity: 0.75 },
  cardInner: { flexDirection: "row", alignItems: "center" },
  cardBody: { flex: 1 },
  chevronWrap: { paddingLeft: spacing.sm },
  notifTitle: { fontSize: 15, fontWeight: "700", color: t.colors.text },
  notifBody: { marginTop: spacing.xs, fontSize: 14, color: t.colors.textMuted, lineHeight: 20 },
  notifTime: { marginTop: spacing.sm, fontSize: 12, color: t.colors.textMuted },
  muted: { textAlign: "center", color: t.colors.textMuted, paddingVertical: spacing.xl },
  errorText: { color: t.colors.danger },
  retry: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: t.colors.accent,
  },
  retryLabel: { color: t.colors.surface, fontWeight: "700" },
  markRead: {
    alignSelf: "flex-end",
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: t.colors.surfaceMuted,
  },
  markReadLabel: { fontSize: 13, fontWeight: "600", color: t.colors.accent },
});

export default function NotificationsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { status: authStatus } = useSession();
  const fetcher = useCallback(() => mobileApi.getNotifications(), []);
  const { data, loading, error, refetch } = useApiQuery<{ notifications: ApiNotification[]; unreadCount: number }>(
    fetcher, [], { enabled: authStatus === "authenticated" }
  );

  // Local optimistic read state: track which IDs have been marked read this session.
  const [locallyRead, setLocallyRead] = useState<Set<string>>(new Set());

  const notifications = data?.notifications ?? [];

  // Mark all read on mount (existing behaviour).
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

  function handlePress(item: ApiNotification) {
    const route = resolveHref(item.href);

    // Optimistically mark as read in local state.
    if (!item.isRead && !locallyRead.has(item.id)) {
      setLocallyRead((prev) => new Set(prev).add(item.id));
      // Fire-and-forget; failure is non-critical.
      mobileApi.markNotificationRead(item.id).catch(() => {});
    }

    if (route) {
      router.push(route as Parameters<typeof router.push>[0]);
    }
  }

  const hasUnread = notifications.some((n) => !n.isRead && !locallyRead.has(n.id));

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Notifications" }} />
      <View style={styles.screen}>
        {authStatus !== "authenticated" ? (
          <View style={styles.center}>
            <Text style={styles.muted}>Sign in to see notifications.</Text>
          </View>
        ) : loading && notifications.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={refetch} style={styles.retry}>
              <Text style={styles.retryLabel}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {hasUnread && (
              <Pressable onPress={markAllRead} style={styles.markRead}>
                <Text style={styles.markReadLabel}>Mark all as read</Text>
              </Pressable>
            )}
            <FlatList
              data={notifications}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
              refreshControl={
                <RefreshControl refreshing={loading} onRefresh={refetch} tintColor={colors.accent} />
              }
              renderItem={({ item }) => {
                const route = resolveHref(item.href);
                const isRead = item.isRead || locallyRead.has(item.id);
                const isTappable = route !== null;

                return (
                  <Pressable
                    style={({ pressed }) => [
                      styles.card,
                      !isRead && styles.cardUnread,
                      pressed && styles.cardPressed,
                    ]}
                    onPress={() => handlePress(item)}
                    accessibilityRole={isTappable ? "button" : "text"}
                    accessibilityLabel={item.title}
                    accessibilityHint={isTappable ? "Tap to view details" : undefined}
                  >
                    <View style={styles.cardInner}>
                      <View style={styles.cardBody}>
                        <Text style={styles.notifTitle}>{item.title}</Text>
                        <Text style={styles.notifBody}>{item.body}</Text>
                        <Text style={styles.notifTime}>{formatRelativeTime(item.createdAt)}</Text>
                      </View>
                      {isTappable && (
                        <View style={styles.chevronWrap}>
                          <Ionicons
                            name="chevron-forward"
                            size={18}
                            color={colors.textMuted}
                          />
                        </View>
                      )}
                    </View>
                  </Pressable>
                );
              }}
              ListEmptyComponent={<Text style={styles.muted}>No notifications yet.</Text>}
            />
          </>
        )}
      </View>
    </>
  );
}
