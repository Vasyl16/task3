import type {
  Prisma,
  SellerProfile,
  SellerProfileStatus,
} from '@prisma/client';

export abstract class SellersRepository {
  abstract findById(id: string): Promise<SellerProfile | null>;
  abstract findByUserId(userId: string): Promise<SellerProfile | null>;
  abstract create(data: {
    userId: string;
    businessName: string;
    description?: string;
  }): Promise<SellerProfile>;
  // Takes the caller's transaction client — SellerProfile.status and
  // User.role must change atomically (see SellersService.review).
  abstract updateStatus(
    tx: Prisma.TransactionClient,
    id: string,
    status: SellerProfileStatus,
    reviewedByUserId: string,
  ): Promise<SellerProfile>;
}
