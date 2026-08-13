-- AlterTable
ALTER TABLE "Auction" ALTER COLUMN "minBidIncrement" DROP DEFAULT;

-- AlterTable
ALTER TABLE "OutboxEvent" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "moderatedAt" TIMESTAMP(3),
ADD COLUMN     "moderatedByUserId" TEXT,
ADD COLUMN     "moderationNote" TEXT;

-- CreateTable
CREATE TABLE "CartSession" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId" TEXT,
    "convertedAt" TIMESTAMP(3),

    CONSTRAINT "CartSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CartSession_cartId_convertedAt_idx" ON "CartSession"("cartId", "convertedAt");

-- CreateIndex
CREATE INDEX "CartSession_startedAt_idx" ON "CartSession"("startedAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_type_createdAt_idx" ON "LedgerEntry"("type", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_sellerId_createdAt_idx" ON "LedgerEntry"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_placedAt_idx" ON "Order"("placedAt");

-- CreateIndex
CREATE INDEX "SellerOrder_createdAt_idx" ON "SellerOrder"("createdAt");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_moderatedByUserId_fkey" FOREIGN KEY ("moderatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartSession" ADD CONSTRAINT "CartSession_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
