import { clsx, type ClassValue } from "clsx";
import { format, formatDistanceToNowStrict } from "date-fns";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

export function formatPoints(points: number) {
  return new Intl.NumberFormat("en-IN").format(points);
}

export function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function formatNumericValue(value: number, options?: { unit?: string | null; precision?: number | null }) {
  const maximumFractionDigits =
    typeof options?.precision === "number" && options.precision >= 0 ? options.precision : 2;
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(value);

  return options?.unit ? `${formatted} ${options.unit}` : formatted;
}

export function formatDateTime(date: Date | string) {
  return format(new Date(date), "dd MMM yyyy, hh:mm a");
}

export function formatDateOnly(date: Date | string) {
  return format(new Date(date), "dd MMM yyyy");
}

/**
 * Formats an IST trading-session instant (stored as IST-midnight-in-UTC, e.g.
 * the 21 Jul session = 2026-07-20T18:30Z) as its IST calendar date. Pinned to
 * Asia/Kolkata so SSR on a UTC server can't shift it back a day — the trap
 * formatDateOnly (runtime-local tz) falls into for session dates.
 */
export function formatIstSessionDate(date: Date | string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(date));
}

export function formatRelativeTime(date: Date | string) {
  return `${formatDistanceToNowStrict(new Date(date), { addSuffix: true })}`;
}

/**
 * Returns a hex color tuned to opinion-call freshness:
 *   <  24h  → green   (#16a34a) — fresh, actionable
 *   <  72h  → gray    (#6b7280) — a few days old
 *   <  120h → amber   (#d97706) — getting stale
 *   ≥  120h → red-ish (#dc2626) — old call
 *
 * Used by the "Called X ago" timestamps on opinion cards / hero.
 */
export function freshnessColor(date: Date | string): string {
  const ms = Date.now() - new Date(date).getTime();
  const hours = ms / (1000 * 60 * 60);
  if (hours < 24) return "#16a34a";
  if (hours < 72) return "#6b7280";
  if (hours < 120) return "#d97706";
  return "#b91c1c";
}

/**
 * Instrument Page v2 — Indian crore/lakh-compact currency display for raw
 * INR figures (Yahoo fundamentals-timeseries `reportedValue.raw` values are
 * plain rupees, NOT pre-scaled to lakhs/crores — see apps/web/lib/finance/
 * fundamentals.ts's doc comment for the RELIANCE sanity check that
 * confirmed this). Thresholds match Indian financial-media convention:
 *   - |value| >= 1,00,00,00,00,000 (1e12, i.e. >= 1 lakh crore) -> "X.XX L Cr"
 *     (this is the "₹10.57 lakh crore" style headline figure Indian business
 *     press uses for large-cap revenue/market-cap numbers, rather than a
 *     visually noisy "₹10,57,190 Cr").
 *   - |value| >= 1,00,00,000 (1e7, i.e. >= 1 crore) -> "X.XX Cr"
 *   - |value| >= 1,00,000 (1e5, i.e. >= 1 lakh) -> "X.XX L"
 *   - else -> plain "en-IN" grouped rupees (for per-share figures like EPS
 *     and dividend amount, which are single/double-digit rupees and would
 *     be nonsensical in lakh/crore terms).
 * Does NOT include the ₹ sign — callers prefix it, matching quote-header.tsx's
 * existing convention of composing the symbol at the call site.
 */
export function formatCompactINR(value: number, options?: { precision?: number }): string {
  const precision = options?.precision ?? 2;
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  const grouped = (scaled: number) =>
    scaled.toLocaleString("en-IN", { minimumFractionDigits: precision, maximumFractionDigits: precision });

  if (abs >= 1e12) {
    return `${sign}${grouped(abs / 1e12)} L Cr`;
  }
  if (abs >= 1e7) {
    return `${sign}${grouped(abs / 1e7)} Cr`;
  }
  if (abs >= 1e5) {
    return `${sign}${grouped(abs / 1e5)} L`;
  }
  return `${sign}${abs.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: precision })}`;
}

export function safeJsonParse<T>(value: string, fallback: T) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
