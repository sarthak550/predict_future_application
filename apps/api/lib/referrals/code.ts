import crypto from "crypto";

import { prisma } from "@/lib/prisma";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_LENGTH = 8;

/**
 * Generates a random 8-character uppercase alphanumeric string.
 * Uses the first 4 alphanumeric characters of the username (uppercased)
 * plus 4 random uppercase alphanumeric characters.
 * Falls back to a fully random 8-char code if the username is too short or has no alphanumeric chars.
 */
function buildCode(username: string, randomSuffix: string): string {
  const prefix = username
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);

  if (prefix.length === 4) {
    return prefix + randomSuffix;
  }

  // Pad prefix with random chars if username prefix is too short
  const padded = prefix + randomSuffix.slice(0, 4 - prefix.length);
  return padded + randomSuffix.slice(4 - prefix.length);
}

function randomAlphanumericChars(length: number): string {
  const bytes = crypto.randomBytes(length * 2);
  let result = "";
  for (let i = 0; i < bytes.length && result.length < length; i++) {
    const idx = bytes[i] % ALPHABET.length;
    result += ALPHABET[idx];
  }
  return result;
}

/**
 * Generates a unique 8-character alphanumeric referral code for the given username.
 * Retries up to 5 times on collision; falls back to a fully random code.
 *
 * This function DOES NOT persist the code — callers must update the User row.
 */
export async function generateReferralCode(username: string): Promise<string> {
  const MAX_ATTEMPTS = 5;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const randomPart = randomAlphanumericChars(4);
    const code = buildCode(username, randomPart);

    const existing = await prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });

    if (!existing) {
      return code;
    }
  }

  // Fallback: fully random 8-char code
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = randomAlphanumericChars(CODE_LENGTH);
    const existing = await prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!existing) {
      return code;
    }
  }

  // Extremely unlikely — throw so the caller can surface the error
  throw new Error("Failed to generate a unique referral code after multiple attempts.");
}
