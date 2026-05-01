import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, shadows, spacing } from "@predict-future/ui-tokens";

import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";

// ── Types ────────────────────────────────────────────────────────────

type MyGroup = {
  id: string;
  name: string;
  description?: string | null;
  memberCount?: number;
  marketCount?: number;
};

// ── Screen ────────────────────────────────────────────────────────────

export default function GroupsScreen() {
  const { session, status: sessionStatus } = useSession();
  const router = useRouter();

  const [myGroups, setMyGroups] = useState<MyGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Join by code state
  const [codeInput, setCodeInput] = useState("");
  const [joiningByCode, setJoiningByCode] = useState(false);

  const loadData = useCallback(
    async (isRefresh = false) => {
      if (!session) return;
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const myRes = await mobileApi.getMyGroups();
        setMyGroups(myRes.groups ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load groups.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [session]
  );

  // Reload when tab gains focus
  useFocusEffect(
    useCallback(() => {
      void loadData(false);
    }, [loadData])
  );

  async function handleJoinByCode() {
    const code = codeInput.trim().toUpperCase();
    if (!code) {
      Alert.alert("Enter a code", "Please enter an invite code.");
      return;
    }
    setJoiningByCode(true);
    try {
      const res = await mobileApi.joinGroup({ inviteCode: code });
      setCodeInput("");
      await loadData(true);
      router.push(`/group/${res.group.id}`);
    } catch (err) {
      Alert.alert(
        "Could not join",
        err instanceof Error ? err.message : "Invalid invite code."
      );
    } finally {
      setJoiningByCode(false);
    }
  }

  if (sessionStatus === "loading") {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.screen}>
        <UnauthenticatedState onSignIn={() => router.push("/(auth)/sign-in")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadData(true)}
            tintColor={colors.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.screenTitle}>Groups</Text>
          <Pressable
            style={styles.createBtn}
            onPress={() => router.push("/(tabs)/create")}
          >
            <Ionicons name="add" size={16} color={colors.surface} />
            <Text style={styles.createBtnText}>New Group</Text>
          </Pressable>
        </View>

        {/* Join by invite code */}
        <JoinByCodeSection
          value={codeInput}
          onChange={setCodeInput}
          onJoin={handleJoinByCode}
          loading={joiningByCode}
        />

        {/* Error state */}
        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => loadData(false)} style={styles.retryBtn}>
              <Text style={styles.retryLabel}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Loading state (initial load only) */}
        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
        ) : (
          <>
            {/* My Groups */}
            <MyGroupsSection
              groups={myGroups}
              onNavigate={(id) => router.push(`/group/${id}`)}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Unauthenticated State ─────────────────────────────────────────────

function UnauthenticatedState({ onSignIn }: { onSignIn: () => void }) {
  return (
    <View style={styles.centerState}>
      <Ionicons name="people-outline" size={48} color={colors.textMuted} />
      <Text style={styles.unauthTitle}>Sign in to join groups</Text>
      <Text style={styles.unauthSubtitle}>
        Groups let you predict with friends and compete on private leaderboards.
      </Text>
      <Pressable style={styles.signInBtn} onPress={onSignIn}>
        <Text style={styles.signInBtnText}>Sign In</Text>
      </Pressable>
    </View>
  );
}

// ── Join by Code ──────────────────────────────────────────────────────

function JoinByCodeSection({
  value,
  onChange,
  onJoin,
  loading,
}: {
  value: string;
  onChange: (text: string) => void;
  onJoin: () => void;
  loading: boolean;
}) {
  return (
    <View style={styles.joinCodeCard}>
      <Text style={styles.sectionLabel}>Join with invite code</Text>
      <View style={styles.joinCodeRow}>
        <TextInput
          style={styles.joinCodeInput}
          placeholder="e.g. AB12CD34"
          placeholderTextColor={colors.textMuted}
          value={value}
          onChangeText={onChange}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={onJoin}
          editable={!loading}
        />
        <Pressable
          style={[styles.joinCodeBtn, loading && styles.btnDisabled]}
          onPress={onJoin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.surface} size="small" />
          ) : (
            <Text style={styles.joinCodeBtnText}>Join</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ── My Groups Section ─────────────────────────────────────────────────

function MyGroupsSection({
  groups,
  onNavigate,
}: {
  groups: MyGroup[];
  onNavigate: (id: string) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>My Groups</Text>
        {groups.length > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{groups.length}</Text>
          </View>
        )}
      </View>

      {groups.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="people-circle-outline" size={32} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No groups yet</Text>
          <Text style={styles.emptySubtitle}>
            Create a group or join one below using an invite code.
          </Text>
        </View>
      ) : (
        <View style={styles.listCard}>
          {groups.map((group, index) => (
            <Pressable
              key={group.id}
              style={[
                styles.groupRow,
                index > 0 && styles.groupRowBorder,
              ]}
              onPress={() => onNavigate(group.id)}
            >
              <View style={styles.groupRowLeft}>
                <Text style={styles.groupName} numberOfLines={1}>
                  {group.name}
                </Text>
                <View style={styles.groupMeta}>
                  <Text style={styles.groupMetaText}>
                    {group.memberCount ?? 0} members
                  </Text>
                  <Text style={styles.groupMetaSep}>·</Text>
                  <Text style={styles.groupMetaText}>
                    {group.marketCount ?? 0} markets
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 100,
  },
  centerState: {
    flex: 1,
    paddingTop: 80,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },

  // Header
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.5,
  },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  createBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.surface,
  },

  // Join by code card
  joinCodeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    ...shadows.card,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  joinCodeRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  joinCodeInput: {
    flex: 1,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: 1,
  },
  joinCodeBtn: {
    width: 72,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  joinCodeBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.surface,
  },

  // Section
  section: {
    marginBottom: spacing.xl,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    flex: 1,
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: "#EEF2FF",
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.accent,
  },

  // List card
  listCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...shadows.card,
  },

  // Group row (My Groups)
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  groupRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  groupRowLeft: {
    flex: 1,
    gap: 3,
  },
  groupName: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  groupDescription: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
    marginTop: 2,
  },
  groupMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: 3,
  },
  groupMetaText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  groupMetaSep: {
    fontSize: 12,
    color: colors.border,
  },

  // Discover row
  discoverRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  discoverRowLeft: {
    flex: 1,
    gap: 3,
  },

  // Join button (discover)
  joinBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.accent,
    minWidth: 58,
    alignItems: "center",
    justifyContent: "center",
  },
  joinBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.accent,
  },

  // Empty state card
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
    ...shadows.card,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    marginTop: spacing.xs,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },

  // Error card
  errorCard: {
    backgroundColor: "#FEF2F2",
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  errorText: {
    fontSize: 14,
    color: "#DC2626",
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  retryLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.surface,
  },

  // Disabled state
  btnDisabled: {
    opacity: 0.5,
  },

  // Unauthenticated
  unauthTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
  },
  unauthSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: spacing.xl,
  },
  signInBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  signInBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.surface,
  },
});
