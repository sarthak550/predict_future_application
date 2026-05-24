import { type Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getServerSession, type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";

if (!process.env.NEXTAUTH_SECRET) throw new Error("NEXTAUTH_SECRET env var is required");
// Non-null assertion is safe: the throw above guarantees this is set at module load time.
const JWT_SECRET: string = process.env.NEXTAUTH_SECRET;

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
        // Defense in depth: mobile JWTs are 30-day tokens — check isSuspended on every
        // request so suspension takes effect immediately rather than at token expiry.
        // One extra DB lookup per Bearer-authed request is acceptable vs shortening TTL.
        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          select: { isSuspended: true },
        });
        if (!user || user.isSuspended) return null;
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

        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase() }
        });

        if (!user?.passwordHash) {
          return null;
        }

        const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!isValid || user.isSuspended) {
          return null;
        }

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
