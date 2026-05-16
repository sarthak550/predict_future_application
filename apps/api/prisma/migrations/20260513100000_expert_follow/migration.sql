-- CreateTable
CREATE TABLE "ExpertFollow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpertFollow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpertFollow_userId_createdAt_idx" ON "ExpertFollow"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExpertFollow_userId_expertId_key" ON "ExpertFollow"("userId", "expertId");

-- AddForeignKey
ALTER TABLE "ExpertFollow" ADD CONSTRAINT "ExpertFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertFollow" ADD CONSTRAINT "ExpertFollow_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "Expert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
