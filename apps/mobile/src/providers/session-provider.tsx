import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as SecureStore from "expo-secure-store";

import { setApiTokenCache } from "@/lib/api";

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

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionState["status"]>("loading");
  const [isNewUser, setIsNewUser] = useState(false);
  // Track whether this is the first signIn within the session to guard
  // against stale closure captures when the isNewUser flag is consumed.
  const isNewUserRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void resolveInitialSession().then((next) => {
      if (cancelled) return;
      if (next) setApiTokenCache(next.token);
      setSession(next);
      setStatus(next ? "authenticated" : "unauthenticated");
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
      setSession(next);
      setStatus("authenticated");

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
  }, []);

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
