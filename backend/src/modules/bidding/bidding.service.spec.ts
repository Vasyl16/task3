import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AuctionStatus,
  ProductStatus,
  ProductType,
  type Auction,
  type Product,
  type SellerProfile,
} from '@prisma/client';
import { CorrelationIdService } from '../../core/correlation-id/correlation-id.service';
import { MetricsService } from '../../infrastructure/metrics/metrics.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QueueName } from '../../infrastructure/queue/queue.constants';
import { QueueService } from '../../infrastructure/queue/queue.service';
import { ProductsService } from '../products/products.service';
import { SellersService } from '../sellers/sellers.service';
import { BiddingRepository } from './domain/bidding.repository';
import {
  BiddingService,
  END_AUCTION_JOB,
  EXPIRE_CHECKOUT_WINDOW_JOB,
  START_AUCTION_JOB,
} from './bidding.service';

const NOW_MS = Date.parse('2026-06-01T12:00:00Z');

function buildAuction(overrides: Partial<Auction> = {}): Auction {
  return {
    id: 'auction-1',
    productId: 'product-1',
    sellerId: 'seller-profile-1',
    quantity: 1,
    startingPrice: '100.00' as unknown as Auction['startingPrice'],
    minBidIncrement: '10.00' as unknown as Auction['minBidIncrement'],
    currentHighestBid: null,
    currentHighestBidderId: null,
    status: AuctionStatus.ACTIVE,
    version: 0,
    startsAt: new Date(NOW_MS - 60_000),
    endsAt: new Date(NOW_MS + 60 * 60 * 1000),
    checkoutDeadline: null,
    createdAt: new Date(NOW_MS - 60_000),
    updatedAt: new Date(NOW_MS - 60_000),
    ...overrides,
  };
}

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    sellerId: 'seller-profile-1',
    categoryId: 'category-1',
    name: 'Rare Widget',
    slug: 'rare-widget',
    description: null,
    imageUrl: null,
    basePrice: '0' as unknown as Product['basePrice'],
    type: ProductType.AUCTION,
    status: ProductStatus.ACTIVE,
    createdAt: new Date(NOW_MS),
    updatedAt: new Date(NOW_MS),
    moderatedByUserId: null,
    moderatedAt: null,
    moderationNote: null,
    ...overrides,
  };
}

