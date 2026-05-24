-- S42-T14(c): BigCallTap FK relations — User and Market with CASCADE on delete
-- Prevents orphaned BigCallTap rows when a User or Market is deleted.
-- Runs AFTER 20260524000007_s42_admin_action_types (Bundle B) as required by sprint instructions.

-- Add FK constraint from BigCallTap.userId → User.id (CASCADE on delete)
ALTER TABLE "BigCallTap"
  ADD CONSTRAINT "BigCallTap_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add FK constraint from BigCallTap.marketId → Market.id (CASCADE on delete)
ALTER TABLE "BigCallTap"
  ADD CONSTRAINT "BigCallTap_marketId_fkey"
  FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;
