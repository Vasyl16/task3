import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  UserRole,
  type Order,
  type SellerOrder,
  type SellerProfile,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { CartService } from '../cart/cart.service';
import { SellersService } from '../sellers/sellers.service';
import { OrdersRepository } from './domain/orders.repository';
import { OrdersService } from './orders.service';

const NOW = new Date();

function buildOrder(overrides: Partial<Order> = {}): Order & {
  sellerOrders: SellerOrder[];
} {
  return {
    id: 'order-1',
    buyerId: 'buyer-1',
    status: 'PENDING',
    totalAmount: '10.00' as unknown as Order['totalAmount'],
    placedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    sellerOrders: [],
    ...overrides,
  };
}

function buildSellerOrder(overrides: Partial<SellerOrder> = {}): SellerOrder {
  return {
    id: 'seller-order-1',
    orderId: 'order-1',
    sellerId: 'seller-profile-1',
    status: 'PENDING',
    subtotal: '10.00' as unknown as SellerOrder['subtotal'],
    shippingFee: '0' as unknown as SellerOrder['shippingFee'],
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
    Pick<SellersService, 'getOwnApprovedSellerProfileOrThrow'>
  >;
  let cartService: jest.Mocked<Pick<CartService, 'getOrCreateForBuyer'>>;

  beforeEach(async () => {
    ordersRepository = {
      findByBuyerId: jest.fn(),
      findById: jest.fn(),
      findSellerOrderById: jest.fn(),
    };
    sellersService = { getOwnApprovedSellerProfileOrThrow: jest.fn() };
    cartService = { getOrCreateForBuyer: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: OrdersRepository, useValue: ordersRepository },
        { provide: SellersService, useValue: sellersService },
        { provide: CartService, useValue: cartService },
      ],
    }).compile();

    ordersService = moduleRef.get(OrdersService);
  });

  describe('findById', () => {
    it('returns the order for its own buyer', async () => {
      ordersRepository.findById.mockResolvedValue(buildOrder());

      const order = await ordersService.findById('order-1', buildCaller());
      expect(order.id).toBe('order-1');
    });

    it('IDOR: 404s (not 403) for a different buyer', async () => {
      ordersRepository.findById.mockResolvedValue(
        buildOrder({ buyerId: 'someone-else' }),
      );

      await expect(
        ordersService.findById('order-1', buildCaller({ id: 'attacker' })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ADMIN can view any order', async () => {
      ordersRepository.findById.mockResolvedValue(
        buildOrder({ buyerId: 'someone-else' }),
      );

      const order = await ordersService.findById(
        'order-1',
        buildCaller({ id: 'admin-1', role: UserRole.ADMIN }),
      );
      expect(order.id).toBe('order-1');
    });
  });

  describe('updateSellerOrderStatus', () => {
    it('allows the owning seller', async () => {
      ordersRepository.findSellerOrderById.mockResolvedValue(
        buildSellerOrder({ sellerId: 'my-profile' }),
      );
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue({
        id: 'my-profile',
      } as SellerProfile);

      await expect(
        ordersService.updateSellerOrderStatus(
          'seller-order-1',
          buildCaller({ id: 'seller-user-1', role: UserRole.SELLER }),
          { status: 'CONFIRMED' },
        ),
        // Still a stub past the ownership check — NotImplementedException
        // is the expected, correct outcome once ownership passes.
      ).rejects.toThrow('OrdersService.updateSellerOrderStatus');
    });

    it('IDOR: rejects a seller who does not own this SellerOrder', async () => {
      ordersRepository.findSellerOrderById.mockResolvedValue(
        buildSellerOrder({ sellerId: 'someone-elses-profile' }),
      );
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue({
        id: 'my-profile',
      } as SellerProfile);

      await expect(
        ordersService.updateSellerOrderStatus(
          'seller-order-1',
          buildCaller({ id: 'attacker-seller', role: UserRole.SELLER }),
          { status: 'CONFIRMED' },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ADMIN bypasses ownership entirely', async () => {
      ordersRepository.findSellerOrderById.mockResolvedValue(
        buildSellerOrder({ sellerId: 'someone-elses-profile' }),
      );

      await expect(
        ordersService.updateSellerOrderStatus(
          'seller-order-1',
          buildCaller({ id: 'admin-1', role: UserRole.ADMIN }),
          { status: 'CONFIRMED' },
        ),
      ).rejects.toThrow('OrdersService.updateSellerOrderStatus');
      expect(
        sellersService.getOwnApprovedSellerProfileOrThrow,
      ).not.toHaveBeenCalled();
    });
  });
});
