import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  DisputeStatus,
  SellerOrderStatus,
  UserRole,
  type Dispute,
  type SellerOrder,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { OrdersService } from '../orders/orders.service';
import { DisputesRepository } from './domain/disputes.repository';
import { DisputesService } from './disputes.service';

const NOW = new Date();

function buildDispute(overrides: Partial<Dispute> = {}): Dispute {
  return {
    id: 'dispute-1',
    sellerOrderId: 'seller-order-1',
    raisedById: 'buyer-1',
    reason: 'Item never arrived after three weeks',
    status: DisputeStatus.OPEN,
    resolution: null,
    resolvedById: null,
    resolvedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

function buildSellerOrder(): SellerOrder {
  return {
    id: 'seller-order-1',
    orderId: 'order-1',
    sellerId: 'seller-1',
    status: SellerOrderStatus.SHIPPED,
    subtotal: '10.00' as unknown as SellerOrder['subtotal'],
    shippingFee: '0' as unknown as SellerOrder['shippingFee'],
    createdAt: NOW,
    updatedAt: NOW,
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

describe('DisputesService', () => {
  let disputesService: DisputesService;
  let disputesRepository: jest.Mocked<DisputesRepository>;
  let ordersService: jest.Mocked<Pick<OrdersService, 'findSellerOrderAsBuyer'>>;

  beforeEach(async () => {
    disputesRepository = {
      findById: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findActiveForSellerOrder: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(buildDispute()),
      resolve: jest.fn(),
    };
    ordersService = {
      findSellerOrderAsBuyer: jest.fn().mockResolvedValue(buildSellerOrder()),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DisputesService,
        { provide: DisputesRepository, useValue: disputesRepository },
        { provide: OrdersService, useValue: ordersService },
      ],
    }).compile();

    disputesService = moduleRef.get(DisputesService);
  });

  describe('raise', () => {
    // IDOR: the raiser is the authenticated caller, and the SellerOrder
    // is verified to be theirs. A body-supplied raisedById would let
    // anyone file a complaint in someone else's name.
    it('records the authenticated caller as the raiser, never a request field', async () => {
      await disputesService.raise(buildCaller({ id: 'real-buyer' }), {
        sellerOrderId: 'seller-order-1',
        reason: 'Item never arrived after three weeks',
      });

      expect(disputesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ raisedById: 'real-buyer' }),
      );
    });

    it('IDOR: cannot raise a dispute on a SellerOrder the caller did not buy', async () => {
      ordersService.findSellerOrderAsBuyer.mockRejectedValue(
        new NotFoundException('SellerOrder seller-order-1 not found'),
      );

      await expect(
        disputesService.raise(buildCaller({ id: 'attacker' }), {
          sellerOrderId: 'seller-order-1',
          reason: 'Give me a refund for someone else’s order',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(disputesRepository.create).not.toHaveBeenCalled();
    });

    it('rejects a second dispute while one is still awaiting a decision', async () => {
      disputesRepository.findActiveForSellerOrder.mockResolvedValue(
        buildDispute({ status: DisputeStatus.UNDER_REVIEW }),
      );

      await expect(
        disputesService.raise(buildCaller(), {
          sellerOrderId: 'seller-order-1',
          reason: 'Still waiting, opening another one',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(disputesRepository.create).not.toHaveBeenCalled();
    });

    // Only OPEN/UNDER_REVIEW block a new one — once a ruling is made,
    // a genuinely new problem with the same order can still be raised.
    it('allows a new dispute once the previous one has been ruled on', async () => {
      disputesRepository.findActiveForSellerOrder.mockResolvedValue(null);

      await disputesService.raise(buildCaller(), {
        sellerOrderId: 'seller-order-1',
        reason: 'A different problem entirely, weeks later',
      });

      expect(disputesRepository.create).toHaveBeenCalled();
    });
  });

  describe('listOwn', () => {
    // The filter is applied after the caller's own id, so a
    // client-supplied raisedById can never widen the result set.
    it('forces the filter to the caller regardless of what was passed', async () => {
      await disputesService.listOwn(buildCaller({ id: 'buyer-1' }), {
        raisedById: 'someone-else',
      });

      expect(disputesRepository.findMany).toHaveBeenCalledWith({
        raisedById: 'buyer-1',
      });
    });
  });

  describe('findByIdForCaller', () => {
    it('IDOR: 404s (not 403) on someone else’s dispute', async () => {
      disputesRepository.findById.mockResolvedValue(
        buildDispute({ raisedById: 'someone-else' }),
      );

      await expect(
        disputesService.findByIdForCaller('dispute-1', buildCaller()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets an admin read any dispute', async () => {
      disputesRepository.findById.mockResolvedValue(
        buildDispute({ raisedById: 'someone-else' }),
      );

      const dispute = await disputesService.findByIdForCaller(
        'dispute-1',
        buildCaller({ id: 'admin-1', role: UserRole.ADMIN }),
      );
      expect(dispute.id).toBe('dispute-1');
    });
  });

  describe('resolve', () => {
    it('records the ruling and the admin who made it', async () => {
      disputesRepository.findById.mockResolvedValue(buildDispute());
      disputesRepository.resolve.mockResolvedValue(
        buildDispute({ status: DisputeStatus.RESOLVED }),
      );

      await disputesService.resolve('dispute-1', 'admin-1', {
        status: DisputeStatus.RESOLVED,
        resolution: 'Refunded in full',
      });

      expect(disputesRepository.resolve).toHaveBeenCalledWith('dispute-1', {
        status: DisputeStatus.RESOLVED,
        resolution: 'Refunded in full',
        resolvedById: 'admin-1',
      });
    });

    it('rejects reopening a dispute that has already been ruled on', async () => {
      disputesRepository.findById.mockResolvedValue(
        buildDispute({ status: DisputeStatus.RESOLVED }),
      );

      await expect(
        disputesService.resolve('dispute-1', 'admin-1', {
          status: DisputeStatus.UNDER_REVIEW,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(disputesRepository.resolve).not.toHaveBeenCalled();
    });

    it('requires written reasoning for a ruling', async () => {
      disputesRepository.findById.mockResolvedValue(buildDispute());

      await expect(
        disputesService.resolve('dispute-1', 'admin-1', {
          status: DisputeStatus.REJECTED,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(disputesRepository.resolve).not.toHaveBeenCalled();
    });

    it('does not accept whitespace as reasoning', async () => {
      disputesRepository.findById.mockResolvedValue(buildDispute());

      await expect(
        disputesService.resolve('dispute-1', 'admin-1', {
          status: DisputeStatus.RESOLVED,
          resolution: '   ',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows acknowledgement without reasoning', async () => {
      disputesRepository.findById.mockResolvedValue(buildDispute());
      disputesRepository.resolve.mockResolvedValue(
        buildDispute({ status: DisputeStatus.UNDER_REVIEW }),
      );

      await disputesService.resolve('dispute-1', 'admin-1', {
        status: DisputeStatus.UNDER_REVIEW,
      });

      expect(disputesRepository.resolve).toHaveBeenCalled();
    });

    it('404s on an unknown dispute', async () => {
      disputesRepository.findById.mockResolvedValue(null);

      await expect(
        disputesService.resolve('nope', 'admin-1', {
          status: DisputeStatus.RESOLVED,
          resolution: 'x',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
