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
 *   - Generates a 6-digit OTP and stores it in the in-memory store (10-minute TTL).
 *   - If PHONE_VERIFY_MODE === "dev" or is unset: logs OTP to console and
 *     includes { devOtp } in the response.
 *   - If PHONE_VERIFY_MODE === "prod": OTP is not included in the response.
 *   - Saves the (unverified) phone number on the User record immediately.
 */

import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normaliseIndianPhone, storeOtp } from "@/lib/phone-verification";

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
      return NextResponse.json({ error: "phone is required and must be a string." }, { status: 400 });
    }

    const rawPhone = (body as { phone: string }).phone;
    const phone = normaliseIndianPhone(rawPhone);

    if (!phone) {
      return NextResponse.json(
        { error: "Invalid phone number. Please provide a 10-digit Indian mobile number (with or without +91 prefix)." },
        { status: 400 }
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

    // Generate and store OTP; save phone (unverified) on the user record.
    const otp = storeOtp(userId, phone);

    await prisma.user.update({
      where: { id: userId },
      data: { phone },
    });

    const isDevMode = process.env.PHONE_VERIFY_MODE !== "prod";

    if (isDevMode) {
      console.log(`[phone-verification] OTP for ${phone}: ${otp}`);
      return NextResponse.json({ ok: true, otp });
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
