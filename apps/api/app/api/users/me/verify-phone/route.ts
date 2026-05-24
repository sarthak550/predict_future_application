/**
 * POST /api/users/me/verify-phone
 *
 * Initiates phone verification for the authenticated user.
 *
 * Body: { phone: string }
 *   - Accepts 10-digit Indian mobile numbers with or without +91 prefix.
 *   - Strips the country code and stores the normalised 10-digit number.
 *
 * Behaviour:
 *   - Returns 400 if the user already has phoneVerified=true.
 *   - Returns 409 if the phone is already registered to a different account.
 *   - Generates a 6-digit OTP and persists it in the DB with a 10-minute TTL.
 *   - In NODE_ENV !== "production": logs OTP to console and includes { otp }
 *     in the response body for QA convenience.
 *   - In NODE_ENV === "production": MSG91_AUTH_KEY is REQUIRED (module throws at
 *     boot if absent). The response body NEVER includes the OTP. SMS is dispatched
 *     via MSG91; on SMS failure the OTP remains in the DB for support lookup.
 *   - Saves the (unverified) phone number on the User record immediately so
 *     the confirm endpoint can use it.
 *
 * Required env vars (production):
 *   MSG91_AUTH_KEY      — from MSG91 dashboard > API Key (REQUIRED in prod)
 *   MSG91_SENDER_ID     — 6-char sender ID approved by MSG91 (e.g. PRDCFT)
 *   MSG91_TEMPLATE_ID   — DLT-registered template ID from MSG91 dashboard
 */

import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normaliseIndianPhone, storeOtp } from "@/lib/phone-verification";
import { checkRateLimit } from "@/lib/rate-limit";

// Boot-time assertion: in production, MSG91_AUTH_KEY is mandatory.
// Failing fast here prevents the silent OTP-echo fallback from activating in prod.
if (process.env.NODE_ENV === "production" && !process.env.MSG91_AUTH_KEY) {
  throw new Error(
    "MSG91_AUTH_KEY required in production. Set it in your environment before deploying."
  );
}

/**
 * Dispatch an OTP SMS via the MSG91 OTP API v5.
 *
 * Uses the canonical v5 endpoint: POST https://control.msg91.com/api/v5/otp
 * with authkey in the header (not the body) per MSG91 documentation.
 *
 * On any failure (network error, non-2xx response) this function throws.
 * Callers MUST catch and handle gracefully — SMS failure must never block the UX.
 */
async function sendMsg91Sms(phone: string, otp: string): Promise<void> {
  const authKey = process.env.MSG91_AUTH_KEY!;
  const templateId = process.env.MSG91_TEMPLATE_ID!;

  let res: Response;
  let responseText: string = "";

  try {
    res = await fetch("https://control.msg91.com/api/v5/otp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: authKey,
      },
      body: JSON.stringify({
        template_id: templateId,
        mobile: `91${phone}`,
        otp,
      }),
    });
    responseText = await res.text().catch(() => "(unreadable body)");
  } catch (networkError) {
    console.error("[verify-phone] MSG91 network error:", networkError);
    throw networkError;
  }

  if (!res.ok) {
    console.error(`[verify-phone] MSG91 responded with HTTP ${res.status}: ${responseText}`);
    throw new Error(`MSG91 responded with HTTP ${res.status}: ${responseText}`);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    if (
      typeof body !== "object" ||
      body === null ||
      !("phone" in body) ||
      typeof (body as Record<string, unknown>).phone !== "string"
    ) {
      return NextResponse.json(
        { error: "phone is required and must be a string." },
        { status: 400 }
      );
    }

    const rawPhone = (body as { phone: string }).phone;
    // Phone normalization is pure CPU — safe to run before rate-limit checks.
    const phone = normaliseIndianPhone(rawPhone);

    if (!phone) {
      return NextResponse.json(
        {
          error:
            "Invalid phone number. Please provide a 10-digit Indian mobile number (with or without +91 prefix).",
        },
        { status: 400 }
      );
    }

    // Rate limit: apply BEFORE any DB lookups.
    // Moving rate checks here prevents an attacker who knows valid phone numbers from
    // probing the DB to enumerate accounts before being throttled.
    // 3 OTP sends per user per hour AND 5 per phone number per hour.
    const rlUser = await checkRateLimit(`verify-phone:user:${userId}`, 3, 60 * 60 * 1000);
    if (!rlUser.allowed) {
      return NextResponse.json(
        { error: "Too many OTP requests. Please wait before requesting another code." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil((rlUser.resetAt - Date.now()) / 1000)) },
        }
      );
    }

    const rlPhone = await checkRateLimit(`verify-phone:phone:${phone}`, 5, 60 * 60 * 1000);
    if (!rlPhone.allowed) {
      return NextResponse.json(
        { error: "Too many OTP requests for this phone number. Please wait before trying again." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil((rlPhone.resetAt - Date.now()) / 1000)) },
        }
      );
    }

    // Fetch the current user to check verification status.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, phoneVerified: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    if (user.phoneVerified) {
      return NextResponse.json({ error: "Phone already verified." }, { status: 400 });
    }

    // Check if this phone is already registered to a different account.
    const existingOwner = await prisma.user.findUnique({
      where: { phone },
      select: { id: true },
    });

    if (existingOwner && existingOwner.id !== userId) {
      return NextResponse.json(
        { error: "This phone number is already registered to another account." },
        { status: 409 }
      );
    }

    // Generate and persist OTP; save phone (unverified) on the user record.
    const otp = await storeOtp(userId, phone);

    await prisma.user.update({
      where: { id: userId },
      data: { phone },
    });

    const isProduction = process.env.NODE_ENV === "production";

    if (!isProduction) {
      // Dev / test: log OTP to stdout and include it in the response for QA convenience.
      console.log(`[phone-verification] OTP for ${phone}: ${otp}`);
      return NextResponse.json({ ok: true, otp });
    }

    // Production: dispatch SMS via MSG91. On failure, log and continue — the
    // OTP is safely persisted in the DB. Never expose the OTP in the response.
    try {
      await sendMsg91Sms(phone, otp);
    } catch (smsError) {
      console.error("[verify-phone] MSG91 SMS dispatch failed:", smsError);
      // Do NOT surface the error to the client. The OTP is in the DB and
      // support can look it up if the user reports not receiving the SMS.
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[verify-phone POST]", error);
    return NextResponse.json(
      { error: "Unable to initiate phone verification." },
      { status: 500 }
    );
  }
}
