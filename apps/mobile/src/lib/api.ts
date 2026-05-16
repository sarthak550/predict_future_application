import { createApiClient, type AuthFailureReason } from "@predict-future/api-client";
import * as SecureStore from "expo-secure-store";

import { env } from "@/lib/env";

/**
 * In-memory token cache. Set synchronously by the session provider so the API
 * client never races against an async SecureStore write.
 */
let _tokenCache: string | null = null;

export function setApiTokenCache(token: string | null): void {
  _tokenCache = token;
}

let _authFailureHandler: ((reason: AuthFailureReason) => void) | null = null;

export function setApiAuthFailureHandler(handler: ((reason: AuthFailureReason) => void) | null): void {
  _authFailureHandler = handler;
}

/**
 * Singleton API client for the mobile app.
 *
 * Auth token resolution order:
 * 1. In-memory cache — always current after signIn/signOut
 * 2. SecureStore — cold-launch fallback before the provider has run
 */
export const mobileApi = createApiClient({
  baseUrl: env.apiBaseUrl,
  getAuthToken: async () => {
    if (_tokenCache) return _tokenCache;
    return SecureStore.getItemAsync("session_token");
  },
  onAuthFailure: (reason) => {
    _authFailureHandler?.(reason);
  },
});
