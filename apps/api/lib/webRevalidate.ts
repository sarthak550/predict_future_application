/**
 * Push-based web revalidation: the crons call this the moment they write fresh
 * data, so the web app's ISR pages regenerate within seconds instead of waiting
 * out their 5–60 min timers. Closes the app-vs-web data-freshness gap (mobile
 * reads the DB live; web serves snapshots).
 *
 * Target: apps/web's POST /api/revalidate (same box — default
 * http://127.0.0.1:3000/api/revalidate, override via WEB_REVALIDATE_URL).
 * Auth: the shared CRON_SECRET. Never throws; a dead web container must never
 * break a cron.
 */

type RevalidateEntry = string | [string, "page" | "layout"];

export async function notifyWebRevalidate(paths: RevalidateEntry[]): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  const url = process.env.WEB_REVALIDATE_URL ?? "http://127.0.0.1:3000/api/revalidate";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ paths }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Fire-and-forget by contract.
  }
}
