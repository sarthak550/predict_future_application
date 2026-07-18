import { router } from "expo-router";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as SecureStore from "expo-secure-store";

import { mobileApi, setApiAuthFailureHandler, setApiTokenCache } from "@/lib/api";

const SESSION_TOKEN_KEY = "session_token";
const SESSION_USER_ID_KEY = "session_user_id";
const SESSION_USERNAME_KEY = "session_username";

export type Session = {
  userId: string;
  username: string;
  token: string;
};

export type SessionState = {
  session: Session | null;
  status: "loading" | "authenticated" | "unauthenticated";
  isNewUser: boolean;
  signIn: (args: { userId: string; username: string; token: string; isNew?: boolean }) => void;
  signOut: () => void;
};

const SessionContext = createContext<SessionState | null>(null);

/**
 * Reads the persisted session from SecureStore on cold launch.
 * Returns a fully-formed Session if all three keys are present; otherwise null.
 */
async function resolveInitialSession(): Promise<Session | null> {
  const [token, userId, username] = await Promise.all([
    SecureStore.getItemAsync(SESSION_TOKEN_KEY),
    SecureStore.getItemAsync(SESSION_USER_ID_KEY),
    SecureStore.getItemAsync(SESSION_USERNAME_KEY),
  ]);

  if (token && userId && username) {
    return { token, userId, username };
  }
  return null;
}

/**
 * Fire-and-forget daily login bonus claim (+100 pts once per IST day, via
 * the DAILY_LOGIN quest). Non-blocking and idempotent server-side — never
 * gates navigation and swallows errors so a flaky network never surfaces
 * to the user. Called on cold launch (stored token) and after signIn()
 * (fresh login/signup).
 */
function claimDailyBonusSilently(): void {
  mobileApi.claimDailyBonus().catch((err) => {
    console.warn("[SessionProvider] claimDailyBonus failed (non-fatal):", err);
  });
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionState["status"]>("loading");
  const [isNewUser, setIsNewUser] = useState(false);
  // Track whether this is the first signIn within the session to guard
  // against stale closure captures when the isNewUser flag is consumed.
  const isNewUserRef = useRef(false);
  // Synchronous mirror of `session` used to make signOut idempotent (see below).
  const sessionRef = useRef<Session | null>(null);

  useEffect(() => {
    let cancelled = false;
    void resolveInitialSession().then((next) => {
      if (cancelled) return;
      if (next) setApiTokenCache(next.token);
      sessionRef.current = next;
      setSession(next);
      setStatus(next ? "authenticated" : "unauthenticated");
      if (next) claimDailyBonusSilently();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(
    (args: { userId: string; username: string; token: string; isNew?: boolean }) => {
      const next: Session = {
        userId: args.userId,
        username: args.username,
        token: args.token,
      };
      setApiTokenCache(args.token);
      sessionRef.current = next;
      setSession(next);
      setStatus("authenticated");
      claimDailyBonusSilently();

      const newFlag = args.isNew ?? false;
      isNewUserRef.current = newFlag;
      setIsNewUser(newFlag);

      // Persist to SecureStore asynchronously — non-blocking, failures are logged
      void Promise.all([
        SecureStore.setItemAsync(SESSION_TOKEN_KEY, args.token),
        SecureStore.setItemAsync(SESSION_USER_ID_KEY, args.userId),
        SecureStore.setItemAsync(SESSION_USERNAME_KEY, args.username),
      ]).catch((err) => {
        console.error("[SessionProvider] Failed to persist session:", err);
      });
    },
    []
  );

  const signOut = useCallback(() => {
    // Idempotent: a burst of in-flight 401/404s can each fire the auth-failure
    // handler below. Without this guard, signOut → router.replace("/(auth)/sign-in")
    // runs repeatedly, remounting the sign-in screen ("refreshing while typing").
    // Reading a synchronous ref (not state) blocks re-entrant calls in the same tick.
    if (!sessionRef.current) return;
    sessionRef.current = null;
    setApiTokenCache(null);
    setSession(null);
    setStatus("unauthenticated");
    setIsNewUser(false);
    isNewUserRef.current = false;

    // Clear all stored keys asynchronously
    void Promise.all([
      SecureStore.deleteItemAsync(SESSION_TOKEN_KEY),
      SecureStore.deleteItemAsync(SESSION_USER_ID_KEY),
      SecureStore.deleteItemAsync(SESSION_USERNAME_KEY),
    ]).catch((err) => {
      console.error("[SessionProvider] Failed to clear session:", err);
    });

    router.replace("/(auth)/sign-in");
  }, []);

  // Sign the user out automatically when the API reports the session is no longer
  // valid — e.g. 401 on an authenticated request, or 404 on /api/profile/me when
  // the stored userId no longer exists in the DB (after a re-seed).
  useEffect(() => {
    setApiAuthFailureHandler(() => {
      signOut();
    });
    return () => setApiAuthFailureHandler(null);
  }, [signOut]);

  const value = useMemo<SessionState>(
    () => ({ session, status, isNewUser, signIn, signOut }),
    [session, status, isNewUser, signIn, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used inside <SessionProvider>.");
  }
  return ctx;
}

/**
 * Returns the currently-stored auth token directly from SecureStore.
 * Use this at the module level (e.g. in api.ts) where React context is not available.
 */
export function getSessionToken(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_TOKEN_KEY);
}
