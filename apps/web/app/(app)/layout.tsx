import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
