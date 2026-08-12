-- Rename BUYER -> CUSTOMER and add SELLER to UserRole.
-- Table is empty at this point (no User rows), so this is a clean rename,
-- not a data migration. Uses native Postgres enum ALTER, not Prisma's
-- drop-and-recreate approach, since it's simpler and equally safe here.
ALTER TYPE "UserRole" RENAME VALUE 'BUYER' TO 'CUSTOMER';
ALTER TYPE "UserRole" ADD VALUE 'SELLER';

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
