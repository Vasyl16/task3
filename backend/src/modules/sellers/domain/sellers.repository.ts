import type { SellerProfile, SellerProfileStatus } from '@prisma/client';

export abstract class SellersRepository {
  abstract findById(id: string): Promise<SellerProfile | null>;
  abstract findByUserId(userId: string): Promise<SellerProfile | null>;
  abstract create(data: {
    userId: string;
    businessName: string;
    description?: string;
  }): Promise<SellerProfile>;
  abstract updateStatus(
    id: string,
    status: SellerProfileStatus,
    reviewedByUserId: string,
  ): Promise<SellerProfile>;
}
