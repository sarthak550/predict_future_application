import { Link, router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { radius, spacing } from "@predict-future/ui-tokens";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

export default function SignInScreen() {
  const { signIn } = useSession();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      const res = await mobileApi.signIn({ email: email.trim(), password });
      signIn({ userId: res.user.id, username: res.user.username, token: res.token });
      router.replace("/(tabs)/feed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed.");
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
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Sign in to continue predicting.</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.form}>
          <Input label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
          <View style={{ height: spacing.lg }} />
          <Input label="Password" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />
        </View>

        <Button label="Sign in" onPress={handleSubmit} loading={loading} style={styles.submitBtn} />

        <Link href="/(auth)/sign-up" style={styles.link}>
          Don't have an account? Sign up
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
  form: { marginTop: spacing["2xl"] },
  submitBtn: { marginTop: spacing.xl },
  link: { marginTop: spacing.xl, textAlign: "center", color: t.colors.accent, fontWeight: "600", fontSize: 14 },
});
