"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

import { Button } from "@/components/ui/button";

export function UserMenu() {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => signOut({ callbackUrl: "/" })}
      className="text-ink-500"
    >
      <LogOut className="h-4 w-4" />
      Sign out
    </Button>
  );
}
