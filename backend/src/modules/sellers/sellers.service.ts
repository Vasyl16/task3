import { Injectable, NotFoundException } from '@nestjs/common';
import type { SellerProfile } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { SellersRepository } from './domain/sellers.repository';
import { ApplySellerDto } from './dto/apply-seller.dto';
import { ReviewSellerDto } from './dto/review-seller.dto';

@Injectable()
export class SellersService {
  constructor(
    private readonly sellersRepository: SellersRepository,
    private readonly usersService: UsersService,
  ) {}

  async findById(id: string): Promise<SellerProfile> {
    const profile = await this.sellersRepository.findById(id);
    if (!profile) {
      throw new NotFoundException(`SellerProfile ${id} not found`);
    }
    return profile;
  }

  async apply(dto: ApplySellerDto): Promise<SellerProfile> {
    await this.usersService.findById(dto.userId); // 404s if missing
    return this.sellersRepository.create(dto);
  }

  async review(id: string, dto: ReviewSellerDto): Promise<SellerProfile> {
    await this.findById(id); // 404s if missing
    return this.sellersRepository.updateStatus(
      id,
      dto.status,
      dto.reviewedByUserId,
    );
  }
}
