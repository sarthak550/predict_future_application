import type { MarketCategory } from "@prisma/client";
import { ArrowUpRight, Clock3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { marketCategoryLabels } from "@/lib/constants";
import { formatRelativeTime } from "@/lib/utils";

export type PlainNewsCard = {
  id: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  imageUrl: string | null;
  category: MarketCategory;
  publishedAt: string;
};

export function NewsFallbackList({
  items,
  heading = "Latest RSS stories",
  description = "The live RSS ingestion pipeline is bringing in fresh stories even when prediction attachment is still in progress."
}: {
  items: PlainNewsCard[];
  heading?: string;
  description?: string;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-[24px] border border-dashed border-ink-200 bg-white/80 p-5">
        <p className="text-sm font-medium text-ink-900">{heading}</p>
        <p className="mt-2 text-sm leading-7 text-ink-500">{description}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {items.map((item) => (
          <Card key={item.id} className="overflow-hidden rounded-[28px] border border-white/70 bg-white/90 shadow-[0_12px_40px_rgba(15,23,42,0.08)]">
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="accent">{marketCategoryLabels[item.category]}</Badge>
                <Badge>{formatRelativeTime(item.publishedAt)}</Badge>
              </div>
              <div className="space-y-3">
                <h3 className="text-xl font-semibold leading-tight text-ink-900">{item.title}</h3>
                <p className="text-sm leading-7 text-ink-600">{item.summary}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-ink-500">
                <span className="font-medium text-ink-800">Source: {item.sourceName}</span>
                <span className="inline-flex items-center gap-1">
                  <Clock3 className="h-4 w-4" />
                  {formatRelativeTime(item.publishedAt)}
                </span>
              </div>
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-2xl border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700 transition hover:border-signal-sky hover:text-signal-sky"
              >
                Read source
                <ArrowUpRight className="h-4 w-4" />
              </a>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
