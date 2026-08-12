import {
  BadRequestException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { ProductType, type Auction, type Bid } from '@prisma/client';
import { ProductsService } from '../products/products.service';
import { SellersService } from '../sellers/sellers.service';
import { BiddingRepository } from './domain/bidding.repository';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { PlaceBidDto } from './dto/place-bid.dto';

@Injectable()
export class BiddingService {
  constructor(
    private readonly biddingRepository: BiddingRepository,
    private readonly productsService: ProductsService,
    private readonly sellersService: SellersService,
  ) {}

  findAuctions(filter?: {
    productId?: string;
    sellerId?: string;
  }): Promise<Auction[]> {
    return this.biddingRepository.findAuctions(filter);
  }

  async findAuctionById(id: string): Promise<Auction> {
    const auction = await this.biddingRepository.findAuctionById(id);
    if (!auction) {
      throw new NotFoundException(`Auction ${id} not found`);
    }
    return auction;
  }

  async createAuction(dto: CreateAuctionDto): Promise<Auction> {
    const product = await this.productsService.findById(dto.productId);
    if (product.type !== ProductType.AUCTION) {
      throw new BadRequestException(
        'An auction can only be created for an AUCTION-type product',
      );
    }
    await this.sellersService.findById(dto.sellerId);
    return this.biddingRepository.createAuction({
      ...dto,
      startsAt: new Date(dto.startsAt),
      endsAt: new Date(dto.endsAt),
    });
  }

  listBids(auctionId: string): Promise<Bid[]> {
    return this.biddingRepository.listBidsForAuction(auctionId);
  }

  // THE concurrency-critical operation: must run inside a transaction that
  // does `UPDATE Auction SET currentHighestBid=?, currentHighestBidderId=?,
  // version=version+1 WHERE id=? AND version=?` (optimistic lock — retry
  // or reject on 0 rows affected), then insert the Bid row, then record a
  // BidPlaced outbox event — all atomically. Deliberately not implemented
  // here; this is business logic, not module wiring.
  placeBid(_auctionId: string, _dto: PlaceBidDto): Promise<Bid> {
    throw new NotImplementedException('BiddingService.placeBid');
  }
}
