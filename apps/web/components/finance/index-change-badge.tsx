/**
 * All-Indices informational layer — shared level/change formatters and a
 * small colored "+0.43%" chip, reused by both the /indices directory rows
 * and the /indices/[slug] detail header. Index levels are points, not
 * rupees (unlike stock prices elsewhere in this app) — no ₹ prefix.
 */
import { TrendingDown, TrendingUp } from "lucide-react";

export function formatIndexLevel(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function formatSignedPoints(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function IndexChangeBadge({ changePercent, size = "sm" }: { changePercent: number | null; size?: "sm" | "lg" }) {
  if (changePercent == null) {
    return <span className="text-sm text-ink-400">—</span>;
  }
  const isUp = changePercent >= 0;
  const Icon = isUp ? TrendingUp : TrendingDown;
  const toneClass = isUp ? "text-emerald-600" : "text-rose-600";
  const textSize = size === "lg" ? "text-base" : "text-sm";

  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${textSize} ${toneClass}`}>
      <Icon className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} />
      {isUp ? "+" : ""}
      {changePercent.toFixed(2)}%
    </span>
  );
}
