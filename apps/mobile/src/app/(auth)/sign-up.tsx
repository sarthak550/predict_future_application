import { Link, router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "@predict-future/ui-tokens";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";

export default function SignUpScreen() {
  const { signIn } = useSession();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!username.trim() || !email.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      const res = await mobileApi.register({ username: username.trim(), email: email.trim(), password });
      signIn({ userId: res.user.id, username: res.user.username, token: res.token });
      router.replace("/(tabs)/feed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed.");
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

        {error ? <Text style={styles.error}>{error}</Text> : null}

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

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: "center", padding: spacing.xl },
  logo: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.text, alignItems: "center", justifyContent: "center", marginBottom: spacing["2xl"] },
  logoText: { color: colors.surface, fontWeight: "700", fontSize: 20 },
  title: { fontSize: 32, fontWeight: "700", color: colors.text },
  subtitle: { marginTop: spacing.sm, fontSize: 16, color: colors.textMuted, lineHeight: 24 },
  error: { marginTop: spacing.lg, color: colors.danger, fontSize: 14, backgroundColor: "rgba(190,18,60,0.08)", padding: spacing.md, borderRadius: radius.sm, overflow: "hidden" },
  form: { marginTop: spacing["2xl"] },
  submitBtn: { marginTop: spacing.xl },
  link: { marginTop: spacing.xl, textAlign: "center", color: colors.accent, fontWeight: "600", fontSize: 14 },
});
