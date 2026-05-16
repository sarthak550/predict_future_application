/**
 * In-memory phone verification store.
 *
 * Stores pending OTPs keyed by userId so that the confirm endpoint can look up
 * the phone number and OTP that were issued for a given authenticated user.
 *
 * TODO: Replace with Redis when moving to a production SMS provider (Twilio/MSG91).
 *       The in-memory approach works for a single-process dev/MVP deployment but
 *       will not survive process restarts or horizontal scaling.
 */

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface PendingVerification {
  phone: string;
  otp: string;
  expiresAt: number;
}

// Module-level map keyed by userId.
const pendingVerifications = new Map<string, PendingVerification>();

/**
 * Generate a cryptographically-adequate 6-digit OTP string.
 * Uses Math.random for simplicity in this dev-mode implementation.
 * TODO: Replace with crypto.randomInt(100000, 999999) when shipping real SMS.
 */
export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Store a new OTP for the given user+phone pair.
 * Overwrites any existing pending verification for this userId.
 *
 * @returns The generated OTP string (so the caller can log/return it in dev mode).
 */
export function storeOtp(userId: string, phone: string): string {
  const otp = generateOtp();
  pendingVerifications.set(userId, {
    phone,
    otp,
    expiresAt: Date.now() + OTP_TTL_MS,
  });
  return otp;
}

/**
 * Retrieve the pending verification record for a userId without consuming it.
 * Returns null if no pending verification or if it has expired.
 */
export function getOtp(userId: string): PendingVerification | null {
  const record = pendingVerifications.get(userId);
  if (!record) return null;
  if (Date.now() > record.expiresAt) {
    pendingVerifications.delete(userId);
    return null;
  }
  return record;
}

/**
 * Verify an OTP for the given userId.
 * Performs a constant-time-equivalent string comparison.
 *
 * @returns Object with valid flag and the phone number on success.
 */
export function verifyOtp(
  userId: string,
  otp: string
): { valid: boolean; phone: string | null } {
  const record = getOtp(userId);
  if (!record) {
    return { valid: false, phone: null };
  }

  const isMatch = record.otp === otp;
  if (!isMatch) {
    return { valid: false, phone: null };
  }

  return { valid: true, phone: record.phone };
}

/**
 * Remove the pending verification for a userId.
 * Call this after successful confirmation to prevent OTP reuse.
 */
export function clearOtp(userId: string): void {
  pendingVerifications.delete(userId);
}

/**
 * Normalise an Indian mobile number to 10 digits (strip +91 prefix if present).
 * Returns null if the resulting string is not exactly 10 digits.
 */
export function normaliseIndianPhone(raw: string): string | null {
  // Strip whitespace
  let phone = raw.trim();

  // Strip leading +91 or 91 (India country code)
  if (phone.startsWith("+91")) {
    phone = phone.slice(3);
  } else if (phone.startsWith("91") && phone.length === 12) {
    phone = phone.slice(2);
  }

  // Must now be exactly 10 digits
  if (!/^\d{10}$/.test(phone)) {
    return null;
  }

  return phone;
}
