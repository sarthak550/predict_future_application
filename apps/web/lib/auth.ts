import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { type Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { getServerSession, type NextAuthOptions, type User } from "next-auth";
import { type Adapter, type AdapterUser } from "next-auth/adapters";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider, { type GoogleProfile } from "next-auth/providers/google";
import { redirect } from "next/navigation";

import { isCredentialsLoginAllowed } from "@/lib/auth/credentialsGate";
import { generateUniqueUsernameFromEmail } from "@/lib/auth/generateUniqueUsername";
import { STARTING_BALANCE } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

/**
 * Wraps the stock PrismaAdapter's createUser so a brand-new Google sign-up
 * gets the same account shape apps/web/app/api/auth/register/route.ts builds
 * for a credentials sign-up. The default adapter only forwards
 * {name,email,image,emailVerified} into `prisma.user.create` -- since
 * User.username is @unique with no default (and `name` isn't even a column
 * on this schema), that call 500s with "Argument username is missing" on the
 * very first non-linked Google sign-in. It also has no idea a Wallet,
 * UserStat, or welcome Notification need to exist, which every other part of
 * the app assumes (getCurrentUser() below does
 * `include: { wallet: true, stats: true, badges: true }`).
 *
 * emailVerified is set unconditionally to `new Date()` here rather than
 * trusting `data.emailVerified` (verified against the installed
 * next-auth@4.24.14 source, not assumed): core/lib/callback-handler.js
 * builds the payload it hands to adapter.createUser for a brand-new OAuth
 * user as `{ ...profile, emailVerified: null }` -- the trailing
 * `emailVerified: null` unconditionally overwrites whatever the provider's
 * own profile() returned, discarding the mapping below regardless. Google is
 * the only OAuth provider wired into this adapter, and CredentialsProvider
 * never touches the adapter at all (next-auth's credentials callback route
 * is a fully separate code path that never calls createUser) -- so any
 * invocation of this function is, by construction, a completed Google
 * identity round-trip, making a real verified timestamp correct here rather
 * than an assumption.
 */
async function createGoogleUser(data: Omit<AdapterUser, "id">): Promise<AdapterUser> {
  const email = data.email.toLowerCase();
  const username = await generateUniqueUsernameFromEmail(email);

  return prisma.user.create({
    data: {
      username,
      email,
      emailVerified: new Date(),
      image: data.image ?? null,
      avatarUrl: data.image ?? null,
      wallet: {
        create: {
          balance: STARTING_BALANCE,
          startingBalance: STARTING_BALANCE
        }
      },
      stats: {
        create: {}
      },
      notifications: {
        create: {
          type: "SYSTEM",
          title: "Welcome to the news feed",
          body: `Your account is ready and ${STARTING_BALANCE.toLocaleString("en-IN")} virtual points have been added for your first predictions.`,
          href: "/"
        }
      }
    }
  });
}

const providers: NextAuthOptions["providers"] = [];

// Gated out of production entirely, not just hidden behind a UI toggle: leaving
// the provider registered while only hiding the sign-in button would still leave
// POST /api/auth/callback/credentials directly callable -- a half-fix. See
// apps/web/lib/auth/credentialsGate.ts for the flag's full rationale.
if (isCredentialsLoginAllowed()) {
  providers.push(
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
  );
}

// Only registered when both env vars are present -- keeps the app inert-but-safe
// (falls back to credentials-only) until the founder completes the Google Cloud
// Console setup (S74-T5) and sets GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET.
if (googleClientId && googleClientSecret) {
  providers.push(
    GoogleProvider({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      // Google verifies email ownership, so auto-linking an OAuth sign-in to an
      // existing User row with the same email is safe -- this is NextAuth's own
      // built-in, officially-supported mechanism for exactly this case. It's how
      // every existing founder/dev/seed credentials account gets continuity on
      // first Google sign-in: same user id, same wallet/stats/history, zero
      // migration script.
      allowDangerousEmailAccountLinking: true,
      profile(profile: GoogleProfile) {
        // Cast through `unknown`: this app's module augmentation (types/next-auth.d.ts)
        // adds username/role/isSuspended as REQUIRED fields on next-auth's `User` type,
        // because every other code path that produces a `User` (CredentialsProvider's
        // authorize(), a real Prisma row from createGoogleUser/getUserByAccount) always
        // has them. This return value runs before any of that -- NextAuth only reads
        // id/name/email/image/emailVerified off it here, then either creates
        // (createGoogleUser fills in the rest) or looks up (existing row already has
        // them) the real user. The assertion is narrowly safe, not a type-safety hole.
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
          emailVerified: profile.email_verified ? new Date() : null
        } as unknown as User;
      }
    })
  );
}

export const authOptions: NextAuthOptions = {
  adapter: {
    ...PrismaAdapter(prisma),
    createUser: createGoogleUser
  } as Adapter,
  session: {
    strategy: "jwt"
  },
  pages: {
    signIn: "/sign-in"
  },
  providers,
  callbacks: {
    async jwt({ token, user }) {
      // On initial sign-in, seed the token payload from the authorize() result
      // and stamp a refreshedAt timestamp.
      if (user) {
        token.sub = user.id;
        token.role = user.role;
        token.username = user.username;
        token.isSuspended = user.isSuspended;
        token.refreshedAt = Date.now();
        return token;
      }

      // On subsequent requests, skip the DB re-fetch if the cached data is
      // less than 5 minutes old. This prevents an O(N-requests) DB query pattern
      // that adds latency and load on every authenticated web request.
      const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
      const refreshedAt = typeof token.refreshedAt === "number" ? token.refreshedAt : 0;
      if (Date.now() - refreshedAt < CACHE_TTL_MS) {
        return token;
      }

      // TTL expired — refresh role/suspension status from DB and reset the clock.
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

        token.refreshedAt = Date.now();
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
    redirect("/");
  }
  return user;
}
