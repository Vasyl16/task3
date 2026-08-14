import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ApiAuth } from '../../core/openapi/api-auth.decorator';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import { Public } from '../../core/auth/decorators/public.decorator';
import { Roles } from '../../core/auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { IdempotencyInterceptor } from '../../infrastructure/idempotency/idempotency.interceptor';
import { BiddingService } from './bidding.service';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { PlaceBidDto } from './dto/place-bid.dto';

// Bidding is covered by the app-wide default rate limit (see
// CoreModule). Deliberately NOT given a tighter per-route limit: a
// contested auction's final seconds are legitimately high-rate, several
// bidders can share one NAT'd IP, and the real protections against abuse
// here are the ones that can't be evaded — the optimistic-locking
// conditional UPDATE and the Idempotency-Key guard below.
@ApiTags('auctions')
@Controller('auctions')
export class BiddingController {
  constructor(private readonly biddingService: BiddingService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List auctions (public)' })
  @ApiQuery({ name: 'productId', required: false })
  @ApiQuery({ name: 'sellerId', required: false })
  findAuctions(
    @Query('productId') productId?: string,
    @Query('sellerId') sellerId?: string,
  ) {
    return this.biddingService.findAuctions({ productId, sellerId });
  }

  // Registered before ':id' — otherwise Nest would match "mine" as an
  // :id path param and this route would never be reached.
  @Get('mine')
  @ApiAuth()
  @ApiOperation({
    summary: 'Auctions the caller has bid on',
    description: 'Where a winner comes to claim a win within their window.',
  })
  findMyAuctions(@CurrentUser() user: AuthenticatedUser) {
    return this.biddingService.findAuctionsForBidder(user.id);
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Get one auction (public)',
    description:
      'Includes currentHighestBid and the optimistic-locking `version`. ' +
      'For live updates, subscribe to the `auction:{id}` WebSocket room ' +
      'instead of polling.',
  })
  @ApiResponse({ status: 404, description: 'No such auction.' })
  findAuctionById(@Param('id') id: string) {
    return this.biddingService.findAuctionById(id);
  }

  @Roles(UserRole.SELLER)
  @Post()
  @ApiAuth(UserRole.SELLER)
  @ApiOperation({
    summary: 'Open an auction on your own product',
    description:
      'The product must be AUCTION-type and yours, and only one live ' +
      'auction may exist per product. The lot is HELD, not consumed: the ' +
      'units stay in stock but stop being sellable through the cart, so ' +
      'the same unit cannot be sold twice. The hold is released if the ' +
      'auction ends with no winner or the winner lets their window lapse.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Not an AUCTION-type product, a live auction already exists for it, ' +
      'or not enough free stock for the requested lot size.',
  })
  @ApiResponse({ status: 403, description: 'You do not own this product.' })
  createAuction(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAuctionDto,
  ) {
    return this.biddingService.createAuction(user.id, dto);
  }

  @Public()
  @Get(':id/bids')
  @ApiOperation({ summary: 'Bid history for an auction (public)' })
  listBids(@Param('id') id: string) {
    return this.biddingService.listBids(id);
  }

  // Idempotent when the client sends an Idempotency-Key header — a
  // duplicate bid request (e.g. a client retry after a timeout) with the
  // same key never places a second bid. See IdempotencyInterceptor.
  @UseInterceptors(IdempotencyInterceptor)
  @Post(':id/bids')
  @ApiAuth()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Optional. Retrying with the same key will not place a second bid.',
  })
  @ApiOperation({
    summary: 'Place a bid',
    description:
      'Must be at least currentHighestBid + minBidIncrement (or ' +
      'startingPrice for the first bid). Concurrency-safe by optimistic ' +
      'locking: the write is a conditional UPDATE on the auction’s ' +
      '`version`, so two simultaneous bids can never overwrite each ' +
      'other — the loser re-reads and retries against the new price. A ' +
      '400 under contention means someone else’s bid raised the floor ' +
      'above yours, which is the system working, not an error.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Below the minimum acceptable amount, or the auction is not ' +
      'accepting bids (not ACTIVE, or already ended).',
  })
  @ApiResponse({
    status: 403,
    description: 'You cannot bid on your own auction.',
  })
  @ApiResponse({
    status: 409,
    description:
      'Too much concurrent contention — the retry budget was exhausted. ' +
      'Safe to retry; nothing was recorded.',
  })
  placeBid(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PlaceBidDto,
  ) {
    return this.biddingService.placeBid(id, user.id, dto);
  }
}
