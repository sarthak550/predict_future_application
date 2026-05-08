-- CreateTable: Follow join table for user social graph (S24-T2)
CREATE TABLE "Follow" (
    "id" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "followeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique constraint to prevent duplicate follows
CREATE UNIQUE INDEX "Follow_followerId_followeeId_key" ON "Follow"("followerId", "followeeId");

-- CreateIndex: for listing who a user follows, sorted by recency
CREATE INDEX "Follow_followerId_createdAt_idx" ON "Follow"("followerId", "createdAt");

-- CreateIndex: for listing a user's followers, sorted by recency
CREATE INDEX "Follow_followeeId_createdAt_idx" ON "Follow"("followeeId", "createdAt");

-- AddForeignKey: follower -> User (cascade delete when user is deleted)
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey"
    FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: followee -> User (cascade delete when user is deleted)
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followeeId_fkey"
    FOREIGN KEY ("followeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
