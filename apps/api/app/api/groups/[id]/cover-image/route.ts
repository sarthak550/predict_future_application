/**
 * S58: Group cover image upload endpoints.
 *
 * POST  /api/groups/:id/cover-image
 *   Generates a short-lived Vercel Blob client upload token.
 *   Caller must be OWNER or ADMIN. Returns { clientToken, url }.
 *   Client uses the token to upload directly to Vercel Blob, then calls PATCH.
 *
 * PATCH /api/groups/:id/cover-image
 *   Persists the resulting Blob URL to Group.coverImageUrl.
 *   Validates the URL starts with the Vercel Blob public hostname (security check).
 *   Returns { coverImageUrl }.
 *
 * Security: Vercel Blob enforces the 5MB cap server-side via maximumSizeInBytes
 * in the client token. The PATCH hostname check prevents arbitrary URL injection.
 */

import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import path from "path";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Startup guard: throw clearly if the token is unset rather than failing silently.
function getBlobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is required. Provision a Blob store in the Vercel dashboard and set this env var."
    );
  }
  return token;
}

const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

/**
 * Vercel Blob public hostname pattern.
 * All uploaded blobs are served from *.public.blob.vercel-storage.com.
 * The PATCH endpoint rejects any coverImageUrl that doesn't match.
 */
const BLOB_HOSTNAME_PATTERN = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//;

/**
 * Require that the caller is an active OWNER or ADMIN of the group.
 * Returns the group record on success, null on failure (caller should 403/404).
 */
async function requireOwnerOrAdmin(
  groupId: string,
  userId: string
): Promise<{ id: string; name: string } | null> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true, name: true, isArchived: true }
  });

  if (!group || group.isArchived) return null;

  const membership = await prisma.groupMembership.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { role: true, bannedAt: true }
  });

  if (!membership || membership.bannedAt != null) return null;
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") return null;

  return { id: group.id, name: group.name };
}

/**
 * POST /api/groups/:id/cover-image
 * Returns a short-lived Vercel Blob client upload token.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const group = await requireOwnerOrAdmin(params.id, userId);
  if (!group) {
    return NextResponse.json({ error: "Group not found or access denied." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { filename, contentType } = body as {
    filename?: unknown;
    contentType?: unknown;
  };

  if (!filename || typeof filename !== "string" || filename.trim().length === 0) {
    return NextResponse.json({ error: "filename is required." }, { status: 400 });
  }

  if (
    !contentType ||
    typeof contentType !== "string" ||
    !ALLOWED_CONTENT_TYPES.includes(contentType as AllowedContentType)
  ) {
    return NextResponse.json(
      {
        error: `contentType must be one of: ${ALLOWED_CONTENT_TYPES.join(", ")}.`
      },
      { status: 400 }
    );
  }

  // Derive extension from contentType for a clean Blob path.
  const ext = contentType.split("/")[1] ?? "jpg";
  const pathname = `groups/${params.id}/cover.${ext}`;

  let clientToken: string;
  let uploadUrl: string;

  try {
    const blobToken = getBlobToken();
    const result = await generateClientTokenFromReadWriteToken({
      token: blobToken,
      pathname,
      maximumSizeInBytes: 5 * 1024 * 1024, // 5MB hard cap (Vercel enforces server-side)
      allowedContentTypes: ALLOWED_CONTENT_TYPES as unknown as string[],
      validUntil: Date.now() + 60_000, // 60-second upload window
    });
    // generateClientTokenFromReadWriteToken returns the token string directly
    clientToken = result;
    // Derive the final blob URL from the pathname and project hostname
    // The client will receive the actual URL from Vercel's upload response.
    // We return a preview path for the client to use with @vercel/blob/client.upload().
    uploadUrl = pathname;
  } catch (err) {
    console.error("[cover-image] token generation error:", err);
    const message = err instanceof Error ? err.message : "Failed to generate upload token.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ clientToken, url: uploadUrl });
}

/**
 * PATCH /api/groups/:id/cover-image
 * Persists a Vercel Blob URL to Group.coverImageUrl.
 * Validates hostname to prevent arbitrary URL injection.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const group = await requireOwnerOrAdmin(params.id, userId);
  if (!group) {
    return NextResponse.json({ error: "Group not found or access denied." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { coverImageUrl } = body as { coverImageUrl?: unknown };

  if (!coverImageUrl || typeof coverImageUrl !== "string") {
    return NextResponse.json({ error: "coverImageUrl is required." }, { status: 400 });
  }

  // Security: reject non-Blob URLs to prevent arbitrary URL injection / tracker URLs.
  if (!BLOB_HOSTNAME_PATTERN.test(coverImageUrl)) {
    return NextResponse.json(
      {
        error:
          "coverImageUrl must be a Vercel Blob URL (https://*.public.blob.vercel-storage.com/...)."
      },
      { status: 400 }
    );
  }

  await prisma.group.update({
    where: { id: params.id },
    data: { coverImageUrl }
  });

  return NextResponse.json({ coverImageUrl });
}