describe('BiddingService', () => {
  let biddingService: BiddingService;
  let biddingRepository: jest.Mocked<BiddingRepository>;
  let productsService: jest.Mocked<
    Pick<
      ProductsService,
      | 'findById'
      | 'findManyWithInventoryForCheckout'
      | 'reserveStockForAuction'
      | 'releaseAuctionReservation'
    >
  >;
  let sellersService: jest.Mocked<
    Pick<SellersService, 'getOwnApprovedSellerProfileOrThrow' | 'findByUserId'>
  >;
  let outboxService: jest.Mocked<Pick<OutboxService, 'record'>>;
  let queueService: jest.Mocked<Pick<QueueService, 'scheduleDelayed'>>;
  const fakeTx = { marker: 'tx' };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(NOW_MS);

    biddingRepository = {
      findAuctionById: jest.fn(),
      // Defaults to "no other auction exists for this product" so every
      // existing createAuction test (none of which care about this)
      // stays unaffected; the one-live-auction-per-product tests
      // override this per-case.
      findAuctions: jest.fn().mockResolvedValue([]),
      findAuctionsForBidder: jest.fn(),
      createAuction: jest.fn(),
      listBidsForAuction: jest.fn(),
      tryAcceptBid: jest.fn(),
      transitionStatusIfCurrent: jest.fn(),
    };
    productsService = {
      findById: jest.fn(),
      // Defaults to "plenty of stock" so every existing createAuction
      // test stays unaffected; the stock-validation tests override this
      // per-case.
      findManyWithInventoryForCheckout: jest
        .fn()
        .mockResolvedValue([
          { inventory: { quantityAvailable: 999, quantityReserved: 0 } },
        ]),
      reserveStockForAuction: jest.fn(),
      releaseAuctionReservation: jest.fn(),
    };
    sellersService = {
      getOwnApprovedSellerProfileOrThrow: jest.fn(),
      // Defaults to "caller has no seller profile" (the common bidder
      // case) so every existing placeBid test below stays unaffected;
      // the self-bid tests override this per-case.
      findByUserId: jest.fn().mockResolvedValue(null),
    };
    outboxService = { record: jest.fn() };
    queueService = { scheduleDelayed: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        // Real MetricsService: it owns a private registry, so per-test
        // instances don't collide, and using the real one catches a
        // mislabelled metric call that a mock would silently swallow.
        MetricsService,
        BiddingService,
        { provide: BiddingRepository, useValue: biddingRepository },
        { provide: ProductsService, useValue: productsService },
        { provide: SellersService, useValue: sellersService },
        { provide: OutboxService, useValue: outboxService },
        { provide: QueueService, useValue: queueService },
        { provide: CorrelationIdService, useValue: { getId: () => 'corr-1' } },
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(fakeTx)),
          },
        },
      ],
    }).compile();

    biddingService = moduleRef.get(BiddingService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('findAuctionsForBidder', () => {
    it('delegates to the repository with the caller’s own id', async () => {
      const auctions = [{ id: 'auction-1' }] as unknown as Awaited<
        ReturnType<typeof biddingService.findAuctionsForBidder>
      >;
      biddingRepository.findAuctionsForBidder.mockResolvedValue(auctions);

      const result = await biddingService.findAuctionsForBidder('bidder-1');

      expect(biddingRepository.findAuctionsForBidder).toHaveBeenCalledWith(
        'bidder-1',
      );
      expect(result).toBe(auctions);
    });
  });

  describe('createAuction', () => {
    it('derives sellerId from the caller and schedules the deadline job', async () => {
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue({
        id: 'seller-profile-1',
      } as SellerProfile);
      productsService.findById.mockResolvedValue(buildProduct());
      biddingRepository.createAuction.mockResolvedValue(buildAuction());

      await biddingService.createAuction('user-1', {
        productId: 'product-1',
        quantity: 1,
        startingPrice: 100,
        minBidIncrement: 10,
        startsAt: new Date(NOW_MS).toISOString(),
        endsAt: new Date(NOW_MS + 3_600_000).toISOString(),
      });

      const [, createArg] = biddingRepository.createAuction.mock.calls[0];
      expect(createArg.sellerId).toBe('seller-profile-1');
      expect(queueService.scheduleDelayed).toHaveBeenCalledWith(
        QueueName.AUCTION_DEADLINES,
        END_AUCTION_JOB,
        { auctionId: 'auction-1' },
        new Date(NOW_MS + 3_600_000),
      );
    });

    // Search indexes "is this product currently biddable?" — without
    // this, a freshly-created auction's product would keep showing as
    // if it had no live auction until some unrelated product edit
    // happened to trigger a resync.
    it('records a ProductUpdated event in the same transaction, so search re-syncs the product as biddable', async () => {
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue({
        id: 'seller-profile-1',
      } as SellerProfile);
      productsService.findById.mockResolvedValue(buildProduct());
      biddingRepository.createAuction.mockResolvedValue(buildAuction());

      await biddingService.createAuction('user-1', {
        productId: 'product-1',
        quantity: 1,
        startingPrice: 100,
        minBidIncrement: 10,
        startsAt: new Date(NOW_MS).toISOString(),
        endsAt: new Date(NOW_MS + 3_600_000).toISOString(),
      });

      expect(outboxService.record).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({
          aggregateType: 'Product',
          aggregateId: 'product-1',
          eventType: 'ProductUpdated',
          payload: { productId: 'product-1' },
        }),
      );
    });

    describe('one live auction per product', () => {
      it.each(['ACTIVE', 'SCHEDULED'] as const)(
        'rejects a new auction when the product already has an %s one',
        async (status) => {
          sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue({
            id: 'seller-profile-1',
          } as SellerProfile);
          productsService.findById.mockResolvedValue(buildProduct());
          biddingRepository.findAuctions.mockResolvedValue([
            buildAuction({ id: 'existing-auction', status }),
          ]);

          await expect(
            biddingService.createAuction('user-1', {
              productId: 'product-1',
              quantity: 1,
              startingPrice: 100,
              minBidIncrement: 10,
              startsAt: new Date(NOW_MS).toISOString(),
              endsAt: new Date(NOW_MS + 3_600_000).toISOString(),
            }),
          ).rejects.toBeInstanceOf(BadRequestException);
          expect(biddingRepository.createAuction).not.toHaveBeenCalled();
        },
      );

      // A COMPLETED/EXPIRED/CANCELLED auction on the product is history,
      // not a live listing — it must never block re-listing.
      it.each(['ENDED', 'COMPLETED', 'EXPIRED', 'CANCELLED'] as const)(
        'allows a new auction when the product’s only other auction is %s',
        async (status) => {
          sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue({
            id: 'seller-profile-1',
          } as SellerProfile);
          productsService.findById.mockResolvedValue(buildProduct());
          biddingRepository.findAuctions.mockResolvedValue([
            buildAuction({ id: 'past-auction', status }),
          ]);
          biddingRepository.createAuction.mockResolvedValue(buildAuction());

          await expect(
            biddingService.createAuction('user-1', {
              productId: 'product-1',
              quantity: 1,
              startingPrice: 100,
              minBidIncrement: 10,
              startsAt: new Date(NOW_MS).toISOString(),
              endsAt: new Date(NOW_MS + 3_600_000).toISOString(),
            }),
          ).resolves.toBeDefined();
        },
      );
    });

    describe('stock validation', () => {
      it('rejects an auction quantity greater than the product’s available stock', async () => {
        sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue({
          id: 'seller-profile-1',
        } as SellerProfile);
        productsService.findById.mockResolvedValue(buildProduct());
        productsService.findManyWithInventoryForCheckout.mockResolvedValue([
          {
            inventory: { quantityAvailable: 2, quantityReserved: 0 },
          } as never,
        ]);

        await expect(
          biddingService.createAuction('user-1', {
            productId: 'product-1',
            quantity: 3,
            startingPrice: 100,
            minBidIncrement: 10,
            startsAt: new Date(NOW_MS).toISOString(),
            endsAt: new Date(NOW_MS + 3_600_000).toISOString(),
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(biddingRepository.createAuction).not.toHaveBeenCalled();
      });

      // quantityReserved is a denormalized cache of auction claims, not
      // the source of truth. A drifted one (written by an older version
      // of the stock code, say) must NOT be able to veto an auction the
      // seller's real stock and real auctions both allow.
      it('ignores quantityReserved entirely — a stale counter can’t block an auction', async () => {
        sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue({
          id: 'seller-profile-1',
        } as SellerProfile);
        productsService.findById.mockResolvedValue(buildProduct());
        // 5 physically in stock, no auction holds any of them — but the
        // reserved counter wrongly claims 4 are spoken for.
        productsService.findManyWithInventoryForCheckout.mockResolvedValue([
          {
            inventory: { quantityAvailable: 5, quantityReserved: 4 },
          } as never,
        ]);
        biddingRepository.createAuction.mockResolvedValue(
          buildAuction({ quantity: 5 }),
        );

        await biddingService.createAuction('user-1', {
          productId: 'product-1',
          quantity: 5,
          startingPrice: 100,
          minBidIncrement: 10,
          startsAt: new Date(NOW_MS).toISOString(),
          endsAt: new Date(NOW_MS + 3_600_000).toISOString(),
        });

        const [, createArg] = biddingRepository.createAuction.mock.calls[0];
        expect(createArg.quantity).toBe(5);
      });

      // An ENDED auction's winner still has an open checkout window, so
      // those units are not free — but that is already reflected in
      // quantityAvailable, because holding a lot MOVES units out of it.
      // The check must not subtract the auction's quantity a second
      // time; doing so would refuse lots the seller genuinely has.
      it('treats quantityAvailable as already excluding an ENDED auction’s hold', async () => {
        sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue({
          id: 'seller-profile-1',
        } as SellerProfile);
        productsService.findById.mockResolvedValue(buildProduct());
        biddingRepository.findAuctions.mockResolvedValue([
          buildAuction({
            id: 'ended-auction',
            status: AuctionStatus.ENDED,
            quantity: 3,
          }),
        ]);
        // 3 already held by the ENDED auction and therefore already out
        // of quantityAvailable, which reads 2. Those 2 are genuinely
        // free, so a 2-unit lot must be allowed.
        productsService.findManyWithInventoryForCheckout.mockResolvedValue([
          {
            inventory: { quantityAvailable: 2, quantityReserved: 3 },
          } as never,
        ]);
        biddingRepository.createAuction.mockResolvedValue(buildAuction());

        await biddingService.createAuction('user-1', {
          productId: 'product-1',
          quantity: 2,
          startingPrice: 100,
          minBidIncrement: 10,
          startsAt: new Date(NOW_MS).toISOString(),
          endsAt: new Date(NOW_MS + 3_600_000).toISOString(),
        });

        expect(biddingRepository.createAuction).toHaveBeenCalled();
      });

      it('still refuses a lot larger than quantityAvailable', async () => {
        sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue({
          id: 'seller-profile-1',
        } as SellerProfile);
        productsService.findById.mockResolvedValue(buildProduct());
        biddingRepository.findAuctions.mockResolvedValue([]);
        productsService.findManyWithInventoryForCheckout.mockResolvedValue([
          { inventory: { quantityAvailable: 2, quantityReserved: 3 } } as never,
        ]);

        await expect(
          biddingService.createAuction('user-1', {
            productId: 'product-1',
            quantity: 3,
            startingPrice: 100,
            minBidIncrement: 10,
            startsAt: new Date(NOW_MS).toISOString(),
            endsAt: new Date(NOW_MS + 3_600_000).toISOString(),
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(biddingRepository.createAuction).not.toHaveBeenCalled();
      });

      it('accepts a quantity that exactly matches available stock', async () => {
        sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue({
          id: 'seller-profile-1',
        } as SellerProfile);
        productsService.findById.mockResolvedValue(buildProduct());
        productsService.findManyWithInventoryForCheckout.mockResolvedValue([
          {
            inventory: { quantityAvailable: 5, quantityReserved: 0 },
          } as never,
        ]);
        biddingRepository.createAuction.mockResolvedValue(
          buildAuction({ quantity: 5 }),
        );

        await biddingService.createAuction('user-1', {
          productId: 'product-1',
          quantity: 5,
          startingPrice: 100,
          minBidIncrement: 10,
          startsAt: new Date(NOW_MS).toISOString(),
          endsAt: new Date(NOW_MS + 3_600_000).toISOString(),
        });

        const [, createArg] = biddingRepository.createAuction.mock.calls[0];
        expect(createArg.quantity).toBe(5);
      });
    });

    it('starts ACTIVE immediately when startsAt is now/past, with no start job scheduled', async () => {
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue({
        id: 'seller-profile-1',
      } as SellerProfile);
      productsService.findById.mockResolvedValue(buildProduct());
      biddingRepository.createAuction.mockResolvedValue(buildAuction());

      await biddingService.createAuction('user-1', {
        productId: 'product-1',
        quantity: 1,
        startingPrice: 100,
        minBidIncrement: 10,
        startsAt: new Date(NOW_MS).toISOString(),
        endsAt: new Date(NOW_MS + 3_600_000).toISOString(),
      });

      const [, createArg] = biddingRepository.createAuction.mock.calls[0];
      expect(createArg.status).toBe(AuctionStatus.ACTIVE);
      expect(queueService.scheduleDelayed).not.toHaveBeenCalledWith(
        QueueName.AUCTION_DEADLINES,
        START_AUCTION_JOB,
        expect.anything(),
        expect.anything(),
      );
    });

    it('starts SCHEDULED and schedules a start job when startsAt is in the future', async () => {
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue({
        id: 'seller-profile-1',
      } as SellerProfile);
      productsService.findById.mockResolvedValue(buildProduct());
      biddingRepository.createAuction.mockResolvedValue(
        buildAuction({ status: AuctionStatus.SCHEDULED }),
      );

      const futureStart = new Date(NOW_MS + 60_000);
      await biddingService.createAuction('user-1', {
        productId: 'product-1',
        quantity: 1,
        startingPrice: 100,
        minBidIncrement: 10,
        startsAt: futureStart.toISOString(),
        endsAt: new Date(NOW_MS + 3_600_000).toISOString(),
      });

      const [, createArg] = biddingRepository.createAuction.mock.calls[0];
      expect(createArg.status).toBe(AuctionStatus.SCHEDULED);
      expect(queueService.scheduleDelayed).toHaveBeenCalledWith(
        QueueName.AUCTION_DEADLINES,
        START_AUCTION_JOB,
        { auctionId: 'auction-1' },
        futureStart,
      );
    });

    it('IDOR: rejects creating an auction for a product owned by someone else', async () => {
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue({
        id: 'my-profile',
      } as SellerProfile);
      productsService.findById.mockResolvedValue(
        buildProduct({ sellerId: 'someone-elses-profile' }),
      );

      await expect(
        biddingService.createAuction('attacker', {
          productId: 'product-1',
          quantity: 1,
          startingPrice: 100,
          minBidIncrement: 10,
          startsAt: new Date(NOW_MS).toISOString(),
          endsAt: new Date(NOW_MS + 3_600_000).toISOString(),
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects creating an auction for a non-AUCTION product', async () => {
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue({
        id: 'my-profile',
      } as SellerProfile);
      productsService.findById.mockResolvedValue(
        buildProduct({ sellerId: 'my-profile', type: ProductType.FIXED_PRICE }),
      );

      await expect(
        biddingService.createAuction('user-1', {
          productId: 'product-1',
          quantity: 1,
          startingPrice: 100,
          minBidIncrement: 10,
          startsAt: new Date(NOW_MS).toISOString(),
          endsAt: new Date(NOW_MS + 3_600_000).toISOString(),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('placeBid', () => {
    it('accepts a normal bid at or above the starting price when there is no current bid', async () => {
      biddingRepository.findAuctionById.mockResolvedValue(buildAuction());
      biddingRepository.tryAcceptBid.mockResolvedValue({
        id: 'bid-1',
        auctionId: 'auction-1',
        bidderId: 'bidder-1',
        amount: '100.00' as never,
        placedAt: new Date(NOW_MS),
      });

      const bid = await biddingService.placeBid('auction-1', 'bidder-1', {
        amount: 100,
      });

      expect(bid.id).toBe('bid-1');
      expect(biddingRepository.tryAcceptBid).toHaveBeenCalledWith(fakeTx, {
        auctionId: 'auction-1',
        expectedVersion: 0,
        bidderId: 'bidder-1',
        amount: 100,
      });
      expect(outboxService.record).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({ eventType: 'BidPlaced' }),
      );
    });

    it('accepts a bid that meets current highest + minBidIncrement', async () => {
      biddingRepository.findAuctionById.mockResolvedValue(
        buildAuction({
          currentHighestBid: '100.00' as never,
          currentHighestBidderId: 'earlier-bidder',
          version: 3,
        }),
      );
      biddingRepository.tryAcceptBid.mockResolvedValue({
        id: 'bid-2',
        auctionId: 'auction-1',
        bidderId: 'bidder-2',
        amount: '110.00' as never,
        placedAt: new Date(NOW_MS),
      });

      await biddingService.placeBid('auction-1', 'bidder-2', { amount: 110 });

      expect(biddingRepository.tryAcceptBid).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({ expectedVersion: 3, amount: 110 }),
      );
    });

    it('rejects a bid below the minimum acceptable amount', async () => {
      biddingRepository.findAuctionById.mockResolvedValue(
        buildAuction({ currentHighestBid: '100.00' as never }),
      );

      await expect(
        biddingService.placeBid('auction-1', 'bidder-1', { amount: 105 }), // needs >= 110
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(biddingRepository.tryAcceptBid).not.toHaveBeenCalled();
    });

    it('rejects a bid equal to the current highest (must strictly exceed by the increment)', async () => {
      biddingRepository.findAuctionById.mockResolvedValue(
        buildAuction({ currentHighestBid: '100.00' as never }),
      );

      await expect(
        biddingService.placeBid('auction-1', 'bidder-1', { amount: 100 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a bid placed after the deadline', async () => {
      biddingRepository.findAuctionById.mockResolvedValue(
        buildAuction({ endsAt: new Date(NOW_MS - 1000) }),
      );

      await expect(
        biddingService.placeBid('auction-1', 'bidder-1', { amount: 100 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(biddingRepository.tryAcceptBid).not.toHaveBeenCalled();
    });

    it('rejects a bid on an auction that is not ACTIVE', async () => {
      biddingRepository.findAuctionById.mockResolvedValue(
        buildAuction({ status: AuctionStatus.SCHEDULED }),
      );

      await expect(
        biddingService.placeBid('auction-1', 'bidder-1', { amount: 100 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s for a non-existent auction', async () => {
      biddingRepository.findAuctionById.mockResolvedValue(null);

      await expect(
        biddingService.placeBid('missing', 'bidder-1', { amount: 100 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    // Concurrent bids / no lost update: the first attempt loses the
    // optimistic-lock race (tryAcceptBid returns null because the
    // version it read is now stale — another bid landed first). The
    // service re-reads fresh auction state and retries rather than
    // failing outright.
    it('retries against fresh state on a version conflict, and succeeds if still valid', async () => {
      biddingRepository.findAuctionById
        .mockResolvedValueOnce(buildAuction({ version: 0 })) // stale read
        .mockResolvedValueOnce(
          buildAuction({
            version: 1,
            currentHighestBid: '100.00' as never,
            currentHighestBidderId: 'the-other-bidder',
          }),
        ); // fresh state after the race
      biddingRepository.tryAcceptBid
        .mockResolvedValueOnce(null) // lost the race
        .mockResolvedValueOnce({
          id: 'bid-2',
          auctionId: 'auction-1',
          bidderId: 'bidder-2',
          amount: '120.00' as never,
          placedAt: new Date(NOW_MS),
        });

      const bid = await biddingService.placeBid('auction-1', 'bidder-2', {
        amount: 120,
      });

      expect(bid.id).toBe('bid-2');
      expect(biddingRepository.findAuctionById).toHaveBeenCalledTimes(2);
      expect(biddingRepository.tryAcceptBid).toHaveBeenCalledTimes(2);
      // The retry used the FRESH version (1), not the stale one (0) —
      // this is what prevents a lost update.
      expect(biddingRepository.tryAcceptBid).toHaveBeenLastCalledWith(
        fakeTx,
        expect.objectContaining({ expectedVersion: 1 }),
      );
    });

    it('gives up after MAX_BID_ATTEMPTS consecutive conflicts', async () => {
      biddingRepository.findAuctionById.mockResolvedValue(buildAuction());
      biddingRepository.tryAcceptBid.mockResolvedValue(null);

      await expect(
        biddingService.placeBid('auction-1', 'bidder-1', { amount: 100 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a seller bidding on their own auction', async () => {
      biddingRepository.findAuctionById.mockResolvedValue(
        buildAuction({ sellerId: 'my-profile' }),
      );
      sellersService.findByUserId.mockResolvedValue({
        id: 'my-profile',
      } as SellerProfile);

      await expect(
        biddingService.placeBid('auction-1', 'seller-user-1', { amount: 200 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(biddingRepository.tryAcceptBid).not.toHaveBeenCalled();
    });

    it("allows a DIFFERENT seller to bid on someone else's auction", async () => {
      biddingRepository.findAuctionById.mockResolvedValue(
        buildAuction({ sellerId: 'other-profile' }),
      );
      sellersService.findByUserId.mockResolvedValue({
        id: 'my-profile', // a seller, just not THIS auction's seller
      } as SellerProfile);
      biddingRepository.tryAcceptBid.mockResolvedValue({
        id: 'bid-1',
        auctionId: 'auction-1',
        bidderId: 'seller-user-1',
        amount: '100.00' as never,
        placedAt: new Date(NOW_MS),
      });

      await expect(
        biddingService.placeBid('auction-1', 'seller-user-1', { amount: 100 }),
      ).resolves.toMatchObject({ id: 'bid-1' });
    });
  });

  describe('activateAuctionIfDue', () => {
    it('transitions SCHEDULED -> ACTIVE', async () => {
      biddingRepository.transitionStatusIfCurrent.mockResolvedValue(
        buildAuction({ status: AuctionStatus.ACTIVE }),
      );

      await biddingService.activateAuctionIfDue('auction-1');

      expect(biddingRepository.transitionStatusIfCurrent).toHaveBeenCalledWith(
        fakeTx,
        'auction-1',
        AuctionStatus.SCHEDULED,
        AuctionStatus.ACTIVE,
      );
    });

    it('is idempotent: a redelivered job that finds the auction already ACTIVE does nothing', async () => {
      biddingRepository.transitionStatusIfCurrent.mockResolvedValue(null);

      await expect(
        biddingService.activateAuctionIfDue('auction-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('endAuction (winner determination)', () => {
    it('ends with a winner: transitions to ENDED, sets a checkoutDeadline, and schedules the expiry job', async () => {
      const auction = buildAuction({
        currentHighestBid: '150.00' as never,
        currentHighestBidderId: 'winner-1',
      });
      biddingRepository.findAuctionById.mockResolvedValue(auction);
      biddingRepository.transitionStatusIfCurrent.mockResolvedValue({
        ...auction,
        status: AuctionStatus.ENDED,
      });

      await biddingService.endAuction('auction-1');

      expect(biddingRepository.transitionStatusIfCurrent).toHaveBeenCalledWith(
        fakeTx,
        'auction-1',
        AuctionStatus.ACTIVE,
        AuctionStatus.ENDED,
        expect.objectContaining({ checkoutDeadline: expect.any(Date) }),
      );
      expect(outboxService.record).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({
          eventType: 'AuctionEnded',
          payload: expect.objectContaining({ winningBidderId: 'winner-1' }),
        }),
      );
      // The product just stopped being biddable — search needs to know,
      // same as the createAuction case going the other direction.
      expect(outboxService.record).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({
          aggregateType: 'Product',
          aggregateId: 'product-1',
          eventType: 'ProductUpdated',
          payload: { productId: 'product-1' },
        }),
      );
      expect(queueService.scheduleDelayed).toHaveBeenCalledWith(
        QueueName.AUCTION_DEADLINES,
        EXPIRE_CHECKOUT_WINDOW_JOB,
        { auctionId: 'auction-1' },
        expect.any(Date),
      );
    });

    it('ends with no bids: transitions straight to EXPIRED, no checkout window scheduled', async () => {
      const auction = buildAuction(); // no bids
      biddingRepository.findAuctionById.mockResolvedValue(auction);
      biddingRepository.transitionStatusIfCurrent.mockResolvedValue({
        ...auction,
        status: AuctionStatus.EXPIRED,
      });

      await biddingService.endAuction('auction-1');

      expect(biddingRepository.transitionStatusIfCurrent).toHaveBeenCalledWith(
        fakeTx,
        'auction-1',
        AuctionStatus.ACTIVE,
        AuctionStatus.EXPIRED,
        { checkoutDeadline: null },
      );
      expect(queueService.scheduleDelayed).not.toHaveBeenCalled();
    });

    it('is idempotent: a redelivered job that finds the auction already ended does nothing further', async () => {
      biddingRepository.findAuctionById.mockResolvedValue(
        buildAuction({ status: AuctionStatus.ENDED }),
      );
      biddingRepository.transitionStatusIfCurrent.mockResolvedValue(null);

      await biddingService.endAuction('auction-1');

      expect(outboxService.record).not.toHaveBeenCalled();
      expect(queueService.scheduleDelayed).not.toHaveBeenCalled();
    });
  });

  // The lot is HELD (quantityReserved) from creation until it either
  // becomes a sale or provably never will — never decremented outright,
  // so an auctioned product keeps showing real stock while bidding runs.
  describe('auction stock holds', () => {
    it('holds the lot when the auction is created, without consuming stock', async () => {
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue({
        id: 'seller-profile-1',
      } as SellerProfile);
      productsService.findById.mockResolvedValue(buildProduct());
      biddingRepository.createAuction.mockResolvedValue(buildAuction());

      await biddingService.createAuction('user-1', {
        productId: 'product-1',
        quantity: 3,
        startingPrice: 100,
        minBidIncrement: 10,
        startsAt: new Date(NOW_MS).toISOString(),
        endsAt: new Date(NOW_MS + 3_600_000).toISOString(),
      });

      expect(productsService.reserveStockForAuction).toHaveBeenCalledWith(
        fakeTx,
        'product-1',
        3,
      );
    });

    it('releases the hold when the auction ends with no bids', async () => {
      const auction = buildAuction({ quantity: 2 }); // no bids
      biddingRepository.findAuctionById.mockResolvedValue(auction);
      biddingRepository.transitionStatusIfCurrent.mockResolvedValue({
        ...auction,
        status: AuctionStatus.EXPIRED,
      });

      await biddingService.endAuction('auction-1');

      expect(productsService.releaseAuctionReservation).toHaveBeenCalledWith(
        fakeTx,
        'product-1',
        2,
      );
    });

    // The winner still has a checkout window open — the units stay held
    // for them, and are only released if that window lapses.
    it('keeps the hold when the auction ends WITH a winner', async () => {
      const auction = buildAuction({
        quantity: 2,
        currentHighestBid: '150.00' as never,
        currentHighestBidderId: 'winner-1',
      });
      biddingRepository.findAuctionById.mockResolvedValue(auction);
      biddingRepository.transitionStatusIfCurrent.mockResolvedValue({
        ...auction,
        status: AuctionStatus.ENDED,
      });

      await biddingService.endAuction('auction-1');

      expect(productsService.releaseAuctionReservation).not.toHaveBeenCalled();
    });

    it('releases the hold when the winner lets their checkout window lapse', async () => {
      biddingRepository.transitionStatusIfCurrent.mockResolvedValue(
        buildAuction({ quantity: 4, status: AuctionStatus.EXPIRED }),
      );

      await biddingService.expireCheckoutWindowIfUnclaimed('auction-1');

      expect(productsService.releaseAuctionReservation).toHaveBeenCalledWith(
        fakeTx,
        'product-1',
        4,
      );
    });

    it('releases nothing when a redelivered expiry job finds the auction already moved on', async () => {
      biddingRepository.transitionStatusIfCurrent.mockResolvedValue(null);

      await biddingService.expireCheckoutWindowIfUnclaimed('auction-1');

      expect(productsService.releaseAuctionReservation).not.toHaveBeenCalled();
    });
  });

  describe('assertCanCheckoutAsWinner', () => {
    it('allows the actual winner within the checkout window', () => {
      const auction = buildAuction({
        status: AuctionStatus.ENDED,
        currentHighestBidderId: 'winner-1',
        checkoutDeadline: new Date(NOW_MS + 1000),
      });
      expect(() =>
        biddingService.assertCanCheckoutAsWinner(auction, 'winner-1'),
      ).not.toThrow();
    });

    it('rejects a caller who is not the winner', () => {
      const auction = buildAuction({
        status: AuctionStatus.ENDED,
        currentHighestBidderId: 'winner-1',
        checkoutDeadline: new Date(NOW_MS + 1000),
      });
      expect(() =>
        biddingService.assertCanCheckoutAsWinner(auction, 'someone-else'),
      ).toThrow(ForbiddenException);
    });

    it('rejects checkout once the window has expired', () => {
      const auction = buildAuction({
        status: AuctionStatus.ENDED,
        currentHighestBidderId: 'winner-1',
        checkoutDeadline: new Date(NOW_MS - 1000),
      });
      expect(() =>
        biddingService.assertCanCheckoutAsWinner(auction, 'winner-1'),
      ).toThrow(BadRequestException);
    });

    it('rejects checkout for an auction not in the ENDED state', () => {
      const auction = buildAuction({ status: AuctionStatus.ACTIVE });
      expect(() =>
        biddingService.assertCanCheckoutAsWinner(auction, 'winner-1'),
      ).toThrow(BadRequestException);
    });
  });
});
