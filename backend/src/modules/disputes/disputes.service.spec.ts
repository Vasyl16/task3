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
import { SellersService } from '../sellers/sellers.service';
import { DisputesRepository } from './domain/disputes.repository';
import { DisputesService } from './disputes.service';
import type { ListDisputesQuery } from './dto/list-disputes.query';

const NOW = new Date();

function buildDispute(overrides: Partial<Dispute> = {}): Dispute {
  return {
    id: 'dispute-1',
    sellerOrderId: 'seller-order-1',
    orderItemId: null,
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

function buildDisputeWithOrder(
  overrides: Partial<Dispute> = {},
  sellerOrderOverrides: { sellerId?: string } = {},
) {
  return {
    ...buildDispute(overrides),
    sellerOrder: {
      id: 'seller-order-1',
      status: SellerOrderStatus.SHIPPED,
      subtotal: '10.00',
      orderId: 'order-1',
      sellerId: sellerOrderOverrides.sellerId ?? 'seller-profile-1',
      items: [],
    },
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
  let sellersService: jest.Mocked<
    Pick<SellersService, 'getOwnApprovedSellerProfileOrThrow' | 'findByUserId'>
  >;

  beforeEach(async () => {
    disputesRepository = {
      findById: jest.fn(),
      findByIdWithOrder: jest.fn(),
      findMany: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      findActiveFor: jest.fn().mockResolvedValue(null),
      findOrderItemInSellerOrder: jest
        .fn()
        .mockResolvedValue({ id: 'order-item-1' }),
      create: jest.fn().mockResolvedValue(buildDispute()),
      resolve: jest.fn(),
      findComments: jest.fn().mockResolvedValue([]),
      addComment: jest.fn(),
    };
    ordersService = {
      findSellerOrderAsBuyer: jest.fn().mockResolvedValue(buildSellerOrder()),
    };
    sellersService = {
      getOwnApprovedSellerProfileOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'seller-profile-1' }),
      // No profile by default — most callers in this suite are buyers or
      // admins, who never reach this path.
      findByUserId: jest.fn().mockResolvedValue(null),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DisputesService,
        { provide: DisputesRepository, useValue: disputesRepository },
        { provide: OrdersService, useValue: ordersService },
        { provide: SellersService, useValue: sellersService },
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
      disputesRepository.findActiveFor.mockResolvedValue(
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
      disputesRepository.findActiveFor.mockResolvedValue(null);

      await disputesService.raise(buildCaller(), {
        sellerOrderId: 'seller-order-1',
        reason: 'A different problem entirely, weeks later',
      });

      expect(disputesRepository.create).toHaveBeenCalled();
    });
  });

  describe('per-item disputes', () => {
    // The point of the feature: four things from one seller, one of them
    // damaged — disputing that line must not implicate the other three.
    it('scopes the duplicate check to the line, so two items can be disputed separately', async () => {
      await disputesService.raise(buildCaller(), {
        sellerOrderId: 'seller-order-1',
        orderItemId: 'order-item-1',
        reason: 'This one arrived cracked down the side',
      });

      expect(disputesRepository.findActiveFor).toHaveBeenCalledWith({
        sellerOrderId: 'seller-order-1',
        orderItemId: 'order-item-1',
      });
      expect(disputesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ orderItemId: 'order-item-1' }),
      );
    });

    it('still allows an order-wide dispute when no line is named', async () => {
      await disputesService.raise(buildCaller(), {
        sellerOrderId: 'seller-order-1',
        reason: 'The whole parcel never turned up at all',
      });

      expect(disputesRepository.findActiveFor).toHaveBeenCalledWith({
        sellerOrderId: 'seller-order-1',
        orderItemId: undefined,
      });
      // No line lookup is needed when there is no line.
      expect(
        disputesRepository.findOrderItemInSellerOrder,
      ).not.toHaveBeenCalled();
    });

    // IDOR: owning the order says nothing about an orderItemId typed
    // into the request, which could belong to someone else's purchase.
    it('rejects a line item that belongs to a different order', async () => {
      disputesRepository.findOrderItemInSellerOrder.mockResolvedValue(null);

      await expect(
        disputesService.raise(buildCaller(), {
          sellerOrderId: 'seller-order-1',
          orderItemId: 'someone-elses-line',
          reason: 'Trying to attach a complaint to a foreign line',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(disputesRepository.create).not.toHaveBeenCalled();
    });

    it('rejects a second dispute on the SAME line while one is pending', async () => {
      disputesRepository.findActiveFor.mockResolvedValue(
        buildDispute({ orderItemId: 'order-item-1' }),
      );

      await expect(
        disputesService.raise(buildCaller(), {
          sellerOrderId: 'seller-order-1',
          orderItemId: 'order-item-1',
          reason: 'Opening a second complaint about the same item',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('listOwn', () => {
    // Two independent protections. ListDisputesQuery has no raisedById
    // field at all, so ValidationPipe's forbidNonWhitelisted rejects one
    // with a 400 before the service is ever reached — and even if it did
    // arrive, the service sets raisedById from the caller itself, so
    // nothing in the query can widen the result set.
    it('always scopes to the caller, whatever the query contained', async () => {
      await disputesService.listOwn(buildCaller({ id: 'buyer-1' }), {
        status: DisputeStatus.OPEN,
        ...({ raisedById: 'someone-else' } as unknown as ListDisputesQuery),
      });

      expect(disputesRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ raisedById: 'buyer-1' }),
      );
    });
  });

  describe('pagination and scoping', () => {
    it('derives skip/take from the page and returns the total alongside the items', async () => {
      disputesRepository.findMany.mockResolvedValue({
        items: [buildDispute()],
        total: 57,
      });

      const result = await disputesService.listForAdmin({ page: 3, limit: 20 });

      expect(disputesRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 40, take: 20 }),
      );
      // The total is the FULL count, not the page length — otherwise a
      // pager cannot know there is anything past the current page.
      expect(result).toMatchObject({ total: 57, page: 3, limit: 20 });
      expect(result.items).toHaveLength(1);
    });

    it('defaults to the first page when none is given', async () => {
      disputesRepository.findMany.mockResolvedValue({ items: [], total: 0 });

      await disputesService.listForAdmin({});

      expect(disputesRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    // A seller sees complaints about their OWN shipments and no others.
    it('scopes a seller to their own approved profile', async () => {
      disputesRepository.findMany.mockResolvedValue({ items: [], total: 0 });

      await disputesService.listForSeller('seller-user', {});

      expect(disputesRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ sellerId: 'seller-profile-1' }),
      );
    });

    it('passes the search term through rather than filtering after the page', async () => {
      disputesRepository.findMany.mockResolvedValue({ items: [], total: 0 });

      await disputesService.listOwn(buildCaller(), { search: 'cracked' });

      expect(disputesRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'cracked', raisedById: 'buyer-1' }),
      );
    });
  });

  describe('findByIdWithOrderForCaller', () => {
    it('IDOR: 404s (not 403) on someone else’s dispute', async () => {
      disputesRepository.findByIdWithOrder.mockResolvedValue(
        buildDisputeWithOrder({ raisedById: 'someone-else' }),
      );

      await expect(
        disputesService.findByIdWithOrderForCaller('dispute-1', buildCaller()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets an admin read any dispute', async () => {
      disputesRepository.findByIdWithOrder.mockResolvedValue(
        buildDisputeWithOrder({ raisedById: 'someone-else' }),
      );

      const dispute = await disputesService.findByIdWithOrderForCaller(
        'dispute-1',
        buildCaller({ id: 'admin-1', role: UserRole.ADMIN }),
      );
      expect(dispute.id).toBe('dispute-1');
    });

    it('lets the buyer who raised it read their own dispute', async () => {
      disputesRepository.findByIdWithOrder.mockResolvedValue(
        buildDisputeWithOrder({ raisedById: 'buyer-1' }),
      );

      const dispute = await disputesService.findByIdWithOrderForCaller(
        'dispute-1',
        buildCaller({ id: 'buyer-1' }),
      );
      expect(dispute.id).toBe('dispute-1');
    });

    // The third party this feature adds: a seller cannot rule on a
    // dispute, but they DID ship the order it's about, so they must be
    // able to see what was said and reply to it.
    it('lets the seller who owns the shipment read the dispute about it', async () => {
      disputesRepository.findByIdWithOrder.mockResolvedValue(
        buildDisputeWithOrder(
          { raisedById: 'someone-else' },
          { sellerId: 'seller-profile-1' },
        ),
      );
      sellersService.findByUserId.mockResolvedValue({
        id: 'seller-profile-1',
      } as never);

      const dispute = await disputesService.findByIdWithOrderForCaller(
        'dispute-1',
        buildCaller({ id: 'seller-user', role: UserRole.SELLER }),
      );
      expect(dispute.id).toBe('dispute-1');
    });

    // IDOR, the seller variant: shipping something for a DIFFERENT
    // dispute's order does not grant access to this one.
    it('IDOR: 404s a seller whose shipment this dispute is NOT about', async () => {
      disputesRepository.findByIdWithOrder.mockResolvedValue(
        buildDisputeWithOrder(
          { raisedById: 'someone-else' },
          { sellerId: 'a-different-seller-profile' },
        ),
      );
      sellersService.findByUserId.mockResolvedValue({
        id: 'seller-profile-1',
      } as never);

      await expect(
        disputesService.findByIdWithOrderForCaller(
          'dispute-1',
          buildCaller({ id: 'seller-user', role: UserRole.SELLER }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('IDOR: 404s a SELLER-role caller with no seller profile at all', async () => {
      disputesRepository.findByIdWithOrder.mockResolvedValue(
        buildDisputeWithOrder({ raisedById: 'someone-else' }),
      );
      sellersService.findByUserId.mockResolvedValue(null);

      await expect(
        disputesService.findByIdWithOrderForCaller(
          'dispute-1',
          buildCaller({ id: 'no-profile-user', role: UserRole.SELLER }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
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
  describe('comments', () => {
    it('lets the buyer who raised it append to the thread', async () => {
      disputesRepository.findByIdWithOrder.mockResolvedValue(
        buildDisputeWithOrder(),
      );
      disputesRepository.addComment.mockResolvedValue({
        id: 'comment-1',
      } as never);

      await disputesService.addComment('dispute-1', buildCaller(), {
        body: 'Still nothing has arrived.',
      });

      expect(disputesRepository.addComment).toHaveBeenCalledWith({
        disputeId: 'dispute-1',
        // The author is the caller, never a body field.
        authorId: 'buyer-1',
        body: 'Still nothing has arrived.',
      });
    });

    it('lets an admin reply on a dispute they did not raise', async () => {
      disputesRepository.findByIdWithOrder.mockResolvedValue(
        buildDisputeWithOrder(),
      );
      disputesRepository.addComment.mockResolvedValue({
        id: 'comment-2',
      } as never);

      await disputesService.addComment(
        'dispute-1',
        buildCaller({ id: 'admin-1', role: UserRole.ADMIN }),
        { body: 'Looking into this now.' },
      );

      expect(disputesRepository.addComment).toHaveBeenCalledWith(
        expect.objectContaining({ authorId: 'admin-1' }),
      );
    });

    // The seller did not raise the case and isn't ruling on it, but they
    // shipped the order it's about — they need to be able to answer it,
    // e.g. "tracking shows it was delivered on the 4th."
    it('lets the seller who owns the shipment reply to a dispute about it', async () => {
      disputesRepository.findByIdWithOrder.mockResolvedValue(
        buildDisputeWithOrder(
          { raisedById: 'buyer-1' },
          { sellerId: 'seller-profile-1' },
        ),
      );
      sellersService.findByUserId.mockResolvedValue({
        id: 'seller-profile-1',
      } as never);
      disputesRepository.addComment.mockResolvedValue({
        id: 'comment-3',
      } as never);

      await disputesService.addComment(
        'dispute-1',
        buildCaller({ id: 'seller-user', role: UserRole.SELLER }),
        { body: 'Tracking shows it was delivered on the 4th.' },
      );

      expect(disputesRepository.addComment).toHaveBeenCalledWith(
        expect.objectContaining({ authorId: 'seller-user' }),
      );
    });

    it('IDOR: a third party can neither read nor post, and gets a 404 either way', async () => {
      disputesRepository.findByIdWithOrder.mockResolvedValue(
        buildDisputeWithOrder(),
      );
      const stranger = buildCaller({ id: 'someone-else' });

      await expect(
        disputesService.listComments('dispute-1', stranger),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        disputesService.addComment('dispute-1', stranger, { body: 'hello' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(disputesRepository.addComment).not.toHaveBeenCalled();
    });

    // A seller shipping an UNRELATED order does not earn them a seat in
    // this conversation.
    it('IDOR: a seller whose shipment this dispute is NOT about gets a 404 too', async () => {
      disputesRepository.findByIdWithOrder.mockResolvedValue(
        buildDisputeWithOrder(
          { raisedById: 'buyer-1' },
          { sellerId: 'a-different-seller-profile' },
        ),
      );
      sellersService.findByUserId.mockResolvedValue({
        id: 'seller-profile-1',
      } as never);

      await expect(
        disputesService.addComment(
          'dispute-1',
          buildCaller({ id: 'seller-user', role: UserRole.SELLER }),
          { body: 'hello' },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(disputesRepository.addComment).not.toHaveBeenCalled();
    });

    // Once a ruling is made the thread stops being a record of what was
    // considered before it, so it closes.
    it.each([DisputeStatus.RESOLVED, DisputeStatus.REJECTED])(
      'refuses a new comment once the dispute is %s',
      async (status) => {
        disputesRepository.findByIdWithOrder.mockResolvedValue(
          buildDisputeWithOrder({ status }),
        );

        await expect(
          disputesService.addComment('dispute-1', buildCaller(), {
            body: 'One more thing.',
          }),
        ).rejects.toBeInstanceOf(ConflictException);

        expect(disputesRepository.addComment).not.toHaveBeenCalled();
      },
    );

    it('reads the thread oldest-first, as a conversation', async () => {
      disputesRepository.findByIdWithOrder.mockResolvedValue(
        buildDisputeWithOrder(),
      );

      await disputesService.listComments('dispute-1', buildCaller());

      expect(disputesRepository.findComments).toHaveBeenCalledWith('dispute-1');
    });
  });
});
