import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/users/push-token
 *
 * Saves an Expo push token for the authenticated user. Called from the mobile
 * app after `Notifications.getExpoPushTokenAsync()` resolves. Idempotent —
 * safe to call on every app launch.
 *
 * Authorization: Bearer <JWT from mobile login>
 * Body: { token: string }
 */
export async function POST(request: Request) {
  try {
    // --- Auth: getUserIdFromRequest handles both Bearer JWT and NextAuth session.
    // Suspended users receive null and are rejected at the 401 gate below.
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "Authorization required." }, { status: 401 });
    }

    // --- Validate request body ---
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
    }

    if (!body || typeof body !== "object" || !("token" in body)) {
      return NextResponse.json({ error: "Missing required field: token." }, { status: 400 });
    }

    const token = (body as Record<string, unknown>).token;
    if (typeof token !== "string" || token.trim() === "") {
      return NextResponse.json({ error: "token must be a non-empty string." }, { status: 400 });
    }

    const trimmedToken = token.trim();

    // Validate token looks like an Expo push token or a valid FCM/APNs device token
    const EXPO_TOKEN_RE = /^ExponentPushToken\[.+\]$/;
    const NATIVE_TOKEN_RE = /^[a-zA-Z0-9_-]{20,}$/;
    if (!EXPO_TOKEN_RE.test(trimmedToken) && !NATIVE_TOKEN_RE.test(trimmedToken)) {
      return NextResponse.json({ error: "Invalid push token format." }, { status: 400 });
    }

    // --- Upsert the token on the user record ---
    await prisma.user.update({
      where: { id: userId },
      data: { expoPushToken: trimmedToken },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push-token] Failed to save push token:", err);
    return NextResponse.json({ error: "Failed to save push token." }, { status: 500 });
  }
}
