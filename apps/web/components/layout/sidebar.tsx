"use client";

import Link from "next/link";
import type { Session } from "next-auth";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { Bell, Flag, Newspaper, PlusCircle, ShieldCheck, Trophy, User, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/**
 * Primary nav. Keep this list short — every item here competes for a new
 * user's attention on first login. Trending lives inside the feed view tabs,
 * so it does not need a top-level slot.
 */
const primaryLinks: NavItem[] = [
  { href: "/feed", label: "Feed", icon: Newspaper },
  { href: "/markets", label: "Markets", icon: Flag },
  { href: "/markets/create", label: "Create", icon: PlusCircle },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy }
];

const discoverLinks: NavItem[] = [{ href: "/groups", label: "Groups", icon: Users }];

export function Sidebar({ session }: { session: Session | null }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

  const isStaff = session?.user.role === "ADMIN" || session?.user.role === "MODERATOR";

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-white/50 bg-white/70 px-5 py-7 backdrop-blur lg:flex lg:flex-col">
      <Link href="/" className="mb-8 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink-900 text-sm font-semibold text-white">
          PF
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight text-ink-900">Predict Future</p>
          <p className="text-xs text-ink-500">News · predictions · rank</p>
        </div>
      </Link>

      <NavSection>
        {primaryLinks.map((link) => (
          <NavLink key={link.href} item={link} active={isActive(link.href)} />
        ))}
      </NavSection>

      <NavSection label="Discover">
        {discoverLinks.map((link) => (
          <NavLink key={link.href} item={link} active={isActive(link.href)} />
        ))}
      </NavSection>

      {session?.user && (
        <NavSection label="You" className="mt-auto">
          <NavLink
            item={{ href: `/profile/${session.user.username}`, label: "Profile", icon: User }}
            active={isActive("/profile")}
          />
          <NavLink
            item={{ href: "/notifications", label: "Notifications", icon: Bell }}
            active={isActive("/notifications")}
          />
          {isStaff && (
            <NavLink
              item={{ href: "/admin", label: "Admin", icon: ShieldCheck }}
              active={isActive("/admin")}
              trailing={
                <Badge variant="accent" className="ml-auto">
                  Staff
                </Badge>
              }
            />
          )}
        </NavSection>
      )}
    </aside>
  );
}

function NavSection({
  label,
  className,
  children
}: {
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1", label ? "mt-8" : "", className)}>
      {label && (
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-400">
          {label}
        </p>
      )}
      {children}
    </div>
  );
}

function NavLink({
  item,
  active,
  trailing
}: {
  item: NavItem;
  active: boolean;
  trailing?: React.ReactNode;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
        active
          ? "bg-ink-900 text-white"
          : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"
      )}
    >
      <Icon className="h-4 w-4" />
      {item.label}
      {trailing}
    </Link>
  );
}
