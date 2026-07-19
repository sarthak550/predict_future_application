Superseded market-detail page (param `marketId`), kept out of routing (underscore
prefix = ignored by Next). The May-2026 `[id]/page.tsx` is the live market page;
having both `[id]` and `[marketId]` at the same path level broke `next build`
("You cannot use different slug names for the same dynamic path"). Restore by
renaming back if anything from the old page is needed.
