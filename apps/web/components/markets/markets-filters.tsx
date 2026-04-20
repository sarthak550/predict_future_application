import Link from "next/link";
import { MarketCategory } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { marketCategoryLabels, marketStatusLabels, marketStatusOptions } from "@/lib/constants";

type MarketFiltersProps = {
  current: {
    q?: string;
    category?: string;
    status?: string;
    sort?: string;
    featured?: string;
  };
  canSeeInternal: boolean;
};

export function MarketsFilters({ current, canSeeInternal }: MarketFiltersProps) {
  const visibleStatusOptions = canSeeInternal
    ? marketStatusOptions
    : marketStatusOptions.filter((status) => status !== "DRAFT" && status !== "REJECTED");

  return (
    <form className="grid gap-4 rounded-[28px] border border-white/70 bg-white/80 p-5 lg:grid-cols-[1.5fr_1fr_1fr_1fr_auto]">
      <Input name="q" defaultValue={current.q} placeholder="Search markets, events, or creators" />
      <Select name="category" defaultValue={current.category ?? ""}>
        <option value="">All categories</option>
        {Object.values(MarketCategory).map((category) => (
          <option key={category} value={category}>
            {marketCategoryLabels[category]}
          </option>
        ))}
      </Select>
      <Select name="status" defaultValue={current.status ?? ""}>
        <option value="">All statuses</option>
        {visibleStatusOptions.map((status) => (
          <option key={status} value={status}>
            {marketStatusLabels[status]}
          </option>
        ))}
      </Select>
      <Select name="sort" defaultValue={current.sort ?? "trending"}>
        <option value="trending">Sort: Trending</option>
        <option value="new">Sort: Newest</option>
        <option value="closing">Sort: Closing soon</option>
        <option value="featured">Sort: Featured first</option>
      </Select>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 rounded-2xl border border-ink-200 px-3 py-2 text-sm text-ink-600">
          <input
            type="checkbox"
            name="featured"
            value="true"
            defaultChecked={current.featured === "true"}
            className="h-4 w-4 rounded border-ink-300"
          />
          Featured
        </label>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
        <Link href="/markets">
          <Button type="button" variant="ghost">
            Reset
          </Button>
        </Link>
      </div>
    </form>
  );
}
