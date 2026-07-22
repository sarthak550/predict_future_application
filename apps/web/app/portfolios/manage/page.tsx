import type { Metadata } from "next";

import { ManageDashboard } from "@/components/portfolios/manage-dashboard";

// Signed-in personal utility page — never indexed.
export const metadata: Metadata = {
  title: "My Portfolios — Predict Future",
  robots: { index: false, follow: false }
};

export default function ManagePortfoliosPage() {
  return <ManageDashboard />;
}
