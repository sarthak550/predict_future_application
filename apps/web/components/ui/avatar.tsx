import { cn } from "@/lib/utils";

export function Avatar({
  name,
  className
}: {
  name: string;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase())
    .join("");

  return (
    <div
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-signal-sky to-signal-teal text-sm font-semibold text-white",
        className
      )}
    >
      {initials}
    </div>
  );
}
