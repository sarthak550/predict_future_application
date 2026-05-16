/**
 * Cron wrapper for expert opinion auto-resolution.
 *
 * This script is a thin wrapper that invokes the same resolution logic as
 * auto-resolve-opinions.ts with production defaults suitable for daily runs:
 *   - LIMIT=100 (process up to 100 opinions per run to stay within rate limits)
 *   - RESOLUTION_WINDOW=30 (evaluate 30-day windows by default)
 *   - HIT_THRESHOLD=2 (2% move required for a HIT/MISS call)
 *
 * Deployment options:
 *   1. System cron (recommended):
 *      Add to crontab: `0 3 * * * cd /path/to/apps/api && npx tsx scripts/cron-auto-resolve.ts`
 *      (Runs daily at 03:00 UTC — after Asian market close and before US pre-market)
 *
 *   2. Next.js API route (see apps/api/app/api/cron/auto-resolve-opinions/route.ts):
 *      Protected by CRON_SECRET env var. Trigger via Vercel Cron or external scheduler.
 *
 * Usage:
 *   npx tsx scripts/cron-auto-resolve.ts
 */

// Set cron defaults before importing main script logic
// (don't override if caller has already set them)
if (!process.env.LIMIT) process.env.LIMIT = "100";
if (!process.env.RESOLUTION_WINDOW) process.env.RESOLUTION_WINDOW = "30";
if (!process.env.HIT_THRESHOLD) process.env.HIT_THRESHOLD = "2";

// Delegate to the full resolution script
import("./auto-resolve-opinions").catch((err) => {
  console.error("Cron auto-resolve failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
