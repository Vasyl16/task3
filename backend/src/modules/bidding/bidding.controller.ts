import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Public } from '../../core/auth/decorators/public.decorator';
import { Roles } from '../../core/auth/decorators/roles.decorator';
import { BiddingService } from './bidding.service';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { PlaceBidDto } from './dto/place-bid.dto';

// TODO: rate limit POST :id/bids (bidding is a plausible abuse target —
// see .claude/rules/backend.md) once a throttling package is introduced.
// TODO: createAuction still trusts dto.sellerId — same IDOR gap that was
// fixed for products; not in scope for the current auth/seller/catalog
// tasks, fix when bidding gets its own pass.
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
  createAuction(@Body() dto: CreateAuctionDto) {
    return this.biddingService.createAuction(dto);
  }

  @Public()
  @Get(':id/bids')
  listBids(@Param('id') id: string) {
    return this.biddingService.listBids(id);
  }

  @Post(':id/bids')
  placeBid(@Param('id') id: string, @Body() dto: PlaceBidDto) {
    return this.biddingService.placeBid(id, dto);
  }
}
