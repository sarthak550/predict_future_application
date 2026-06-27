/**
 * Centralized access to EXPO_PUBLIC_* environment variables.
 * Keep a single source of truth so screens never read process.env directly.
 *
 * API base URL resolution order (dev):
 *   1. EXPO_PUBLIC_API_BASE_URL if explicitly set (production builds rely on this)
 *   2. Auto-derived from Expo's Metro host (follows your Mac's current LAN IP)
 *   3. http://localhost:3001 (last-resort fallback)
 *
 * Why auto-derive: Metro reports the dev machine's current IP via Constants.expoConfig.hostUri.
 * Since the API server runs on the same machine, we point at <metro-host>:3001.
 * Result: switching Wi-Fi / changing IPs no longer requires editing .env.
 */

import Constants from "expo-constants";

const DEFAULT_API_PORT = 3001;
const LOCALHOST_FALLBACK = `http://localhost:${DEFAULT_API_PORT}`;

function readString(value: string | undefined, fallback?: string): string | undefined {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function deriveDevApiBaseUrl(): string | null {
  // Try the modern field first, then fall back across SDK / Expo Go variants.
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost ??
    (Constants as { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost ??
    (Constants as { manifest2?: { extra?: { expoClient?: { hostUri?: string } } } }).manifest2?.extra
      ?.expoClient?.hostUri;

  if (typeof hostUri !== "string" || hostUri.length === 0) {
    return null;
  }

  // hostUri looks like "192.168.1.42:8081" — strip the Metro port, use the host.
  const host = hostUri.split(":")[0];
  if (!host) {
    return null;
  }

  return `http://${host}:${DEFAULT_API_PORT}`;
}

function getApiBaseUrl(): string {
  const explicit = readString(process.env.EXPO_PUBLIC_API_BASE_URL);
  if (explicit) {
    return explicit;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("EXPO_PUBLIC_API_BASE_URL is required in production builds");
  }

  const derived = deriveDevApiBaseUrl();
  if (derived) {
    console.log(`[env] API host auto-detected from Expo manifest → ${derived}`);
    return derived;
  }

  console.warn("[env] Could not derive API host from Expo manifest — using localhost (dev only)");
  return LOCALHOST_FALLBACK;
}

export const env = {
  apiBaseUrl: getApiBaseUrl(),
  demoUserId: readString(process.env.EXPO_PUBLIC_DEMO_USER_ID),
  posthogApiKey: readString(process.env.EXPO_PUBLIC_POSTHOG_API_KEY),
  posthogHost: readString(process.env.EXPO_PUBLIC_POSTHOG_HOST, "https://us.i.posthog.com") as string
};
