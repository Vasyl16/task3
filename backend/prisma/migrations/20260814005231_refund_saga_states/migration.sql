-- AlterEnum
ALTER TYPE "RefundStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "gatewayRef" TEXT,
ALTER COLUMN "requestedById" DROP NOT NULL;

