-- OrderStatus: rename to the new aggregate-status vocabulary, add the
-- two new intermediate states. Order has zero rows today (checkout was
-- unimplemented until now), so no data migration is needed.
ALTER TYPE "OrderStatus" RENAME VALUE 'PENDING' TO 'NEW';
ALTER TYPE "OrderStatus" RENAME VALUE 'PARTIALLY_FULFILLED' TO 'PARTIALLY_SHIPPED';
ALTER TYPE "OrderStatus" RENAME VALUE 'FULFILLED' TO 'COMPLETED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'SHIPPED';
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'NEW';

-- SellerOrderStatus: rename to the new lifecycle vocabulary. REFUNDED is
-- intentionally left in place rather than dropped — Postgres enums can't
-- remove a value, and application logic simply never sets it anymore (a
-- refund is tracked via the Refund model instead).
ALTER TYPE "SellerOrderStatus" RENAME VALUE 'PENDING' TO 'NEW';
ALTER TYPE "SellerOrderStatus" RENAME VALUE 'CONFIRMED' TO 'PROCESSING';
ALTER TYPE "SellerOrderStatus" RENAME VALUE 'DELIVERED' TO 'COMPLETED';
ALTER TABLE "SellerOrder" ALTER COLUMN "status" SET DEFAULT 'NEW';

-- Auction: bid increment configuration + winner checkout window.
ALTER TABLE "Auction" ADD COLUMN "minBidIncrement" DECIMAL(12,2) NOT NULL DEFAULT 1.00;
ALTER TABLE "Auction" ADD COLUMN "checkoutDeadline" TIMESTAMP(3);
ALTER TYPE "AuctionStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "AuctionStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
