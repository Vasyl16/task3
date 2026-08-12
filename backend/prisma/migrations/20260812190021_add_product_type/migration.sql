-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('FIXED_PRICE', 'AUCTION');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "type" "ProductType" NOT NULL DEFAULT 'FIXED_PRICE';
