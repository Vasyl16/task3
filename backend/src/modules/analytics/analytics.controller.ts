import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import { Roles } from '../../core/auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { SellersService } from '../sellers/sellers.service';
import { AnalyticsService } from './analytics.service';
import { AnalyticsPeriodQuery } from './dto/analytics-period.query';

// Seller-facing analytics only. Platform-wide figures and exports live on
// AdminController, behind @Roles(ADMIN).
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly sellersService: SellersService,
  ) {}

  // There is deliberately no `GET /analytics/sellers/:sellerId` — a
  // seller's own id is resolved from their authenticated identity, so
  // there is no path parameter to swap for someone else's and no
  // ownership check that could be forgotten. This is the same pattern
  // ProductsService.create uses for sellerId.
  @Roles(UserRole.SELLER)
  @Get('me/seller')
  async getMySellerReport(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AnalyticsPeriodQuery,
  ) {
    const profile =
      await this.sellersService.getOwnApprovedSellerProfileOrThrow(user.id);
    return this.analyticsService.getSellerReport(profile.id, query);
  }
}
