import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import { Public } from '../../core/auth/decorators/public.decorator';
import { Roles } from '../../core/auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { SellersService } from './sellers.service';
import { ApplySellerDto } from './dto/apply-seller.dto';
import { ReviewSellerDto } from './dto/review-seller.dto';

@Controller('sellers')
export class SellersController {
  constructor(private readonly sellersService: SellersService) {}

  @Public()
  @Get(':id')
  findById(@Param('id') id: string) {
    return this.sellersService.findById(id);
  }

  @Get('me/profile')
  findMyProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.sellersService.findByUserId(user.id);
  }

  // Any authenticated CUSTOMER can apply; the applicant is always the
  // caller — never a client-supplied userId (IDOR prevention).
  @Roles(UserRole.CUSTOMER)
  @Post('apply')
  apply(@CurrentUser() user: AuthenticatedUser, @Body() dto: ApplySellerDto) {
    return this.sellersService.apply(user.id, dto);
  }

  // Admin-only. The reviewer is always the caller — never a
  // client-supplied reviewedByUserId.
  @Roles(UserRole.ADMIN)
  @Patch(':id/review')
  review(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReviewSellerDto,
  ) {
    return this.sellersService.review(id, user.id, dto);
  }
}
