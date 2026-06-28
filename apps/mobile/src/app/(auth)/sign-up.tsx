import { Link, router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { radius, spacing } from "@predict-future/ui-tokens";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiClientError } from "@predict-future/api-client";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

export default function SignUpScreen() {
  const { signIn } = useSession();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [alreadyExists, setAlreadyExists] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!username.trim() || !email.trim() || !password) return;
    setLoading(true);
    setError(null);
    setAlreadyExists(false);
    try {
      const res = await mobileApi.register({ username: username.trim(), email: email.trim(), password });
      signIn({ userId: res.user.id, username: res.user.username, token: res.token, isNew: true });
      router.replace("/(tabs)/feed");
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 409) {
        setAlreadyExists(true);
      } else {
        setError(e instanceof Error ? e.message : "Registration failed.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.logo}>
          <Text style={styles.logoText}>PF</Text>
        </View>
        <Text style={styles.title}>Create account</Text>
        <Text style={styles.subtitle}>Free virtual points. No deposits, no risk.</Text>

        {alreadyExists ? (
          <View style={styles.existsBox}>
            <Text style={styles.existsText}>That email or username is already registered.</Text>
            <Pressable onPress={() => router.replace("/(auth)/sign-in")}>
              <Text style={styles.existsLink}>Sign in instead →</Text>
            </Pressable>
          </View>
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : null}

        <View style={styles.form}>
          <Input label="Username" value={username} onChangeText={setUsername} placeholder="your_handle" autoCapitalize="none" autoCorrect={false} />
          <View style={{ height: spacing.lg }} />
          <Input label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
          <View style={{ height: spacing.lg }} />
          <Input label="Password" value={password} onChangeText={setPassword} placeholder="Min 8 characters" secureTextEntry />
        </View>

        <Button label="Create account" onPress={handleSubmit} loading={loading} style={styles.submitBtn} />

        <Link href="/(auth)/sign-in" style={styles.link}>
          Already have an account? Sign in
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  flex: { flex: 1, backgroundColor: t.colors.background },
  container: { flexGrow: 1, justifyContent: "center", padding: spacing.xl },
  logo: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: t.colors.text, alignItems: "center", justifyContent: "center", marginBottom: spacing["2xl"] },
  logoText: { color: t.colors.surface, fontWeight: "700", fontSize: 20 },
  title: { fontSize: 32, fontWeight: "700", color: t.colors.text },
  subtitle: { marginTop: spacing.sm, fontSize: 16, color: t.colors.textMuted, lineHeight: 24 },
  error: { marginTop: spacing.lg, color: t.colors.danger, fontSize: 14, backgroundColor: "rgba(190,18,60,0.08)", padding: spacing.md, borderRadius: radius.sm, overflow: "hidden" },
  // FFFBEB / FDE68A / 92400E are intentional amber warning chip colors — kept static
  existsBox: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.sm, backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A", gap: spacing.sm },
  existsText: { color: "#92400E", fontSize: 14 },
  existsLink: { color: t.colors.accent, fontSize: 14, fontWeight: "700" },
  form: { marginTop: spacing["2xl"] },
  submitBtn: { marginTop: spacing.xl },
  link: { marginTop: spacing.xl, textAlign: "center", color: t.colors.accent, fontWeight: "600", fontSize: 14 },
});
