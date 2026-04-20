import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();

  return <AppShell>{children}</AppShell>;
}
