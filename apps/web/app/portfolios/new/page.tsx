import type { Metadata } from "next";

import { CreatePortfolioForm } from "@/components/portfolios/create-portfolio-form";
import { ModelPortfolioBadge } from "@/components/portfolios/model-portfolio-badge";

// Signed-in personal utility page — never indexed.
export const metadata: Metadata = {
  title: "Create a Model Portfolio — Predict Future",
  robots: { index: false, follow: false }
};

export default function NewPortfolioPage() {
  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <ModelPortfolioBadge />
      <CreatePortfolioForm />
    </div>
  );
}
