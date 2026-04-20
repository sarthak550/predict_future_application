import { NextResponse } from "next/server";

import { getNewsDebugSnapshot } from "@/lib/news/queries";
import { getRssSources } from "@/lib/news/rssSources";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getNewsDebugSnapshot();
  const configuredFeeds = getRssSources().map((feed) => ({
    id: feed.id,
    name: feed.name,
    url: feed.url,
    category: feed.categoryHint,
    isActive: feed.isActive !== false
  }));

  return NextResponse.json({
    ...snapshot,
    configuredFeeds
  });
}
