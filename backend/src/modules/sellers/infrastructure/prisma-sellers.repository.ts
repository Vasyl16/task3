import { Injectable } from '@nestjs/common';
import type {
  Prisma,
  SellerProfile,
  SellerProfileStatus,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SellersRepository } from '../domain/sellers.repository';

@Injectable()
export class PrismaSellersRepository implements SellersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<SellerProfile | null> {
    return this.prisma.sellerProfile.findUnique({ where: { id } });
  }

  findByUserId(userId: string): Promise<SellerProfile | null> {
    return this.prisma.sellerProfile.findUnique({ where: { userId } });
  }

  create(data: {
    userId: string;
    businessName: string;
    description?: string;
  }): Promise<SellerProfile> {
    return this.prisma.sellerProfile.create({ data });
  }

  updateStatus(
    tx: Prisma.TransactionClient,
    id: string,
    status: SellerProfileStatus,
    reviewedByUserId: string,
  ): Promise<SellerProfile> {
    return tx.sellerProfile.update({
      where: { id },
      data: { status, reviewedByUserId, reviewedAt: new Date() },
    });
  }
}
