import crypto from "crypto";

import { prisma } from "@/lib/prisma";

const MIN_LENGTH = 3;
const MAX_LENGTH = 24;
const MAX_ATTEMPTS = 5;

/**
 * Reduces an email local-part to the `[a-zA-Z0-9_]` charset User.username
 * requires (see packages/validation/src/auth.ts's registerSchema), padding
 * with a generic prefix if stripping non-ASCII/punctuation leaves it under
 * the 3-character minimum (e.g. an email whose local-part is entirely
 * non-Latin characters).
 */
function slugifyLocalPart(email: string): string {
  const localPart = email.split("@")[0] ?? "";
  const slug = localPart.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (slug.length >= MIN_LENGTH) {
    return slug.slice(0, MAX_LENGTH);
  }
  return `${slug}user`.slice(0, MAX_LENGTH);
}

function randomHexSuffix(length: number): string {
  return crypto.randomBytes(length).toString("hex").slice(0, length);
}

/**
 * Generates a unique username for a brand-new Google OAuth sign-up, modeled
 * after apps/api/lib/referrals/code.ts's generateReferralCode: slugify a
 * human-readable base (here, the email local-part), append a random suffix
 * on collision, and retry a bounded number of times before falling back to a
 * fully random username.
 *
 * The stock PrismaAdapter.createUser has no concept of User.username at all
 * (it forwards only {name,email,image,emailVerified}), and username is
 * @unique with no default in the schema -- without this, the very first
 * non-linked Google sign-in 500s with "Argument username is missing."
 */
export async function generateUniqueUsernameFromEmail(email: string): Promise<string> {
  const base = slugifyLocalPart(email);

  const existingBase = await prisma.user.findUnique({
    where: { username: base },
    select: { id: true }
  });
  if (!existingBase) {
    return base;
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = `${base}_${randomHexSuffix(4)}`.slice(0, MAX_LENGTH);
    const existing = await prisma.user.findUnique({
      where: { username: candidate },
      select: { id: true }
    });
    if (!existing) {
      return candidate;
    }
  }

  // Extremely unlikely fallback: fully random username.
  return `user_${randomHexSuffix(12)}`;
}
