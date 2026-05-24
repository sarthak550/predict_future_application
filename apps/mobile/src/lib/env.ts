/**
 * Centralized access to EXPO_PUBLIC_* environment variables.
 * Keep a single source of truth so screens never read process.env directly.
 */

const DEFAULT_API_BASE_URL = "http://localhost:3001";

function readString(value: string | undefined, fallback?: string): string | undefined {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function getApiBaseUrl(): string {
  const v = readString(process.env.EXPO_PUBLIC_API_BASE_URL);
  if (!v) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("EXPO_PUBLIC_API_BASE_URL is required in production builds");
    }
    console.warn("[env] EXPO_PUBLIC_API_BASE_URL unset — falling back to localhost (dev only)");
    return DEFAULT_API_BASE_URL;
  }
  return v;
}

export const env = {
  apiBaseUrl: getApiBaseUrl(),
  demoUserId: readString(process.env.EXPO_PUBLIC_DEMO_USER_ID),
  posthogApiKey: readString(process.env.EXPO_PUBLIC_POSTHOG_API_KEY),
  posthogHost: readString(process.env.EXPO_PUBLIC_POSTHOG_HOST, "https://us.i.posthog.com") as string
};
