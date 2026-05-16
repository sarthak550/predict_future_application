/**
 * DB-backed phone verification store.
 *
 * OTPs are persisted in the `PhoneVerificationOtp` table so they survive
 * process restarts and work correctly in horizontally-scaled deployments.
 * Each userId can have at most one pending OTP at a time (unique constraint).
 *
 * TTL: 10 minutes from creation.
 */

import crypto from "crypto";

import { prisma } from "@/lib/prisma";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Generate a cryptographically secure 6-digit OTP string.
 */
export function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Store a new OTP for the given user+phone pair.
 * Upserts so repeated calls overwrite the previous pending OTP.
 *
 * @returns The generated OTP string (so the caller can dispatch it via SMS or log it in dev mode).
 */
export async function storeOtp(userId: string, phone: string): Promise<string> {
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.phoneVerificationOtp.upsert({
    where: { userId },
    create: { userId, phone, otp, expiresAt },
    update: { phone, otp, expiresAt },
  });

  return otp;
}

/**
 * Retrieve the pending verification record for a userId without consuming it.
 * Returns null if no pending verification exists or if it has expired.
 */
export async function getOtp(
  userId: string
): Promise<{ phone: string; otp: string } | null> {
  const record = await prisma.phoneVerificationOtp.findUnique({
    where: { userId },
    select: { phone: true, otp: true, expiresAt: true },
  });

  if (!record) return null;

  if (new Date() > record.expiresAt) {
    // Clean up the stale row.
    await prisma.phoneVerificationOtp.delete({ where: { userId } }).catch(() => {
      // Ignore if it was already deleted by a concurrent request.
    });
    return null;
  }

  return { phone: record.phone, otp: record.otp };
}

/**
 * Verify an OTP for the given userId.
 *
 * @returns Object with valid flag and the phone number on success.
 */
export async function verifyOtp(
  userId: string,
  otp: string
): Promise<{ valid: boolean; phone: string | null }> {
  const record = await getOtp(userId);
  if (!record) {
    return { valid: false, phone: null };
  }

  if (record.otp !== otp) {
    return { valid: false, phone: null };
  }

  return { valid: true, phone: record.phone };
}

/**
 * Remove the pending verification for a userId.
 * Call this after successful confirmation to prevent OTP reuse.
 */
export async function clearOtp(userId: string): Promise<void> {
  await prisma.phoneVerificationOtp.delete({ where: { userId } }).catch(() => {
    // Ignore if already deleted (idempotent).
  });
}

/**
 * Normalise an Indian mobile number to 10 digits (strip +91 prefix if present).
 * Returns null if the resulting string is not exactly 10 digits.
 */
export function normaliseIndianPhone(raw: string): string | null {
  let phone = raw.trim();

  if (phone.startsWith("+91")) {
    phone = phone.slice(3);
  } else if (phone.startsWith("91") && phone.length === 12) {
    phone = phone.slice(2);
  }

  if (!/^\d{10}$/.test(phone)) {
    return null;
  }

  return phone;
}
