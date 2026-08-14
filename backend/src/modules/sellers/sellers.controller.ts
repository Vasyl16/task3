import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import { Public } from '../../core/auth/decorators/public.decorator';
import { Roles } from '../../core/auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { SellersService } from './sellers.service';
import { ApplySellerDto } from './dto/apply-seller.dto';
import { ReviewSellerDto } from './dto/review-seller.dto';
import { ApiTags } from '@nestjs/swagger';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiAuth } from '../../core/openapi/api-auth.decorator';

@ApiTags('sellers')
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
  @ApiAuth(UserRole.CUSTOMER)
  @ApiOperation({
    summary: 'Apply to become a seller',
    description:
      'The applicant is the authenticated caller \u2014 ApplySellerDto has no ' +
      'userId field. Creates a PENDING profile; an admin must approve it ' +
      'before the account gains the SELLER role.',
  })
  @ApiResponse({
    status: 409,
    description: 'This account already has an application.',
  })
  apply(@CurrentUser() user: AuthenticatedUser, @Body() dto: ApplySellerDto) {
    return this.sellersService.apply(user.id, dto);
  }

  // Admin-only. The reviewer is always the caller — never a
  // client-supplied reviewedByUserId.
  @Roles(UserRole.ADMIN)
  @Patch(':id/review')
  @ApiAuth(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Approve or reject an application (ADMIN)',
    description:
      'Updates the profile status and the user\u2019s role in ONE transaction, ' +
      'so the two can never drift apart. Note that an already-issued ' +
      'access token keeps its old role claim until it expires.',
  })
  review(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReviewSellerDto,
  ) {
    return this.sellersService.review(id, user.id, dto);
  }
}
