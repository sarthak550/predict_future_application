-- S58: GroupNotificationPreference model + GroupNotifLevel enum
-- Additive only. No backfill. Absence of a row = ALL (handled in query layer).

-- 1. Create the enum
CREATE TYPE "GroupNotifLevel" AS ENUM ('ALL', 'MENTIONS_ONLY', 'NONE');

-- 2. Create the model
CREATE TABLE "GroupNotificationPreference" (
    "id"        TEXT NOT NULL,
    "groupId"   TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "level"     "GroupNotifLevel" NOT NULL DEFAULT 'ALL',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupNotificationPreference_pkey" PRIMARY KEY ("id")
);

-- 3. Indexes
CREATE UNIQUE INDEX "GroupNotificationPreference_groupId_userId_key"
    ON "GroupNotificationPreference"("groupId", "userId");

CREATE INDEX "GroupNotificationPreference_userId_idx"
    ON "GroupNotificationPreference"("userId");

-- 4. Foreign keys
ALTER TABLE "GroupNotificationPreference"
    ADD CONSTRAINT "GroupNotificationPreference_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupNotificationPreference"
    ADD CONSTRAINT "GroupNotificationPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
