import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { BiddingService } from './bidding.service';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { PlaceBidDto } from './dto/place-bid.dto';

// TODO: rate limit POST :id/bids (bidding is a plausible abuse target per
// ../../CLAUDE.md) once a throttling package is introduced.
@Controller('auctions')
export class BiddingController {
  constructor(private readonly biddingService: BiddingService) {}

  @Get()
  findAuctions(
    @Query('productId') productId?: string,
    @Query('sellerId') sellerId?: string,
  ) {
    return this.biddingService.findAuctions({ productId, sellerId });
  }

  @Get(':id')
  findAuctionById(@Param('id') id: string) {
    return this.biddingService.findAuctionById(id);
  }

  @Post()
  createAuction(@Body() dto: CreateAuctionDto) {
    return this.biddingService.createAuction(dto);
  }

  @Get(':id/bids')
  listBids(@Param('id') id: string) {
    return this.biddingService.listBids(id);
  }

  @Post(':id/bids')
  placeBid(@Param('id') id: string, @Body() dto: PlaceBidDto) {
    return this.biddingService.placeBid(id, dto);
  }
}
