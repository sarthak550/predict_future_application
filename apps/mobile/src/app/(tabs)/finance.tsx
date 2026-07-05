import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

import { FinanceMode } from "@/components/finance-mode";
import { GradientHeader } from "@/components/gradient-header";
import { SectionHelp } from "@/components/section-help";

export default function FinanceTabScreen() {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const params = useLocalSearchParams<{ clusterId?: string }>();
  const initialClusterId = typeof params.clusterId === "string" ? params.clusterId : null;

  return (
    <View style={styles.screen}>
      <GradientHeader
        title="Finance"
        right={
          <View style={styles.headerRight}>
            <SectionHelp helpKey="finance-intro" variant="light" />
            <Pressable
              onPress={() => router.push("/expert-search" as Parameters<typeof router.push>[0])}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.searchBox}
            >
              <Text style={styles.searchIcon}>🔍</Text>
              <Text style={styles.searchPlaceholder}>Search…</Text>
            </Pressable>
          </View>
        }
      />
      <FinanceMode
        initialClusterId={initialClusterId}
      />
    </View>
  );
}

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.colors.background },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    maxWidth: 140,
  },
  searchIcon: { fontSize: 13, color: "rgba(255,255,255,0.85)" },
  searchPlaceholder: { fontSize: 13, fontWeight: "500", color: "rgba(255,255,255,0.85)" },
});
