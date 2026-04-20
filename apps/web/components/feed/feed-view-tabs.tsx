import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { mainFeedViews } from "@/lib/constants";

export function FeedViewTabs({
  currentView,
  categoryPath
}: {
  currentView: string;
  categoryPath?: string;
}) {
  const basePath = categoryPath ? `/feed/${categoryPath}` : "/feed";

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {mainFeedViews.map((view) => (
        <Link
          key={view.key}
          href={view.key === "for-you" ? basePath : `${basePath}?view=${view.key}`}
          className="shrink-0"
        >
          <Badge variant={currentView === view.key ? "accent" : "default"}>{view.label}</Badge>
        </Link>
      ))}
    </div>
  );
}
