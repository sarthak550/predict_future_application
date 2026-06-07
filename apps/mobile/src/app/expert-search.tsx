import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { ApiExpertSearchResult } from "@predict-future/types";
import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { mobileApi } from "@/lib/api";
import { getExpertInitials, getExpertInitialsColor } from "@/utils/expertAvatar";
import { AnalystCredibilityBadge } from "@/components/analyst-credibility-badge";

function ExpertRow({ expert }: { expert: ApiExpertSearchResult }) {
  const router = useRouter();
  const initials = getExpertInitials(expert.name, expert.organization);
  const initialsColor = getExpertInitialsColor(expert.name || expert.organization);
  const displayName = expert.name || expert.organization;

  return (
    <Pressable style={srStyles.row} onPress={() => router.push(`/expert/${expert.id}`)}>
      {expert.avatarUrl ? (
        <Image source={{ uri: expert.avatarUrl }} style={srStyles.avatar} />
      ) : (
        <View style={[srStyles.avatarFallback, { backgroundColor: initialsColor }]}>
          <Text style={srStyles.avatarInitials}>{initials}</Text>
        </View>
      )}

      <View style={srStyles.nameBlock}>
        <AnalystCredibilityBadge
          name={displayName}
          organization={expert.name && expert.organization ? expert.organization : undefined}
          hitRate={
            expert.credibilityScore !== null && !expert.provisional
              ? expert.credibilityScore
              : null
          }
          resolvedCount={expert.resolvedCount}
          size="sm"
          onPress={() => router.push(`/expert/${expert.id}`)}
        />
        <Text style={srStyles.statsText}>
          {expert.totalOpinions} call{expert.totalOpinions !== 1 ? "s" : ""}
          {expert.resolvedCount > 0 ? ` · ${expert.resolvedCount} resolved` : ""}
          {expert.followerCount > 0
            ? ` · ${expert.followerCount >= 1000 ? `${(expert.followerCount / 1000).toFixed(1)}k` : expert.followerCount} follower${expert.followerCount !== 1 ? "s" : ""}`
            : ""}
        </Text>
      </View>

      <Text style={srStyles.chevron}>›</Text>
    </Pressable>
  );
}

export default function ExpertSearchScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ApiExpertSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const data = await mobileApi.searchExperts(q.trim());
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void search(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: "Search Experts", headerShown: true }} />

      {/* Search bar */}
      <View style={srStyles.searchBar}>
        <Text style={srStyles.searchIcon}>🔍</Text>
        <TextInput
          ref={inputRef}
          style={srStyles.input}
          placeholder="Search by name or firm…"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="words"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {loading ? (
        <View style={srStyles.center}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      ) : query.trim().length < 2 ? (
        <View style={srStyles.center}>
          <Text style={srStyles.hintText}>Type at least 2 characters to search</Text>
        </View>
      ) : results.length === 0 ? (
        <View style={srStyles.center}>
          <Text style={srStyles.hintText}>No experts found for "{query}"</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => <ExpertRow expert={item} />}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      )}
    </View>
  );
}

const srStyles = StyleSheet.create({
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    margin: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.surface ?? "#f4f4f5",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchIcon: { fontSize: 16 },
  input: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  hintText: { fontSize: 14, color: colors.textMuted, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: { fontSize: 15, fontWeight: "800", color: "#fff" },
  nameBlock: { flex: 1, gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  expertName: { fontSize: 15, fontWeight: "700", color: colors.text, flexShrink: 1 },
  orgName: { fontSize: 12, color: colors.textMuted },
  statsText: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  verifiedBadge: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  verifiedText: { fontSize: 8, fontWeight: "800", color: "#fff", lineHeight: 12 },
  credBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    minWidth: 44,
    alignItems: "center",
  },
  credText: { fontSize: 13, fontWeight: "700" },
  chevron: { fontSize: 20, color: colors.textMuted, paddingHorizontal: 4 },
});
