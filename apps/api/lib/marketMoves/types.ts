import type { MarketMoveEventType } from "@prisma/client";

/** Normalized shape both fetchers (nse.ts, bse.ts) produce for an announcement. */
export type FetchedMarketMoveEvent = {
  source: "NSE" | "BSE";
  sourceId: string;
  tickerSymbol: string;
  tickerType: "STOCK" | "INDEX";
  companyName: string;
  eventType: MarketMoveEventType;
  headline: string;
  detailUrl: string | null;
  rawText: string | null;
  announcedAt: Date;
};

/** Normalized shape the movers fetcher (nse.ts) produces for one mover row. */
export type FetchedMarketMover = {
  tickerSymbol: string;
  companyName: string;
  changePercent: number;
  changeAbs: number;
  volume: number;
  direction: "GAINER" | "LOSER";
};
