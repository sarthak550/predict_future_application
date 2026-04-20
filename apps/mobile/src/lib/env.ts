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

export const env = {
  apiBaseUrl: readString(process.env.EXPO_PUBLIC_API_BASE_URL, DEFAULT_API_BASE_URL) as string,
  demoUserId: readString(process.env.EXPO_PUBLIC_DEMO_USER_ID)
};
