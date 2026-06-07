-- S56: REQUEST_TO_JOIN — third visibility tier + GroupJoinRequest model
--
-- Migration safety:
--   - Adding a new enum value to GroupVisibility is additive; no existing rows change.
--   - GroupJoinRequestStatus is a new enum; no existing data affected.
--   - GroupJoinRequest is a new table; additive only.
--   - All operations are fully reversible by dropping the new table/enum values.

-- 1. Add REQUEST_TO_JOIN to the GroupVisibility enum
ALTER TYPE "GroupVisibility" ADD VALUE 'REQUEST_TO_JOIN';

-- 2. Create the GroupJoinRequestStatus enum
CREATE TYPE "GroupJoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- 3. Create the GroupJoinRequest table
CREATE TABLE "GroupJoinRequest" (
  "id"           TEXT NOT NULL,
  "groupId"      TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "status"       "GroupJoinRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requestedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt"    TIMESTAMP(3),
  "decidedById"  TEXT,
  "decisionNote" TEXT,

  CONSTRAINT "GroupJoinRequest_pkey" PRIMARY KEY ("id")
);

-- 4. Foreign keys
ALTER TABLE "GroupJoinRequest"
  ADD CONSTRAINT "GroupJoinRequest_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupJoinRequest"
  ADD CONSTRAINT "GroupJoinRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupJoinRequest"
  ADD CONSTRAINT "GroupJoinRequest_decidedById_fkey"
    FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Unique constraint: at most one PENDING request per (groupId, userId)
--    The status column is included so REJECTED rows do not block a new PENDING request.
CREATE UNIQUE INDEX "GroupJoinRequest_groupId_userId_status_key"
  ON "GroupJoinRequest" ("groupId", "userId", "status");

-- 6. Index for the admin inbox query: filter PENDING by group efficiently
CREATE INDEX "GroupJoinRequest_groupId_status_idx"
  ON "GroupJoinRequest" ("groupId", "status");
