import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "@predict-future/ui-tokens";

type Props = {
  children: React.ReactNode;
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
};

type State = {
  error: Error | null;
};

/**
 * Top-level error boundary. React Native will otherwise surface a red-box in dev
 * and a blank screen in prod when a render throws. This gives users a
 * recoverable "try again" state without restarting the app.
 *
 * NOTE: This is a React class component and cannot use hooks. Styles are kept
 * static (light-mode tokens) — this is an acceptable trade-off for an error
 * fallback screen that renders only on catastrophic failures.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Intentionally console.error — production monitoring (Sentry, etc.) can
    // hook into this via a global handler without coupling to this file.
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message}>{error.message}</Text>
        <Pressable onPress={this.reset} style={styles.button}>
          <Text style={styles.buttonLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

// Styles are intentionally static (class component cannot use hooks).
const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: colors.background
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.text
  },
  message: {
    marginTop: spacing.md,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    color: colors.textMuted
  },
  button: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accent
  },
  buttonLabel: {
    color: colors.surface,
    fontWeight: "700",
    fontSize: 15
  }
});
