import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import { Roles } from '../../core/auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { AnalyticsService } from '../analytics/analytics.service';
import { AnalyticsPeriodQuery } from '../analytics/dto/analytics-period.query';
import { ExportQuery } from '../analytics/dto/export.query';
import { DisputesService } from '../disputes/disputes.service';
import { ResolveDisputeDto } from '../disputes/dto/resolve-dispute.dto';
import { ProductsService } from '../products/products.service';
import { ModerateProductDto } from '../products/dto/moderate-product.dto';
import { SellersService } from '../sellers/sellers.service';
import { ReviewSellerDto } from '../sellers/dto/review-seller.dto';
import { ListDisputesQuery } from '../disputes/dto/list-disputes.query';
import { ListSellerApplicationsQuery } from './dto/list-seller-applications.query';
import { ListProductsForModerationQuery } from './dto/list-products-for-moderation.query';

// Every admin-only route in the application lives here, under one
// class-level @Roles(ADMIN). That is the point of the module: an
// auditor can read this single file and see the complete admin surface,
// instead of grepping every controller for a role decorator that might
// have been left off one method.
//
// It holds no business logic and has no service of its own — each route
// delegates to the module that owns the rule, so "admin can do X" never
// becomes a second implementation of X with its own subtly different
// checks.
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly sellersService: SellersService,
    private readonly productsService: ProductsService,
    private readonly disputesService: DisputesService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  // ===================== Seller application moderation ==============

  @Get('seller-applications')
  listSellerApplications(@Query() query: ListSellerApplicationsQuery) {
    return this.sellersService.listApplications(query);
  }

  // The reviewer is always the authenticated caller — never a body field.
  @Patch('seller-applications/:id')
  reviewSellerApplication(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReviewSellerDto,
  ) {
    return this.sellersService.review(id, user.id, dto);
  }

  // ===================== Product moderation =========================

  @Get('products')
  listProductsForModeration(@Query() query: ListProductsForModerationQuery) {
    return this.productsService.listForModeration(query);
  }

  @Patch('products/:id/moderation')
  moderateProduct(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ModerateProductDto,
  ) {
    return this.productsService.moderate(id, user, dto);
  }

  // ===================== Disputes ===================================

  @Get('disputes')
  listDisputes(@Query() query: ListDisputesQuery) {
    return this.disputesService.listForAdmin(query);
  }

  @Patch('disputes/:id')
  resolveDispute(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.disputesService.resolve(id, user.id, dto);
  }

  // ===================== Analytics ==================================

  // The whole dashboard in one response — revenue, order counts,
  // conversion, top 5 products/sellers, the daily chart, and the
  // previous-period comparison. One round trip because every figure is
  // period-scoped and a dashboard that fetched them separately could
  // render halves of two different periods together.
  @Get('analytics')
  getAnalytics(@Query() query: AnalyticsPeriodQuery) {
    return this.analyticsService.getPlatformReport(query);
  }

  // CSV or JSON, same underlying report. Streams as an attachment rather
  // than a JSON body so a browser downloads it directly.
  @Get('analytics/export')
  @Header('Cache-Control', 'no-store')
  async exportAnalytics(@Query() query: ExportQuery, @Res() res: Response) {
    const { filename, contentType, body } =
      await this.analyticsService.exportDataset(query);
    res
      .status(200)
      .setHeader('Content-Type', contentType)
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      .send(body);
  }
}
