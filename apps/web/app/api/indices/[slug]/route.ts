import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Same-box default: apps/api's `pf-api` container listens on 127.0.0.1:3001 (see EC2 prod ops). */
const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:3001";
const UPSTREAM_TIMEOUT_MS = 8000;

/**
 * GET /api/indices/[slug]
 *
 * Browser-facing loopback proxy to apps/api's /api/finance/indices/[slug].
 * Same rationale as app/api/indices/route.ts — the /indices/[slug] page
 * itself fetches apps/api directly (lib/finance/indices.ts), this route
 * exists for any client-side caller.
 */
export async function GET(_request: Request, { params }: { params: { slug: string } }) {
  const rawSlug = params.slug;
  if (!rawSlug || typeof rawSlug !== "string" || rawSlug.trim().length === 0) {
    return NextResponse.json({ error: "Slug is required." }, { status: 400 });
  }

  const apiBase = process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
  const upstreamUrl = `${apiBase}/api/finance/indices/${encodeURIComponent(rawSlug.trim())}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(upstreamUrl, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });

    const body = await upstream.json().catch(() => null);
    if (body === null) {
      return NextResponse.json({ error: "Index data temporarily unavailable." }, { status: 502 });
    }

    return NextResponse.json(body, { status: upstream.status });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(
      `[api/indices/slug] upstream fetch failed for ${rawSlug}: ${isAbort ? "timed out" : err instanceof Error ? err.message : err}`
    );
    return NextResponse.json({ error: "Index data temporarily unavailable." }, { status: 504 });
  } finally {
    clearTimeout(timeout);
  }
}
