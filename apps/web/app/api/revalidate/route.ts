import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

/**
 * POST /api/revalidate — on-demand ISR revalidation, called by apps/api's crons
 * the moment they write fresh data (movers, quotes, gradings, portfolio NAVs).
 *
 * WHY: web pages are ISR-cached for speed/SEO (5–60 min windows), while the
 * mobile app reads the DB live through the API — so the two surfaces could show
 * the same record at different moments in time. Push-based revalidation closes
 * that gap to seconds: data freshness becomes event-driven, not timer-driven.
 *
 * Auth: same CRON_SECRET as the API's cron routes (Bearer). Body:
 *   { "paths": ["/pulse", "/"] }
 * Dynamic-route parents may be passed with a trailing layout marker, e.g.
 *   { "paths": [["/instruments/[symbol]", "page"]] }
 */

const MAX_PATHS = 20;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { paths?: Array<string | [string, "page" | "layout"]> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const paths = (body.paths ?? []).slice(0, MAX_PATHS);
  const revalidated: string[] = [];
  for (const entry of paths) {
    const [path, type] = Array.isArray(entry) ? entry : [entry, undefined];
    if (typeof path !== "string" || !path.startsWith("/")) continue;
    try {
      if (type) revalidatePath(path, type);
      else revalidatePath(path);
      revalidated.push(path);
    } catch {
      // A bad path never breaks the batch — the caller is a fire-and-forget cron.
    }
  }

  return NextResponse.json({ ok: true, revalidated });
}
