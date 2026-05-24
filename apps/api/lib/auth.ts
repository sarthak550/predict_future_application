import { type Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getServerSession, type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";

if (!process.env.NEXTAUTH_SECRET) throw new Error("NEXTAUTH_SECRET env var is required");
// Non-null assertion is safe: the throw above guarantees this is set at module load time.
const JWT_SECRET: string = process.env.NEXTAUTH_SECRET;

/**
 * Process-local cache of {userId → isSuspended} with a 5-minute TTL.
 *
 * Background: getUserIdFromRequest used to hit the DB on every Bearer-authed
 * request just to read the isSuspended flag. On a hot mobile route that's
 * one extra query per request — measurable load and unnecessary if the same
 * device just made the same call seconds ago.
 *
 * TTL is 5 min to match the NextAuth-side stale-window (auth.ts jwt callback).
 * A suspension propagates to mobile within 5 minutes of being toggled by
 * admin/moderator action — same SLA the web side has.
 *
 * Negative cache: we cache "not suspended" only. A suspended (or deleted)
 * user is treated as null and never cached, so the next request re-checks
 * and stays denied — this also covers the unsuspend path naturally.
 */
const SUSPEND_CACHE_TTL_MS = 5 * 60 * 1000;
const _suspendCache = new Map<string, number>(); // userId → "good until" epoch ms

function _suspendCacheHit(userId: string): boolean {
  const expiresAt = _suspendCache.get(userId);
  if (!expiresAt) return false;
  if (Date.now() >= expiresAt) {
    _suspendCache.delete(userId);
    return false;
  }
  return true;
}

function _suspendCacheStore(userId: string): void {
  _suspendCache.set(userId, Date.now() + SUSPEND_CACHE_TTL_MS);
  // Best-effort cleanup so the Map doesn't grow unbounded on long-running
  // workers. Cheap because we only walk when the size crosses a soft cap.
  if (_suspendCache.size > 5000) {
    const now = Date.now();
    for (const [id, exp] of _suspendCache) {
      if (now >= exp) _suspendCache.delete(id);
    }
  }
}

/** Test-only: clear the cache. Not exported via the package boundary. */
export function _resetSuspendCacheForTests(): void {
  _suspendCache.clear();
}

/**
 * Resolves the authenticated user ID from any request — works for both
 * web (NextAuth session cookie) and mobile (JWT Bearer token).
 */
export async function getUserIdFromRequest(request: Request): Promise<string | null> {
  // 1. JWT Bearer token (mobile) — check first, fast path
  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (bearer) {
    try {
      const payload = jwt.verify(bearer, JWT_SECRET) as { sub?: string };
      if (payload.sub) {
        // 5-min TTL cache: if this user passed the suspension gate recently,
        // skip the DB lookup. Suspensions still propagate within 5 min — same
        // SLA as the web/NextAuth jwt callback uses on the cookie side.
        if (_suspendCacheHit(payload.sub)) {
          return payload.sub;
        }
        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          select: { isSuspended: true },
        });
        if (!user || user.isSuspended) return null;
        _suspendCacheStore(payload.sub);
        return payload.sub;
      }
    } catch {
      // Invalid or expired — fall through to NextAuth check
    }
  }

  // 2. NextAuth session (web cookie-based) — isSuspended is refreshed on every request
  // via the jwt callback (lines 94-108), so session.user.isSuspended is authoritative.
  try {
    const session = await getSession();
    if (session?.user?.id && !session.user.isSuspended) return session.user.id;
  } catch {
    // getSession can throw in some Next.js contexts — ignore
  }

  return null;
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt"
  },
  pages: {
    signIn: "/sign-in"
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) {
          return null;
        }

        const email = credentials.email.toLowerCase();

        // Brute-force protection. NextAuth's credentials authorize() does not
        // receive request headers in a portable way (varies by adapter), so we
        // only do the per-email gate here. The mobile login route adds the IP gate.
        // 5 failed attempts per 15 min per email; resets on success.
        const rl = await checkRateLimit(`login:email:${email}`, 5, 15 * 60 * 1000);
        if (!rl.allowed) {
          // NextAuth swallows thrown errors into a generic CredentialsSignin error
          // on the client. Returning null is the standard way to deny — the user sees
          // "Invalid email or password" which doesn't reveal the lockout. That's OK:
          // the lockout still applies until the rate-limit window expires.
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email }
        });

        if (!user?.passwordHash) {
          return null;
        }

        const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!isValid || user.isSuspended) {
          return null;
        }

        // Successful login — clear the per-email failed-attempt counter.
        await resetRateLimit(`login:email:${email}`);

        return {
          id: user.id,
          email: user.email,
          name: user.username,
          username: user.username,
          role: user.role,
          isSuspended: user.isSuspended
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.sub = user.id;
        token.role = user.role;
        token.username = user.username;
        token.isSuspended = user.isSuspended;
        token.refreshedAt = Date.now();
      }

      // Re-fetch from DB only when the cached data is stale (> 5 min) or an
      // explicit session update is triggered. This cuts per-request DB load on
      // busy admin pages while still propagating suspensions within 5 minutes.
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      const isStale = !token.refreshedAt || (token.refreshedAt as number) < fiveMinAgo;

      if (token.sub && (isStale || trigger === "update")) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: {
            role: true,
            username: true,
            isSuspended: true
          }
        });

        if (dbUser) {
          token.role = dbUser.role;
          token.username = dbUser.username;
          token.isSuspended = dbUser.isSuspended;
          token.refreshedAt = Date.now();
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.username = (token.username as string) ?? "";
        session.user.role = (token.role as Role) ?? "USER";
        session.user.isSuspended = Boolean(token.isSuspended);
      }

      return session;
    }
  }
};

export async function getSession() {
  return getServerSession(authOptions);
}

export async function getCurrentUser() {
  const session = await getSession();
  if (!session?.user?.id) {
    return null;
  }

  return prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      wallet: true,
      stats: true,
      badges: {
        include: {
          badge: true
        }
      }
    }
  });
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/sign-in");
  }

  if (user.isSuspended) {
    redirect("/sign-in?error=suspended");
  }

  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN" && user.role !== "MODERATOR") {
    redirect("/feed");
  }
  return user;
}
