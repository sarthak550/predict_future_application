import Link from "next/link";
import type { MarketCategory } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { marketCategoryLabels, primaryNewsCategories } from "@/lib/constants";

export function CategoryTabs({
  currentCategory,
  currentView
}: {
  currentCategory?: MarketCategory;
  currentView: string;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      <Link href={currentView === "for-you" ? "/feed" : `/feed?view=${currentView}`} className="shrink-0">
        <Badge variant={!currentCategory ? "accent" : "default"}>All</Badge>
      </Link>
      {primaryNewsCategories.map((category) => {
        const href =
          currentView === "for-you"
            ? `/feed/${category.toLowerCase()}`
            : `/feed/${category.toLowerCase()}?view=${currentView}`;

        return (
          <Link key={category} href={href} className="shrink-0">
            <Badge variant={currentCategory === category ? "accent" : "default"}>
              {marketCategoryLabels[category]}
            </Badge>
          </Link>
        );
      })}
    </div>
  );
}
