import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { env } from "@/lib/env";

/**
 * Lightweight session scaffold. The current product has a `EXPO_PUBLIC_DEMO_USER_ID`
 * for development; once real auth lands (Clerk or credential exchange against apps/api),
 * swap `resolveInitialSession` for a real token/session fetch and extend `Session` with
 * the fields the app needs. Consumers should keep reading through `useSession()` so the
 * auth implementation can change without touching screens.
 */

export type Session = {
  userId: string;
  // Placeholder for future fields:
  // token: string;
  // expiresAt: number;
};

export type SessionState = {
  session: Session | null;
  status: "loading" | "authenticated" | "unauthenticated";
  signOut: () => void;
};

const SessionContext = createContext<SessionState | null>(null);

async function resolveInitialSession(): Promise<Session | null> {
  if (env.demoUserId) {
    return { userId: env.demoUserId };
  }
  return null;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionState["status"]>("loading");

  useEffect(() => {
    let cancelled = false;
    void resolveInitialSession().then((next) => {
      if (cancelled) return;
      setSession(next);
      setStatus(next ? "authenticated" : "unauthenticated");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(() => {
    setSession(null);
    setStatus("unauthenticated");
  }, []);

  const value = useMemo<SessionState>(
    () => ({ session, status, signOut }),
    [session, status, signOut]
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
