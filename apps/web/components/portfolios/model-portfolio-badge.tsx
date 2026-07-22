import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Standing USER DECISION for Portfolios (P3): no legal sign-off gate on
 * creating/viewing a model portfolio, but EVERY portfolio surface must carry
 * this exact warning, prominently — directory cards, the public detail page,
 * the create form, and the manage dashboard. Do not paraphrase the copy.
 */
export function ModelPortfolioBadge({ className }: { className?: string }) {
  return (
    <Badge variant="warning" className={cn("gap-1.5 whitespace-normal text-left", className)}>
      <AlertTriangle className="h-3 w-3 shrink-0" />
      Model portfolio — hypothetical. Not investment advice.
    </Badge>
  );
}
