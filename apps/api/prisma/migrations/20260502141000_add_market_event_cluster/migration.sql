-- CreateTable
CREATE TABLE "MarketEventCluster" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "bannerEmoji" TEXT,
    "category" "MarketCategory" NOT NULL DEFAULT 'FINANCE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketEventCluster_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketEventCluster_slug_key" ON "MarketEventCluster"("slug");

-- AlterTable
ALTER TABLE "Market" ADD COLUMN "eventClusterId" TEXT;

-- CreateIndex
CREATE INDEX "Market_eventClusterId_status_idx" ON "Market"("eventClusterId", "status");

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_eventClusterId_fkey" FOREIGN KEY ("eventClusterId") REFERENCES "MarketEventCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
