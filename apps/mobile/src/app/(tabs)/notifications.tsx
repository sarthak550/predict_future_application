import { Feather, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import type { ApiNotification } from "@predict-future/types";
import { formatRelativeTime } from "@predict-future/utils";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { useInterval } from "@/hooks/useInterval";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";

/** Parse an href like /markets/abc123 or /groups/abc123 into a mobile route. */
function resolveHref(href: string | null | undefined): string | null {
  if (!href) return null;

  const marketsMatch = href.match(/^\/markets\/([^/]+)$/);
  if (marketsMatch) return `/market/${marketsMatch[1]}`;

  const groupsMatch = href.match(/^\/groups\/([^/]+)$/);
  if (groupsMatch) return `/group/${groupsMatch[1]}`;

  return null;
}

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

  // Local optimistic read state: track which IDs have been marked read this session.
  const [locallyRead, setLocallyRead] = useState<Set<string>>(new Set());

  useInterval(refetch, 60_000, authStatus === "authenticated");

  const notifications = data?.notifications ?? [];

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
      mobileApi.markNotificationRead(item.id).catch(() => {});
    }

    if (route) {
      router.push(route as Parameters<typeof router.push>[0]);
    }
  }

  const hasUnread = notifications.some((n) => !n.isRead && !locallyRead.has(n.id));

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
          {hasUnread && (
            <Pressable onPress={markAllRead} style={styles.markRead}>
              <Text style={styles.markReadLabel}>Mark all as read</Text>
            </Pressable>
          )}
          <FlatList
            data={notifications}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={colors.accent} />}
            renderItem={({ item }) => {
              const route = resolveHref(item.href);
              const isRead = item.isRead || locallyRead.has(item.id);
              const isTappable = route !== null;

              return (
                <Pressable
                  style={({ pressed }) => [styles.card, !isRead && styles.cardUnread, pressed && styles.cardPressed]}
                  onPress={() => handlePress(item)}
                  accessibilityRole={isTappable ? "button" : "text"}
                  accessibilityLabel={item.title}
                  accessibilityHint={isTappable ? "Tap to view details" : undefined}
                >
                  <View style={styles.cardInner}>
                    <View style={styles.iconWrap}>
                      {!isRead && <View style={styles.unreadDot} />}
                      <TypeIcon type={item.type} />
                    </View>
                    <View style={styles.cardBody}>
                      <Text style={styles.notifTitle}>{item.title}</Text>
                      <Text style={styles.notifBody}>{item.body}</Text>
                      <Text style={styles.notifTime}>{formatRelativeTime(item.createdAt)}</Text>
                    </View>
                    {isTappable && (
                      <View style={styles.chevronWrap}>
                        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
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
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  list: { padding: spacing.xl, gap: spacing.sm },
  card: { padding: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.md },
  cardUnread: { borderLeftWidth: 3, borderLeftColor: colors.accent },
  cardPressed: { opacity: 0.75 },
  cardInner: { flexDirection: "row", alignItems: "center" },
  iconWrap: { alignItems: "center", justifyContent: "flex-start", paddingTop: 2, minWidth: 24, marginRight: spacing.md },
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
  chevronWrap: { paddingLeft: spacing.sm },
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
