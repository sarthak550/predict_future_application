-- M5: Partial unique index for host-level WalletTransaction rows.
--
-- Background: the existing unique constraints
--   @@unique([walletId, marketId, type, positionId])
--   @@unique([walletId, marketId, type, multiChoicePositionId])
-- protect per-position payouts (MARKET_WIN / MARKET_REFUND) from being
-- inserted twice. They cannot protect host-level rows like HOST_BOND_LOCK,
-- HOST_BOND_RELEASE, HOST_BOND_FORFEIT, HOST_BOND_COMPENSATION,
-- HOST_COMMISSION, HOST_REWARD — those rows have NULL positionId and NULL
-- multiChoicePositionId, and Postgres treats NULL as distinct in standard
-- unique indexes, so duplicates would be allowed if the application's
-- check-then-insert (createUniqueWalletTransaction) lost a race.
--
-- Fix: add a partial unique index covering only the host-level types. Each
-- host action can fire at most once per (walletId, marketId, type), which
-- matches the business model — there's only one "lock the bond" event,
-- one "release the bond" event, etc. per market per host.

CREATE UNIQUE INDEX IF NOT EXISTS "WalletTransaction_host_market_type_uniq"
  ON "WalletTransaction" ("walletId", "marketId", "type")
  WHERE "type" IN (
    'HOST_BOND_LOCK',
    'HOST_BOND_RELEASE',
    'HOST_BOND_FORFEIT',
    'HOST_BOND_COMPENSATION',
    'HOST_COMMISSION',
    'HOST_REWARD'
  );
