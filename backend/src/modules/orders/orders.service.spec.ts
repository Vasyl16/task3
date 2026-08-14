import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AuctionStatus,
  ProductStatus,
  ProductType,
  SellerOrderStatus,
  UserRole,
  type Auction,
  type Order,
  type Product,
  type SellerOrder,
  type SellerProfile,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { CorrelationIdService } from '../../core/correlation-id/correlation-id.service';
import { MetricsService } from '../../infrastructure/metrics/metrics.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { ProductsService } from '../products/products.service';
import { SellersService } from '../sellers/sellers.service';
import { BiddingService } from '../bidding/bidding.service';
import { OrdersRepository } from './domain/orders.repository';
import { OrdersService } from './orders.service';
import type { ProductWithInventory } from '../products/domain/products.repository';

const NOW = new Date();

function buildOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    buyerId: 'buyer-1',
    status: SellerOrderStatus.NEW,
    totalAmount: '10.00' as unknown as Order['totalAmount'],
    placedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function buildSellerOrder(overrides: Partial<SellerOrder> = {}): SellerOrder {
  return {
    id: 'seller-order-1',
    orderId: 'order-1',
    sellerId: 'seller-profile-1',
    status: SellerOrderStatus.NEW,
    subtotal: '10.00' as unknown as SellerOrder['subtotal'],
    shippingFee: '0' as unknown as SellerOrder['shippingFee'],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function buildProduct(
  overrides: Partial<ProductWithInventory> = {},
): ProductWithInventory {
  return {
    id: 'product-1',
    sellerId: 'seller-profile-1',
    categoryId: 'category-1',
    name: 'Widget',
    slug: 'widget',
    description: null,
    imageUrl: null,
    basePrice: '10.00' as unknown as Product['basePrice'],
    type: ProductType.FIXED_PRICE,
    status: ProductStatus.ACTIVE,
    createdAt: NOW,
    updatedAt: NOW,
    inventory: null,
    moderatedByUserId: null,
    moderatedAt: null,
    moderationNote: null,
    ...overrides,
  };
}

function buildSellerProfile(
  overrides: Partial<SellerProfile> = {},
): SellerProfile {
  return {
    id: 'seller-profile-1',
    userId: 'seller-user-1',
    businessName: 'Shop',
    description: null,
    status: 'APPROVED',
    reviewedByUserId: null,
    reviewedAt: NOW,
    appliedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function buildAuction(overrides: Partial<Auction> = {}): Auction {
  return {
    id: 'auction-1',
    productId: 'product-1',
    sellerId: 'seller-profile-1',
    quantity: 1,
    startingPrice: '50.00' as unknown as Auction['startingPrice'],
    minBidIncrement: '5.00' as unknown as Auction['minBidIncrement'],
    currentHighestBid: '100.00' as unknown as Auction['currentHighestBid'],
    currentHighestBidderId: 'buyer-1',
    status: AuctionStatus.ENDED,
    version: 1,
    startsAt: NOW,
    endsAt: NOW,
    checkoutDeadline: new Date(NOW.getTime() + 60_000),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function buildCaller(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'buyer-1',
    email: 'buyer@example.com',
    role: UserRole.CUSTOMER,
    ...overrides,
  };
}

describe('OrdersService', () => {
  let ordersService: OrdersService;
  let ordersRepository: jest.Mocked<OrdersRepository>;
  let sellersService: jest.Mocked<
    Pick<SellersService, 'getOwnApprovedSellerProfileOrThrow' | 'findById'>
  >;
  let cartService: jest.Mocked<
    Pick<CartService, 'getOrCreateForBuyer' | 'completeCheckout'>
  >;
  let productsService: jest.Mocked<
    Pick<
      ProductsService,
      | 'findManyWithInventoryForCheckout'
      | 'reserveStockForCheckout'
      | 'commitReservationForShipment'
      | 'releaseReservationForCancellation'
      | 'returnStockAfterForceCancellation'
      | 'releaseAuctionReservation'
    >
  >;
  let outboxService: jest.Mocked<Pick<OutboxService, 'record'>>;
  let biddingService: jest.Mocked<
    Pick<
      BiddingService,
      'findAuctionById' | 'assertCanCheckoutAsWinner' | 'markAuctionCompleted'
    >
  >;
  const fakeTx = { marker: 'tx' };

  beforeEach(async () => {
    ordersRepository = {
      findByBuyerId: jest.fn(),
      findAllForAdmin: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      findSellerOrderById: jest.fn(),
      createFromCheckout: jest.fn(),
      createLedgerEntries: jest.fn(),
      updateSellerOrderStatus: jest.fn(),
      updateSellerOrderStatusIfCurrent: jest.fn(),
      // Returns the recomputed parent Order because the
      // SellerOrderStatusChanged event carries its aggregate status —
      // see OrdersService.recordStatusChanged.
      updateOrderStatus: jest.fn().mockResolvedValue(buildOrder()),
      findOrderItemsForSellerOrder: jest.fn(),
      findSellerOrderStatusesForOrder: jest.fn(),
      findBySellerId: jest.fn(),
    };
    sellersService = {
      getOwnApprovedSellerProfileOrThrow: jest.fn(),
      findById: jest.fn(),
    };
    cartService = {
      getOrCreateForBuyer: jest.fn(),
      completeCheckout: jest.fn(),
    };
    productsService = {
      findManyWithInventoryForCheckout: jest.fn(),
      reserveStockForCheckout: jest.fn(),
      commitReservationForShipment: jest.fn().mockResolvedValue(true),
      releaseReservationForCancellation: jest.fn(),
      returnStockAfterForceCancellation: jest.fn(),
      releaseAuctionReservation: jest.fn(),
    };
    outboxService = { record: jest.fn() };
    biddingService = {
      findAuctionById: jest.fn(),
      assertCanCheckoutAsWinner: jest.fn(),
      markAuctionCompleted: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        // Real MetricsService: it owns a private registry, so per-test
        // instances don't collide, and using the real one catches a
        // mislabelled metric call that a mock would silently swallow.
        MetricsService,
        OrdersService,
        { provide: OrdersRepository, useValue: ordersRepository },
        { provide: SellersService, useValue: sellersService },
        { provide: CartService, useValue: cartService },
        { provide: ProductsService, useValue: productsService },
        { provide: BiddingService, useValue: biddingService },
        { provide: OutboxService, useValue: outboxService },
        { provide: CorrelationIdService, useValue: { getId: () => 'corr-1' } },
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(fakeTx)),
          },
        },
      ],
    }).compile();

    ordersService = moduleRef.get(OrdersService);
  });

  describe('findById', () => {
    it('returns the order for its own buyer', async () => {
      ordersRepository.findById.mockResolvedValue({
        ...buildOrder(),
        sellerOrders: [],
      });

      const order = await ordersService.findById('order-1', buildCaller());
      expect(order.id).toBe('order-1');
    });

    it('IDOR: 404s (not 403) for a different buyer', async () => {
      ordersRepository.findById.mockResolvedValue({
        ...buildOrder({ buyerId: 'someone-else' }),
        sellerOrders: [],
      });

      await expect(
        ordersService.findById('order-1', buildCaller({ id: 'attacker' })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ADMIN can view any order', async () => {
      ordersRepository.findById.mockResolvedValue({
        ...buildOrder({ buyerId: 'someone-else' }),
        sellerOrders: [],
      });

      const order = await ordersService.findById(
        'order-1',
        buildCaller({ id: 'admin-1', role: UserRole.ADMIN }),
      );
      expect(order.id).toBe('order-1');
    });
  });

  describe('findMySellerOrders', () => {
    it("resolves sellerId from the caller's own approved profile, not a client-supplied id", async () => {
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'seller-profile-1', userId: 'caller-1' }),
      );
      ordersRepository.findBySellerId.mockResolvedValue([
        {
          ...buildSellerOrder({ id: 'so-1', sellerId: 'seller-profile-1' }),
          items: [],
          order: {
            id: 'order-1',
            status: SellerOrderStatus.NEW,
            placedAt: NOW,
          },
        },
      ]);

      const result = await ordersService.findMySellerOrders('caller-1');

      expect(
        sellersService.getOwnApprovedSellerProfileOrThrow,
      ).toHaveBeenCalledWith('caller-1');
      // The repository is queried by the RESOLVED profile id, never by
      // anything the caller could have supplied directly.
      expect(ordersRepository.findBySellerId).toHaveBeenCalledWith(
        'seller-profile-1',
      );
      expect(result).toHaveLength(1);
    });

    it('IDOR: rejects a caller with no approved seller profile', async () => {
      sellersService.getOwnApprovedSellerProfileOrThrow.mockRejectedValue(
        new ForbiddenException('No approved seller profile for this account'),
      );

      await expect(
        ordersService.findMySellerOrders('not-a-seller'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(ordersRepository.findBySellerId).not.toHaveBeenCalled();
    });
  });

  describe('checkout', () => {
    function mockCartWith(
      items: Array<{ productId: string; quantity: number }>,
    ) {
      cartService.getOrCreateForBuyer.mockResolvedValue({
        id: 'cart-1',
        buyerId: 'buyer-1',
        createdAt: NOW,
        updatedAt: NOW,
        items: items.map((i, idx) => ({
          id: `item-${idx}`,
          cartId: 'cart-1',
          productId: i.productId,
          quantity: i.quantity,
          addedAt: NOW,
        })),
      });
    }

    it('rejects checkout with an empty cart', async () => {
      mockCartWith([]);

      await expect(ordersService.checkout('buyer-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('multi-vendor cart: splits items by seller into one SellerOrder each, with correct items', async () => {
      mockCartWith([
        { productId: 'product-a', quantity: 2 },
        { productId: 'product-b', quantity: 1 },
        { productId: 'product-c', quantity: 3 },
      ]);
      productsService.findManyWithInventoryForCheckout.mockResolvedValue([
        buildProduct({
          id: 'product-a',
          sellerId: 'seller-a',
          basePrice: '10.00' as never,
          inventory: { quantityAvailable: 10 } as never,
        }),
        buildProduct({
          id: 'product-b',
          sellerId: 'seller-b',
          basePrice: '20.00' as never,
          inventory: { quantityAvailable: 10 } as never,
        }),
        buildProduct({
          id: 'product-c',
          sellerId: 'seller-a',
          basePrice: '5.00' as never,
          inventory: { quantityAvailable: 10 } as never,
        }),
      ]);
      productsService.reserveStockForCheckout.mockResolvedValue(undefined);
      sellersService.findById.mockImplementation((id: string) =>
        Promise.resolve(buildSellerProfile({ id, userId: `${id}-user` })),
      );
      ordersRepository.createFromCheckout.mockResolvedValue({
        order: buildOrder({ id: 'order-1' }),
        sellerOrders: [
          buildSellerOrder({ id: 'so-a', sellerId: 'seller-a' }),
          buildSellerOrder({ id: 'so-b', sellerId: 'seller-b' }),
        ],
      });

      await ordersService.checkout('buyer-1');

      // Correct SellerOrder count / correct item splitting: two sellers
      // (a, c share seller-a; b is seller-b) -> two seller lines.
      const [, checkoutInput] =
        ordersRepository.createFromCheckout.mock.calls[0];
      expect(checkoutInput.sellerLines).toHaveLength(2);
      const sellerALine = checkoutInput.sellerLines.find(
        (l: { sellerId: string }) => l.sellerId === 'seller-a',
      );
      const sellerBLine = checkoutInput.sellerLines.find(
        (l: { sellerId: string }) => l.sellerId === 'seller-b',
      );
      if (!sellerALine || !sellerBLine) {
        throw new Error('expected both seller lines to be present');
      }
      expect(sellerALine.items).toHaveLength(2); // product-a + product-c
      expect(sellerALine.subtotal).toBeCloseTo(2 * 10 + 3 * 5); // 35
      expect(sellerBLine.items).toHaveLength(1);
      expect(sellerBLine.subtotal).toBeCloseTo(20);

      // Correct inventory decrement: one call per line item, every
      // product in the cart.
      expect(productsService.reserveStockForCheckout).toHaveBeenCalledTimes(3);
      expect(productsService.reserveStockForCheckout).toHaveBeenCalledWith(
        fakeTx,
        'product-a',
        2,
      );
      expect(productsService.reserveStockForCheckout).toHaveBeenCalledWith(
        fakeTx,
        'product-b',
        1,
      );
      expect(productsService.reserveStockForCheckout).toHaveBeenCalledWith(
        fakeTx,
        'product-c',
        3,
      );

      // Cart closed out (funnel session converted + items cleared) in the
      // same transaction, against the order that was just created.
      expect(cartService.completeCheckout).toHaveBeenCalledWith(
        fakeTx,
        'cart-1',
        'order-1',
      );
    });

    it('records a SellerOrderCreated event per SellerOrder and one OrderPlaced event, all with the request correlationId', async () => {
      mockCartWith([{ productId: 'product-a', quantity: 1 }]);
      productsService.findManyWithInventoryForCheckout.mockResolvedValue([
        buildProduct({
          id: 'product-a',
          sellerId: 'seller-a',
          basePrice: '10.00' as never,
          inventory: { quantityAvailable: 10 } as never,
        }),
      ]);
      sellersService.findById.mockResolvedValue(
        buildSellerProfile({ id: 'seller-a', userId: 'seller-a-user' }),
      );
      ordersRepository.createFromCheckout.mockResolvedValue({
        order: buildOrder({ id: 'order-1' }),
        sellerOrders: [buildSellerOrder({ id: 'so-a', sellerId: 'seller-a' })],
      });

      await ordersService.checkout('buyer-1');

      expect(outboxService.record).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({
          eventType: 'SellerOrderCreated',
          aggregateType: 'SellerOrder',
          aggregateId: 'so-a',
          correlationId: 'corr-1',
          payload: expect.objectContaining({ sellerUserId: 'seller-a-user' }),
        }),
      );
      expect(outboxService.record).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({
          eventType: 'OrderPlaced',
          aggregateType: 'Order',
          aggregateId: 'order-1',
          correlationId: 'corr-1',
        }),
      );
    });

    // Product deactivated after being added to cart.
    it('rejects checkout when a cart item was archived after being added', async () => {
      mockCartWith([{ productId: 'product-a', quantity: 1 }]);
      productsService.findManyWithInventoryForCheckout.mockResolvedValue([
        buildProduct({
          id: 'product-a',
          status: ProductStatus.ARCHIVED,
          inventory: { quantityAvailable: 10 } as never,
        }),
      ]);

      await expect(ordersService.checkout('buyer-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(ordersRepository.createFromCheckout).not.toHaveBeenCalled();
      expect(cartService.completeCheckout).not.toHaveBeenCalled();
    });

    it('rejects checkout when a cart item no longer exists at all', async () => {
      mockCartWith([{ productId: 'product-a', quantity: 1 }]);
      productsService.findManyWithInventoryForCheckout.mockResolvedValue([]);

      await expect(ordersService.checkout('buyer-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    // Insufficient stock.
    it('rejects checkout when requested quantity exceeds available stock', async () => {
      mockCartWith([{ productId: 'product-a', quantity: 5 }]);
      productsService.findManyWithInventoryForCheckout.mockResolvedValue([
        buildProduct({
          id: 'product-a',
          inventory: { quantityAvailable: 2 } as never,
        }),
      ]);

      await expect(ordersService.checkout('buyer-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(productsService.reserveStockForCheckout).not.toHaveBeenCalled();
    });

    // Transaction rollback: if the atomic decrement conflicts (e.g. a
    // concurrent checkout won the race between our read and our write),
    // the WHOLE checkout must fail — never a partially-decremented,
    // partially-ordered result.
    it('rolls back (rejects) the whole checkout if a stock decrement conflicts mid-transaction', async () => {
      mockCartWith([
        { productId: 'product-a', quantity: 1 },
        { productId: 'product-b', quantity: 1 },
      ]);
      productsService.findManyWithInventoryForCheckout.mockResolvedValue([
        buildProduct({
          id: 'product-a',
          inventory: { quantityAvailable: 10 } as never,
        }),
        buildProduct({
          id: 'product-b',
          inventory: { quantityAvailable: 10 } as never,
        }),
      ]);
      productsService.reserveStockForCheckout
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(
          new Error('Insufficient stock for product product-b'),
        );

      await expect(ordersService.checkout('buyer-1')).rejects.toThrow(
        'Insufficient stock for product product-b',
      );
      // Never reaches order creation or cart clearing once one line fails.
      expect(ordersRepository.createFromCheckout).not.toHaveBeenCalled();
      expect(cartService.completeCheckout).not.toHaveBeenCalled();
    });

    it('rejects an AUCTION-type product defensively even though the cart should never contain one', async () => {
      mockCartWith([{ productId: 'product-a', quantity: 1 }]);
      productsService.findManyWithInventoryForCheckout.mockResolvedValue([
        buildProduct({
          id: 'product-a',
          type: ProductType.AUCTION,
          inventory: { quantityAvailable: 10 } as never,
        }),
      ]);

      await expect(ordersService.checkout('buyer-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('checkoutAuctionWin', () => {
    beforeEach(() => {
      productsService.findManyWithInventoryForCheckout.mockResolvedValue([
        buildProduct({
          id: 'product-1',
          type: ProductType.AUCTION,
          inventory: { quantityAvailable: 10, quantityReserved: 0 } as never,
        }),
      ]);
      productsService.reserveStockForCheckout.mockResolvedValue(undefined);
      sellersService.findById.mockResolvedValue(
        buildSellerProfile({ id: 'seller-profile-1' }),
      );
      ordersRepository.createFromCheckout.mockResolvedValue({
        order: buildOrder(),
        sellerOrders: [buildSellerOrder()],
      });
    });

    // A single-unit lot (the common case) is exactly the winning bid —
    // no division, so no rounding question even arises.
    it('a single-unit win checks out at exactly the winning bid, for 1 unit', async () => {
      biddingService.findAuctionById.mockResolvedValue(
        buildAuction({ quantity: 1, currentHighestBid: '100.00' as never }),
      );

      await ordersService.checkoutAuctionWin('auction-1', 'buyer-1');

      const [, checkoutInput] =
        ordersRepository.createFromCheckout.mock.calls[0];
      // The order line carries the lot size, which is what the shipment
      // will later commit against the auction's existing hold.
      expect(checkoutInput.sellerLines[0].items[0].quantity).toBe(1);
      expect(checkoutInput.sellerLines[0].subtotal).toBe(100);
    });

    // The winning bid is a LOT price for the whole quantity, not a
    // per-unit price — decrementing `quantity` units at `bid / quantity`
    // each must still total back to the actual amount the winner bid.
    it('a multi-unit win carries the full lot size and totals back to the winning bid', async () => {
      biddingService.findAuctionById.mockResolvedValue(
        buildAuction({ quantity: 4, currentHighestBid: '100.00' as never }),
      );

      await ordersService.checkoutAuctionWin('auction-1', 'buyer-1');

      const [, checkoutInput] =
        ordersRepository.createFromCheckout.mock.calls[0];
      expect(checkoutInput.sellerLines[0].subtotal).toBe(100);
      expect(checkoutInput.sellerLines[0].items[0]).toMatchObject({
        productId: 'product-1',
        quantity: 4,
        unitPrice: 25,
      });
    });

    // The lot has been held since the auction was created, and a checkout
    // reservation is that same counter — so the hold simply BECOMES the
    // order's reservation. Releasing and immediately re-reserving would
    // net to nothing while briefly making the units look free, so the
    // win must do neither.
    it('carries the auction hold over into the order instead of releasing and re-reserving it', async () => {
      biddingService.findAuctionById.mockResolvedValue(
        buildAuction({ quantity: 2 }),
      );

      await ordersService.checkoutAuctionWin('auction-1', 'buyer-1');

      expect(productsService.releaseAuctionReservation).not.toHaveBeenCalled();
      expect(productsService.reserveStockForCheckout).not.toHaveBeenCalled();
    });

    it('marks the auction COMPLETED in the same transaction as the order', async () => {
      biddingService.findAuctionById.mockResolvedValue(buildAuction());

      await ordersService.checkoutAuctionWin('auction-1', 'buyer-1');

      expect(biddingService.markAuctionCompleted).toHaveBeenCalledWith(
        fakeTx,
        'auction-1',
      );
    });

    it('rejects if the auctioned product is no longer ACTIVE', async () => {
      biddingService.findAuctionById.mockResolvedValue(buildAuction());
      productsService.findManyWithInventoryForCheckout.mockResolvedValue([
        buildProduct({
          id: 'product-1',
          type: ProductType.AUCTION,
          status: ProductStatus.ARCHIVED,
          inventory: { quantityAvailable: 10, quantityReserved: 0 } as never,
        }),
      ]);

      await expect(
        ordersService.checkoutAuctionWin('auction-1', 'buyer-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(ordersRepository.createFromCheckout).not.toHaveBeenCalled();
    });
  });

  describe('updateSellerOrderStatus', () => {
    // The whole point of reserve-on-checkout: units sit in
    // quantityReserved from checkout until the seller actually ships,
    // and shipping is the only thing that reduces real stock.
    it('commits the reserved units when the seller ships', async () => {
      ordersRepository.findSellerOrderById.mockResolvedValue(
        buildSellerOrder({
          sellerId: 'my-profile',
          status: SellerOrderStatus.PROCESSING,
        }),
      );
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'my-profile' }),
      );
      ordersRepository.updateSellerOrderStatus.mockResolvedValue(
        buildSellerOrder({ status: SellerOrderStatus.SHIPPED }),
      );
      ordersRepository.findOrderItemsForSellerOrder.mockResolvedValue([
        { productId: 'product-1', quantity: 2 } as never,
      ]);
      ordersRepository.findSellerOrderStatusesForOrder.mockResolvedValue([
        SellerOrderStatus.SHIPPED,
      ]);

      await ordersService.updateSellerOrderStatus(
        'so-1',
        buildCaller({ id: 'seller-user' }),
        { status: SellerOrderStatus.SHIPPED },
      );

      expect(productsService.commitReservationForShipment).toHaveBeenCalledWith(
        fakeTx,
        'product-1',
        2,
      );
      // Never a plain restock — shipping consumes, it does not return.
      expect(
        productsService.releaseReservationForCancellation,
      ).not.toHaveBeenCalled();
    });

    // A cancelled order's units never left quantityAvailable, so they
    // are released, not restored.
    it('releases the hold when the order is cancelled, and commits nothing', async () => {
      ordersRepository.findSellerOrderById.mockResolvedValue(
        buildSellerOrder({
          sellerId: 'my-profile',
          status: SellerOrderStatus.PROCESSING,
        }),
      );
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'my-profile' }),
      );
      ordersRepository.updateSellerOrderStatus.mockResolvedValue(
        buildSellerOrder({ status: SellerOrderStatus.CANCELLED }),
      );
      ordersRepository.findOrderItemsForSellerOrder.mockResolvedValue([
        { productId: 'product-1', quantity: 2 } as never,
      ]);
      ordersRepository.findSellerOrderStatusesForOrder.mockResolvedValue([
        SellerOrderStatus.CANCELLED,
      ]);

      await ordersService.updateSellerOrderStatus(
        'so-1',
        buildCaller({ id: 'seller-user' }),
        { status: SellerOrderStatus.CANCELLED },
      );

      expect(
        productsService.releaseReservationForCancellation,
      ).toHaveBeenCalledWith(fakeTx, 'product-1', 2);
      expect(
        productsService.commitReservationForShipment,
      ).not.toHaveBeenCalled();
    });

    // The whole point of the admin override: a dispute ruling has to be
    // enactable even after the seller has already shipped. Ordinarily
    // SHIPPED -> CANCELLED is not a valid transition at all.
    it.each([SellerOrderStatus.SHIPPED, SellerOrderStatus.COMPLETED])(
      'lets an ADMIN force-cancel a %s order, restocking rather than releasing',
      async (fromStatus) => {
        ordersRepository.findSellerOrderById.mockResolvedValue(
          buildSellerOrder({
            sellerId: 'some-sellers-profile',
            status: fromStatus,
          }),
        );
        ordersRepository.updateSellerOrderStatus.mockResolvedValue(
          buildSellerOrder({ status: SellerOrderStatus.CANCELLED }),
        );
        ordersRepository.findOrderItemsForSellerOrder.mockResolvedValue([
          { productId: 'product-1', quantity: 2 } as never,
        ]);
        ordersRepository.findSellerOrderStatusesForOrder.mockResolvedValue([
          SellerOrderStatus.CANCELLED,
        ]);

        await ordersService.updateSellerOrderStatus(
          'so-1',
          buildCaller({ id: 'admin-1', role: UserRole.ADMIN }),
          { status: SellerOrderStatus.CANCELLED },
        );

        // The units already left quantityReserved at SHIPMENT — this is
        // a genuine restock, not a release of a hold that no longer
        // exists.
        expect(
          productsService.returnStockAfterForceCancellation,
        ).toHaveBeenCalledWith(fakeTx, 'product-1', 2);
        expect(
          productsService.releaseReservationForCancellation,
        ).not.toHaveBeenCalled();
      },
    );

    // The seller does NOT get this override — only an admin can cancel a
    // shipment that already went out, which is what makes it possible
    // for a dispute ruling to actually be enacted rather than merely
    // recorded.
    it.each([SellerOrderStatus.SHIPPED, SellerOrderStatus.COMPLETED])(
      'still refuses a SELLER cancelling their own %s order',
      async (fromStatus) => {
        ordersRepository.findSellerOrderById.mockResolvedValue(
          buildSellerOrder({ sellerId: 'my-profile', status: fromStatus }),
        );
        sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
          buildSellerProfile({ id: 'my-profile' }),
        );

        await expect(
          ordersService.updateSellerOrderStatus(
            'so-1',
            buildCaller({ id: 'seller-user' }),
            { status: SellerOrderStatus.CANCELLED },
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(
          productsService.returnStockAfterForceCancellation,
        ).not.toHaveBeenCalled();
        expect(
          productsService.releaseReservationForCancellation,
        ).not.toHaveBeenCalled();
      },
    );

    it('allows a valid transition (NEW -> PROCESSING) by the owning seller', async () => {
      ordersRepository.findSellerOrderById.mockResolvedValue(
        buildSellerOrder({
          sellerId: 'my-profile',
          status: SellerOrderStatus.NEW,
        }),
      );
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'my-profile' }),
      );
      ordersRepository.updateSellerOrderStatus.mockResolvedValue(
        buildSellerOrder({ status: SellerOrderStatus.PROCESSING }),
      );
      ordersRepository.findSellerOrderStatusesForOrder.mockResolvedValue([
        SellerOrderStatus.PROCESSING,
      ]);

      const result = await ordersService.updateSellerOrderStatus(
        'seller-order-1',
        buildCaller({ id: 'seller-user-1', role: UserRole.SELLER }),
        { status: SellerOrderStatus.PROCESSING },
      );

      expect(result.status).toBe(SellerOrderStatus.PROCESSING);
      expect(ordersRepository.updateOrderStatus).toHaveBeenCalled();
      expect(outboxService.record).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({ eventType: 'SellerOrderStatusChanged' }),
      );
    });

    it('rejects an invalid transition (NEW -> SHIPPED, skipping PROCESSING)', async () => {
      ordersRepository.findSellerOrderById.mockResolvedValue(
        buildSellerOrder({
          sellerId: 'my-profile',
          status: SellerOrderStatus.NEW,
        }),
      );
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'my-profile' }),
      );

      await expect(
        ordersService.updateSellerOrderStatus(
          'seller-order-1',
          buildCaller({ id: 'seller-user-1', role: UserRole.SELLER }),
          { status: SellerOrderStatus.SHIPPED },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(ordersRepository.updateSellerOrderStatus).not.toHaveBeenCalled();
    });

    it('rejects a transition out of a terminal state (COMPLETED -> CANCELLED)', async () => {
      ordersRepository.findSellerOrderById.mockResolvedValue(
        buildSellerOrder({
          sellerId: 'my-profile',
          status: SellerOrderStatus.COMPLETED,
        }),
      );
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'my-profile' }),
      );

      await expect(
        ordersService.updateSellerOrderStatus(
          'seller-order-1',
          buildCaller({ id: 'seller-user-1', role: UserRole.SELLER }),
          { status: SellerOrderStatus.CANCELLED },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('IDOR: rejects a seller who does not own this SellerOrder', async () => {
      ordersRepository.findSellerOrderById.mockResolvedValue(
        buildSellerOrder({ sellerId: 'someone-elses-profile' }),
      );
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'my-profile' }),
      );

      await expect(
        ordersService.updateSellerOrderStatus(
          'seller-order-1',
          buildCaller({ id: 'attacker-seller', role: UserRole.SELLER }),
          { status: SellerOrderStatus.PROCESSING },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ADMIN bypasses ownership entirely', async () => {
      ordersRepository.findSellerOrderById.mockResolvedValue(
        buildSellerOrder({
          sellerId: 'someone-elses-profile',
          status: SellerOrderStatus.NEW,
        }),
      );
      ordersRepository.updateSellerOrderStatus.mockResolvedValue(
        buildSellerOrder({ status: SellerOrderStatus.PROCESSING }),
      );
      ordersRepository.findSellerOrderStatusesForOrder.mockResolvedValue([
        SellerOrderStatus.PROCESSING,
      ]);

      await ordersService.updateSellerOrderStatus(
        'seller-order-1',
        buildCaller({ id: 'admin-1', role: UserRole.ADMIN }),
        { status: SellerOrderStatus.PROCESSING },
      );

      expect(
        sellersService.getOwnApprovedSellerProfileOrThrow,
      ).not.toHaveBeenCalled();
    });

    // Stock restoration + partial cancellation: cancelling ONE seller's
    // part of a multi-vendor order restores stock for exactly that
    // SellerOrder's items and touches no other SellerOrder.
    it('cancellation restores stock for every item under this SellerOrder and reverses its ledger entries', async () => {
      const cancelledOrder = buildSellerOrder({
        id: 'seller-order-1',
        sellerId: 'my-profile',
        status: SellerOrderStatus.NEW,
        subtotal: '35.00' as never,
      });
      ordersRepository.findSellerOrderById.mockResolvedValue(cancelledOrder);
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'my-profile' }),
      );
      ordersRepository.updateSellerOrderStatus.mockResolvedValue({
        ...cancelledOrder,
        status: SellerOrderStatus.CANCELLED,
      });
      ordersRepository.findOrderItemsForSellerOrder.mockResolvedValue([
        {
          id: 'oi-1',
          sellerOrderId: 'seller-order-1',
          productId: 'product-a',
          quantity: 2,
          unitPrice: '10.00' as never,
          createdAt: NOW,
        },
        {
          id: 'oi-2',
          sellerOrderId: 'seller-order-1',
          productId: 'product-c',
          quantity: 3,
          unitPrice: '5.00' as never,
          createdAt: NOW,
        },
      ]);
      ordersRepository.findSellerOrderStatusesForOrder.mockResolvedValue([
        SellerOrderStatus.CANCELLED,
      ]);

      await ordersService.updateSellerOrderStatus(
        'seller-order-1',
        buildCaller({ id: 'seller-user-1', role: UserRole.SELLER }),
        { status: SellerOrderStatus.CANCELLED },
      );

      expect(
        productsService.releaseReservationForCancellation,
      ).toHaveBeenCalledWith(fakeTx, 'product-a', 2);
      expect(
        productsService.releaseReservationForCancellation,
      ).toHaveBeenCalledWith(fakeTx, 'product-c', 3);
      expect(
        productsService.releaseReservationForCancellation,
      ).toHaveBeenCalledTimes(2);
      expect(ordersRepository.createLedgerEntries).toHaveBeenCalledWith(
        fakeTx,
        expect.arrayContaining([
          expect.objectContaining({ type: 'REFUND', amount: -35 }),
          expect.objectContaining({ type: 'ADJUSTMENT' }),
        ]),
      );
      // Only this SellerOrder's id was ever touched — a different
      // seller's SellerOrder under the same Order is never referenced.
      expect(ordersRepository.updateSellerOrderStatus).toHaveBeenCalledWith(
        fakeTx,
        'seller-order-1',
        SellerOrderStatus.CANCELLED,
      );
    });
  });

  describe('autoAdvanceToProcessing', () => {
    it('advances NEW -> PROCESSING and recomputes the parent status', async () => {
      ordersRepository.updateSellerOrderStatusIfCurrent.mockResolvedValue(
        buildSellerOrder({ status: SellerOrderStatus.PROCESSING }),
      );
      ordersRepository.findSellerOrderStatusesForOrder.mockResolvedValue([
        SellerOrderStatus.PROCESSING,
      ]);

      await ordersService.autoAdvanceToProcessing(
        fakeTx as never,
        'seller-order-1',
      );

      expect(
        ordersRepository.updateSellerOrderStatusIfCurrent,
      ).toHaveBeenCalledWith(
        fakeTx,
        'seller-order-1',
        SellerOrderStatus.NEW,
        SellerOrderStatus.PROCESSING,
      );
      expect(ordersRepository.updateOrderStatus).toHaveBeenCalled();
    });

    it('is a no-op (idempotent) if the SellerOrder already moved past NEW', async () => {
      ordersRepository.updateSellerOrderStatusIfCurrent.mockResolvedValue(null);

      await ordersService.autoAdvanceToProcessing(
        fakeTx as never,
        'seller-order-1',
      );

      expect(ordersRepository.updateOrderStatus).not.toHaveBeenCalled();
    });
  });
});
