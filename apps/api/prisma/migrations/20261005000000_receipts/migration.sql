CREATE TABLE "ReceiptScan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "store" TEXT,
    "purchasedAt" TIMESTAMP(3),
    "itemCount" INTEGER NOT NULL,
    "flaggedCount" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "watched" BOOLEAN NOT NULL DEFAULT false,
    "decodedByAi" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReceiptScan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReceiptScan_userId_createdAt_idx" ON "ReceiptScan"("userId", "createdAt" DESC);
ALTER TABLE "ReceiptScan" ADD CONSTRAINT "ReceiptScan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
