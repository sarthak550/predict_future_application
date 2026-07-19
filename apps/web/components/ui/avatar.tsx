import { cn } from "@/lib/utils";

export function Avatar({
  name,
  src,
  className
}: {
  name: string;
  /** Optional image URL (e.g. Expert.avatarUrl). Falls back to initials when absent. */
  src?: string | null;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase())
    .join("");

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatarUrl is arbitrary
      // external https URLs (see app/api/admin/experts/[id]/verify/route.ts), not one
      // of our own optimizable assets, so next/image's domain allow-list doesn't help here.
      <img
        src={src}
        alt={name}
        className={cn("h-10 w-10 rounded-2xl object-cover", className)}
      />
    );
  }

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
