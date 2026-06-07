-- S59: Group Moderation Audit + User notification default + Group isFeatured + AdminActionType.FEATURE_GROUP
--
-- Three additive schema changes in a single migration (serialize_schema_writes rule):
--   1. GroupModerationActionType enum + GroupModerationAction model
--   2. User.defaultGroupNotificationLevel field
--   3. Group.isFeatured field + index
--   4. AdminActionType.FEATURE_GROUP enum value

-- 1a. New enum: GroupModerationActionType
CREATE TYPE "GroupModerationActionType" AS ENUM (
  'MEMBER_BANNED',
  'MEMBER_UNBANNED',
  'MEMBER_REMOVED',
  'MEMBER_LEFT',
  'OWNERSHIP_TRANSFERRED',
  'GROUP_ARCHIVED',
  'JOIN_REQUEST_APPROVED',
  'JOIN_REQUEST_REJECTED'
);

-- 1b. New table: GroupModerationAction
CREATE TABLE "GroupModerationAction" (
  "id"           TEXT NOT NULL,
  "groupId"      TEXT NOT NULL,
  "actorId"      TEXT NOT NULL,
  "targetUserId" TEXT,
  "actionType"   "GroupModerationActionType" NOT NULL,
  "metadata"     JSONB,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GroupModerationAction_pkey" PRIMARY KEY ("id")
);

-- 1c. Foreign keys for GroupModerationAction
ALTER TABLE "GroupModerationAction"
  ADD CONSTRAINT "GroupModerationAction_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupModerationAction"
  ADD CONSTRAINT "GroupModerationAction_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupModerationAction"
  ADD CONSTRAINT "GroupModerationAction_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 1d. Indexes for GroupModerationAction
CREATE INDEX "GroupModerationAction_groupId_createdAt_idx" ON "GroupModerationAction"("groupId", "createdAt");
CREATE INDEX "GroupModerationAction_actorId_idx" ON "GroupModerationAction"("actorId");

-- 2. Add User.defaultGroupNotificationLevel (defaults to ALL — no backfill needed)
ALTER TABLE "User"
  ADD COLUMN "defaultGroupNotificationLevel" "GroupNotifLevel" NOT NULL DEFAULT 'ALL';

-- 3a. Add Group.isFeatured
ALTER TABLE "Group"
  ADD COLUMN "isFeatured" BOOLEAN NOT NULL DEFAULT false;

-- 3b. Index for isFeatured discover sort
CREATE INDEX "Group_isFeatured_createdAt_idx" ON "Group"("isFeatured", "createdAt");

-- 4. Extend AdminActionType enum with FEATURE_GROUP
ALTER TYPE "AdminActionType" ADD VALUE 'FEATURE_GROUP';
