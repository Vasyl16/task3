import { OrderStatus, SellerOrderStatus, UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import type { PrismaService } from '../prisma/prisma.service';
import { RealtimeAckError } from './realtime-message.interface';
import { RealtimeRoomsService } from './realtime-rooms.service';
import { parseRoom, type ParsedRoom } from './realtime.constants';

function room(name: string): ParsedRoom {
  const parsed = parseRoom(name);
  if (!parsed) {
    throw new Error(`test used an invalid room name: ${name}`);
  }
  return parsed;
}

function buildUser(overrides: Partial<AuthenticatedUser> = {}) {
  return {
    id: 'user-1',
    email: 'buyer@example.com',
    role: UserRole.CUSTOMER,
    ...overrides,
  };
}

describe('RealtimeRoomsService', () => {
  let service: RealtimeRoomsService;
  let prisma: {
    order: { findUnique: jest.Mock };
    sellerOrder: { findUnique: jest.Mock };
    product: { findUnique: jest.Mock };
    auction: { findUnique: jest.Mock };
    notification: { count: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      order: { findUnique: jest.fn() },
      sellerOrder: { findUnique: jest.fn() },
      product: { findUnique: jest.fn() },
      auction: { findUnique: jest.fn() },
      notification: { count: jest.fn() },
    };
    service = new RealtimeRoomsService(prisma as unknown as PrismaService);
  });

  describe('authorize', () => {
    it('lets an anonymous connection watch public product and auction rooms', async () => {
      await expect(
        service.authorize(room('product:p1'), null),
      ).resolves.toEqual({ allowed: true });
      await expect(
        service.authorize(room('auction:a1'), null),
      ).resolves.toEqual({ allowed: true });
      // No database round-trip is needed to answer a public room.
      expect(prisma.order.findUnique).not.toHaveBeenCalled();
    });

    it('refuses an anonymous connection on an order room', async () => {
      await expect(service.authorize(room('order:o1'), null)).resolves.toEqual({
        allowed: false,
        error: RealtimeAckError.UNAUTHENTICATED,
        message: expect.any(String) as string,
      });
    });

    it('lets the buyer watch their own order', async () => {
      prisma.order.findUnique.mockResolvedValue({ buyerId: 'user-1' });

      await expect(
        service.authorize(room('order:o1'), buildUser()),
      ).resolves.toEqual({ allowed: true });
    });

    // The IDOR case: an authenticated stranger guessing an order id.
    it('refuses a different user’s order, and does not confirm the order exists', async () => {
      prisma.order.findUnique.mockResolvedValue({ buyerId: 'someone-else' });

      const result = await service.authorize(
        room('order:o1'),
        buildUser({ id: 'attacker' }),
      );

      expect(result).toEqual({
        allowed: false,
        // NOT_FOUND rather than FORBIDDEN — an attacker learns nothing
        // about which order ids are real.
        error: RealtimeAckError.NOT_FOUND,
        message: expect.any(String) as string,
      });
    });

    it('returns the same NOT_FOUND for a genuinely missing order', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      const result = await service.authorize(room('order:o1'), buildUser());

      expect(result).toEqual({
        allowed: false,
        error: RealtimeAckError.NOT_FOUND,
        message: expect.any(String) as string,
      });
    });

    it('lets an ADMIN watch any order without an ownership lookup', async () => {
      await expect(
        service.authorize(
          room('order:o1'),
          buildUser({ id: 'admin-1', role: UserRole.ADMIN }),
        ),
      ).resolves.toEqual({ allowed: true });
      expect(prisma.order.findUnique).not.toHaveBeenCalled();
    });

    // Both sides of a SellerOrder have a legitimate reason to watch it.
    it('lets the fulfilling seller watch a seller-order room', async () => {
      prisma.sellerOrder.findUnique.mockResolvedValue({
        order: { buyerId: 'someone-else' },
        seller: { userId: 'seller-user' },
      });

      await expect(
        service.authorize(
          room('seller-order:s1'),
          buildUser({ id: 'seller-user', role: UserRole.SELLER }),
        ),
      ).resolves.toEqual({ allowed: true });
    });

    it('lets the buyer of the parent order watch a seller-order room', async () => {
      prisma.sellerOrder.findUnique.mockResolvedValue({
        order: { buyerId: 'user-1' },
        seller: { userId: 'seller-user' },
      });

      await expect(
        service.authorize(room('seller-order:s1'), buildUser()),
      ).resolves.toEqual({ allowed: true });
    });

    // The multi-vendor leak that matters: seller B must not be able to
    // watch seller A's half of a shared order.
    it('refuses an unrelated seller on someone else’s seller-order', async () => {
      prisma.sellerOrder.findUnique.mockResolvedValue({
        order: { buyerId: 'user-1' },
        seller: { userId: 'seller-a' },
      });

      const result = await service.authorize(
        room('seller-order:s1'),
        buildUser({ id: 'seller-b', role: UserRole.SELLER }),
      );

      expect(result).toEqual({
        allowed: false,
        error: RealtimeAckError.NOT_FOUND,
        message: expect.any(String) as string,
      });
    });

    it('lets a user watch their own notification room', async () => {
      await expect(
        service.authorize(room('notification:user-1'), buildUser()),
      ).resolves.toEqual({ allowed: true });
    });

    // The IDOR case: no DB lookup even happens — the room id IS the
    // userId, so a mismatch is refused without ever touching Postgres.
    it('refuses a user watching someone else’s notification room', async () => {
      const result = await service.authorize(
        room('notification:someone-else'),
        buildUser({ id: 'attacker' }),
      );

      expect(result).toEqual({
        allowed: false,
        error: RealtimeAckError.NOT_FOUND,
        message: expect.any(String) as string,
      });
      expect(prisma.notification.count).not.toHaveBeenCalled();
    });
  });

  describe('snapshot', () => {
    it('reads a product room’s current stock straight from Postgres', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'ACTIVE',
        inventory: {
          quantityAvailable: 4,
          quantityReserved: 1,
          version: 9,
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      });

      const snapshot = await service.snapshot(room('product:p1'));

      expect(snapshot).toMatchObject({
        room: 'product:p1',
        authoritativeSource: 'GET /products/p1',
        state: {
          productId: 'p1',
          quantityAvailable: 4,
          quantityReserved: 1,
          version: 9,
        },
      });
    });

    // A product row can exist without an inventory row; the snapshot
    // must still be well-formed rather than throwing at the client.
    it('reports zero stock for a product with no inventory row', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'ACTIVE',
        inventory: null,
      });

      const snapshot = await service.snapshot(room('product:p1'));

      expect(snapshot?.state).toMatchObject({
        quantityAvailable: 0,
        quantityReserved: 0,
        updatedAt: null,
      });
    });

    it('serializes auction Decimal columns as strings, never floats', async () => {
      prisma.auction.findUnique.mockResolvedValue({
        id: 'a1',
        productId: 'p1',
        status: 'ACTIVE',
        startingPrice: { toString: () => '10.00' },
        minBidIncrement: { toString: () => '1.50' },
        currentHighestBid: { toString: () => '12.50' },
        currentHighestBidderId: 'user-9',
        version: 3,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        endsAt: new Date('2026-01-02T00:00:00.000Z'),
        checkoutDeadline: null,
      });

      const snapshot = await service.snapshot(room('auction:a1'));

      expect(snapshot?.state).toMatchObject({
        currentHighestBid: '12.50',
        minBidIncrement: '1.50',
        startingPrice: '10.00',
        version: 3,
      });
    });

    it('includes every SellerOrder in an order snapshot, so a reconnecting client sees the whole order', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        status: OrderStatus.PARTIALLY_SHIPPED,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        sellerOrders: [
          {
            id: 's1',
            sellerId: 'seller-a',
            status: SellerOrderStatus.SHIPPED,
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
          {
            id: 's2',
            sellerId: 'seller-b',
            status: SellerOrderStatus.PROCESSING,
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ],
      });

      const snapshot = await service.snapshot(room('order:o1'));

      expect(snapshot?.state).toMatchObject({
        orderId: 'o1',
        status: OrderStatus.PARTIALLY_SHIPPED,
        sellerOrders: [
          { sellerOrderId: 's1', status: SellerOrderStatus.SHIPPED },
          { sellerOrderId: 's2', status: SellerOrderStatus.PROCESSING },
        ],
      });
    });

    it('points a seller-order snapshot at its parent order as the authoritative source', async () => {
      prisma.sellerOrder.findUnique.mockResolvedValue({
        id: 's1',
        orderId: 'o1',
        sellerId: 'seller-a',
        status: SellerOrderStatus.PROCESSING,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        order: { status: OrderStatus.PROCESSING },
      });

      const snapshot = await service.snapshot(room('seller-order:s1'));

      expect(snapshot?.authoritativeSource).toBe('GET /orders/o1');
      expect(snapshot?.state).toMatchObject({
        sellerOrderId: 's1',
        status: SellerOrderStatus.PROCESSING,
        orderStatus: OrderStatus.PROCESSING,
      });
    });

    it('returns null when the underlying row is gone', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(
        service.snapshot(room('product:missing')),
      ).resolves.toBeNull();
    });

    it('reads a notification room’s unread count straight from Postgres', async () => {
      prisma.notification.count.mockResolvedValue(3);

      const snapshot = await service.snapshot(room('notification:user-1'));

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null },
      });
      expect(snapshot).toMatchObject({
        room: 'notification:user-1',
        authoritativeSource: 'GET /notifications',
        state: { userId: 'user-1', unreadCount: 3 },
      });
    });
  });
});
