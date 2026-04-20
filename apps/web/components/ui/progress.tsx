import { cn } from "@/lib/utils";

export function Progress({
  value,
  className
}: {
  value: number;
  className?: string;
}) {
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-ink-100", className)}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-signal-teal via-signal-sky to-signal-amber transition-all"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
