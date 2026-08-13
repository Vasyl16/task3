import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import { Public } from '../../core/auth/decorators/public.decorator';
import { Roles } from '../../core/auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { IdempotencyInterceptor } from '../../infrastructure/idempotency/idempotency.interceptor';
import { BiddingService } from './bidding.service';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { PlaceBidDto } from './dto/place-bid.dto';

// TODO: rate limit POST :id/bids (bidding is a plausible abuse target —
// see .claude/rules/backend.md) once a throttling package is introduced.
@Controller('auctions')
export class BiddingController {
  constructor(private readonly biddingService: BiddingService) {}

  @Public()
  @Get()
  findAuctions(
    @Query('productId') productId?: string,
    @Query('sellerId') sellerId?: string,
  ) {
    return this.biddingService.findAuctions({ productId, sellerId });
  }

  @Public()
  @Get(':id')
  findAuctionById(@Param('id') id: string) {
    return this.biddingService.findAuctionById(id);
  }

  @Roles(UserRole.SELLER)
  @Post()
  createAuction(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAuctionDto,
  ) {
    return this.biddingService.createAuction(user.id, dto);
  }

  @Public()
  @Get(':id/bids')
  listBids(@Param('id') id: string) {
    return this.biddingService.listBids(id);
  }

  // Idempotent when the client sends an Idempotency-Key header — a
  // duplicate bid request (e.g. a client retry after a timeout) with the
  // same key never places a second bid. See IdempotencyInterceptor.
  @UseInterceptors(IdempotencyInterceptor)
  @Post(':id/bids')
  placeBid(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PlaceBidDto,
  ) {
    return this.biddingService.placeBid(id, user.id, dto);
  }
}
