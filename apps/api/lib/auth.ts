import { type Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getServerSession, type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";

const JWT_SECRET = process.env.NEXTAUTH_SECRET ?? "fallback-dev-secret";

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
      if (payload.sub) return payload.sub;
    } catch {
      // Invalid or expired — fall through to NextAuth check
    }
  }

  // 2. NextAuth session (web cookie-based)
  try {
    const session = await getSession();
    if (session?.user?.id) return session.user.id;
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
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.role = user.role;
        token.username = user.username;
        token.isSuspended = user.isSuspended;
      }

      if (token.sub) {
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
