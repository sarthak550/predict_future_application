/**
 * ThemeProvider — runtime light/dark theming for the app.
 *
 * Why this exists: every screen reads palette via a STATIC `import { colors }`,
 * which can't change at runtime. This provider exposes the active palette through
 * `useTheme()` so migrated components re-skin instantly when the user flips the
 * Profile toggle (or when the OS theme changes, if mode === "system").
 *
 * Migration pattern for a component:
 *   // before
 *   import { colors } from "@predict-future/ui-tokens";
 *   const styles = StyleSheet.create({ x: { color: colors.text } });
 *   // after
 *   import { useThemedStyles } from "@/providers/theme-provider";
 *   const makeStyles = (t) => StyleSheet.create({ x: { color: t.colors.text } });
 *   function Comp() { const styles = useThemedStyles(makeStyles); ... }
 *
 * Until a component is migrated it keeps using the static (light) tokens — so the
 * app stays functional throughout an incremental rollout.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";

import {
  colors as lightColors,
  darkColors,
  darkShadows,
  shadows as lightShadows,
  type ThemeColors,
  type ThemeShadows,
} from "@predict-future/ui-tokens";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedScheme = "light" | "dark";

export type ThemeContextValue = {
  /** User preference: explicit light/dark, or follow the OS ("system"). */
  mode: ThemeMode;
  /** The resolved scheme after applying "system". */
  scheme: ResolvedScheme;
  isDark: boolean;
  colors: ThemeColors;
  shadows: ThemeShadows;
  /** Persist a new preference (writes to AsyncStorage). */
  setMode: (mode: ThemeMode) => void;
};

const STORAGE_KEY = "theme_mode";

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme(); // "light" | "dark" | null
  const [mode, setModeState] = useState<ThemeMode>("system");

  // Hydrate the persisted preference once on mount.
  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && (stored === "light" || stored === "dark" || stored === "system")) {
          setModeState(stored);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const scheme: ResolvedScheme =
    mode === "system" ? (systemScheme === "dark" ? "dark" : "light") : mode;
  const isDark = scheme === "dark";

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      scheme,
      isDark,
      colors: isDark ? darkColors : lightColors,
      shadows: isDark ? darkShadows : lightShadows,
      setMode,
    }),
    [mode, scheme, isDark, setMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Active theme. Throws if used outside <ThemeProvider>. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}

/**
 * Memoized themed StyleSheet. Pass a factory that builds styles from the active
 * theme; it re-runs only when the theme changes.
 */
export function useThemedStyles<T>(factory: (theme: ThemeContextValue) => T): T {
  const theme = useTheme();
  return useMemo(() => factory(theme), [theme, factory]);
}
