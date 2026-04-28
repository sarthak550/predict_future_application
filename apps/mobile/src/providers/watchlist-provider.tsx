import React, { createContext, useCallback, useContext, useState } from "react";

import type { AppMarketStatus } from "@predict-future/types";

export type WatchlistItem = {
  id: string;
  title: string;
  status: AppMarketStatus;
  addedAt: number;
};

type WatchlistContextType = {
  items: WatchlistItem[];
  add: (item: Omit<WatchlistItem, "addedAt">) => void;
  remove: (id: string) => void;
  has: (id: string) => boolean;
  clear: () => void;
};

const WatchlistContext = createContext<WatchlistContextType | null>(null);

export function WatchlistProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<WatchlistItem[]>([]);

  const add = useCallback((item: Omit<WatchlistItem, "addedAt">) => {
    setItems((prev) => {
      if (prev.some((i) => i.id === item.id)) return prev;
      return [{ ...item, addedAt: Date.now() }, ...prev];
    });
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const has = useCallback(
    (id: string) => items.some((i) => i.id === id),
    [items]
  );

  const clear = useCallback(() => setItems([]), []);

  return (
    <WatchlistContext.Provider value={{ items, add, remove, has, clear }}>
      {children}
    </WatchlistContext.Provider>
  );
}

export function useWatchlist(): WatchlistContextType {
  const ctx = useContext(WatchlistContext);
  if (!ctx) throw new Error("useWatchlist must be used inside WatchlistProvider");
  return ctx;
}
