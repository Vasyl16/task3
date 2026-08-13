import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  SellerProfileStatus,
  UserRole,
  type SellerProfile,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { SellersRepository } from './domain/sellers.repository';
import { ApplySellerDto } from './dto/apply-seller.dto';
import { ReviewSellerDto } from './dto/review-seller.dto';

@Injectable()
export class SellersService {
  constructor(
    private readonly sellersRepository: SellersRepository,
    private readonly usersService: UsersService,
    // Used only to open the transaction boundary in review() — the
    // SellerProfile status write and the User role write must commit
    // together or not at all.
    private readonly prisma: PrismaService,
  ) {}

  async findById(id: string): Promise<SellerProfile> {
    const profile = await this.sellersRepository.findById(id);
    if (!profile) {
      throw new NotFoundException(`SellerProfile ${id} not found`);
    }
    return profile;
  }

  findByUserId(userId: string): Promise<SellerProfile | null> {
    return this.sellersRepository.findByUserId(userId);
  }

  // Admin-only (enforced by @Roles(ADMIN) on AdminController) — the
  // seller-application moderation queue. Unfiltered it returns every
  // profile; `status: PENDING` is the queue of things awaiting a human.
  listApplications(filter: {
    status?: SellerProfileStatus;
  }): Promise<SellerProfile[]> {
    return this.sellersRepository.findMany(filter);
  }

  // The ownership-check primitive other modules (products, orders, ...)
  // use to resolve "does this caller have an approved seller identity,
  // and if so what is it" — never take a sellerId from the client and
  // trust it.
  async getOwnApprovedSellerProfileOrThrow(
    userId: string,
  ): Promise<SellerProfile> {
    const profile = await this.sellersRepository.findByUserId(userId);
    if (!profile || profile.status !== SellerProfileStatus.APPROVED) {
      throw new ForbiddenException(
        'No approved seller profile for this account',
      );
    }
    return profile;
  }

  async apply(userId: string, dto: ApplySellerDto): Promise<SellerProfile> {
    const existing = await this.sellersRepository.findByUserId(userId);
    if (existing) {
      throw new ConflictException(
        'A seller application already exists for this account',
      );
    }
    return this.sellersRepository.create({ userId, ...dto });
  }

  // Admin-only (enforced by @Roles(ADMIN) in the controller). Updates
  // SellerProfile.status and, when the status implies a role change,
  // User.role — atomically, so the two can never drift out of sync.
  async review(
    id: string,
    reviewerId: string,
    dto: ReviewSellerDto,
  ): Promise<SellerProfile> {
    const profile = await this.findById(id); // 404s if missing

    return this.prisma.$transaction(async (tx) => {
      const updated = await this.sellersRepository.updateStatus(
        tx,
        id,
        dto.status,
        reviewerId,
      );
      const nextRole =
        dto.status === SellerProfileStatus.APPROVED
          ? UserRole.SELLER
          : UserRole.CUSTOMER;
      await this.usersService.updateRole(tx, profile.userId, nextRole);
      return updated;
    });
  }
}
