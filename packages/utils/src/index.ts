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

export function safeJsonParse<T>(value: string, fallback: T) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
