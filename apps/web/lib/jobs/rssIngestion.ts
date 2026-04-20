import { RSSIngestionService, type NewsIngestionResult } from "@/lib/news/rss-ingestion-service";

export type { NewsIngestionResult };

export async function runRssIngestionJob(actorId?: string): Promise<NewsIngestionResult> {
  return RSSIngestionService.run(actorId);
}
