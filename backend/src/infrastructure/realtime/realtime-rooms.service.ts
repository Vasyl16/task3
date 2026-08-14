import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  authoritativeSourceForRoom,
  isPublicRoomType,
  RealtimeRoomType,
  type ParsedRoom,
} from './realtime.constants';
import {
  RealtimeAckError,
  type RealtimeSnapshot,
} from './realtime-message.interface';

export type AuthorizationResult =
  | { allowed: true }
  | { allowed: false; error: RealtimeAckError; message: string };

const ALLOWED: AuthorizationResult = { allowed: true };

// The two questions the gateway needs answered about a room, and the
// only place in the realtime layer that touches the database:
//
//   1. authorize() — may THIS connection join this room?
//   2. snapshot()  — what is this room's authoritative state right now?
//
// Both read Postgres directly rather than calling OrdersService /
// ProductsService, because dependency direction runs modules ->
// infrastructure, never back (see the backend-architecture skill). These
// are read-only visibility checks and read-only projections — no
// business rule is being duplicated, and nothing here may ever write.
//
// snapshot() is what makes reconnection safe: a client that was
// disconnected for ten seconds or ten minutes re-subscribes and is
// handed current truth, so a missed broadcast can never leave the UI
// permanently stale.
@Injectable()
export class RealtimeRoomsService {
  constructor(private readonly prisma: PrismaService) {}

  async authorize(
    room: ParsedRoom,
    user: AuthenticatedUser | null,
  ): Promise<AuthorizationResult> {
    if (isPublicRoomType(room.type)) {
      return ALLOWED;
    }
    if (!user) {
      return {
        allowed: false,
        error: RealtimeAckError.UNAUTHENTICATED,
        message: 'This room requires an authenticated connection',
      };
    }
    if (user.role === UserRole.ADMIN) {
      return ALLOWED;
    }
    switch (room.type) {
      case RealtimeRoomType.ORDER:
        return this.authorizeOrderRoom(room.id, user);
      case RealtimeRoomType.SELLER_ORDER:
        return this.authorizeSellerOrderRoom(room.id, user);
      case RealtimeRoomType.NOTIFICATION:
        return this.authorizeNotificationRoom(room.id, user);
      default:
        return ALLOWED; // unreachable — the two public types return above
    }
  }

  // Mirrors OrdersService.findById's rule deliberately, including the
  // "don't confirm existence to a stranger" part: a non-owner gets the
  // same NOT_FOUND a genuinely missing order gets, so room names can't
  // be probed to discover which order ids exist.
  private async authorizeOrderRoom(
    orderId: string,
    user: AuthenticatedUser,
  ): Promise<AuthorizationResult> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { buyerId: true },
    });
    if (!order || order.buyerId !== user.id) {
      return {
        allowed: false,
        error: RealtimeAckError.NOT_FOUND,
        message: `Order ${orderId} not found`,
      };
    }
    return ALLOWED;
  }

  // A SellerOrder is visible to two different parties for two different
  // reasons: the seller fulfilling it, and the buyer who placed the
  // parent order. Both are legitimate subscribers to its status.
  private async authorizeSellerOrderRoom(
    sellerOrderId: string,
    user: AuthenticatedUser,
  ): Promise<AuthorizationResult> {
    const sellerOrder = await this.prisma.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      select: {
        order: { select: { buyerId: true } },
        seller: { select: { userId: true } },
      },
    });
    const isParticipant =
      sellerOrder?.order.buyerId === user.id ||
      sellerOrder?.seller.userId === user.id;
    if (!sellerOrder || !isParticipant) {
      return {
        allowed: false,
        error: RealtimeAckError.NOT_FOUND,
        message: `SellerOrder ${sellerOrderId} not found`,
      };
    }
    return ALLOWED;
  }

  // The room id IS the userId (see notificationRoom) — no DB lookup
  // needed, just an identity check: nobody may subscribe to another
  // user's notification room.
  private authorizeNotificationRoom(
    userId: string,
    user: AuthenticatedUser,
  ): Promise<AuthorizationResult> {
    if (userId !== user.id) {
      return Promise.resolve({
        allowed: false,
        error: RealtimeAckError.NOT_FOUND,
        message: `Notification room ${userId} not found`,
      });
    }
    return Promise.resolve(ALLOWED);
  }

  // Returns null when the underlying row is gone — the gateway turns
  // that into a NOT_FOUND ack rather than joining a room that can never
  // produce anything.
  async snapshot(room: ParsedRoom): Promise<RealtimeSnapshot | null> {
    const state = await this.readState(room);
    if (!state) {
      return null;
    }
    return {
      room: room.name,
      state: state.value,
      fetchedAt: new Date().toISOString(),
      authoritativeSource: authoritativeSourceForRoom(
        room.type,
        room.id,
        state.orderId,
      ),
    };
  }

  private async readState(
    room: ParsedRoom,
  ): Promise<{ value: Record<string, unknown>; orderId?: string } | null> {
    switch (room.type) {
      case RealtimeRoomType.PRODUCT:
        return this.readProductState(room.id);
      case RealtimeRoomType.AUCTION:
        return this.readAuctionState(room.id);
      case RealtimeRoomType.ORDER:
        return this.readOrderState(room.id);
      case RealtimeRoomType.SELLER_ORDER:
        return this.readSellerOrderState(room.id);
      case RealtimeRoomType.NOTIFICATION:
        return this.readNotificationState(room.id);
    }
  }

  private async readProductState(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, status: true, inventory: true },
    });
    if (!product) {
      return null;
    }
    return {
      value: {
        productId: product.id,
        status: product.status,
        quantityAvailable: product.inventory?.quantityAvailable ?? 0,
        quantityReserved: product.inventory?.quantityReserved ?? 0,
        version: product.inventory?.version ?? 0,
        updatedAt: product.inventory?.updatedAt.toISOString() ?? null,
      },
    };
  }

  private async readAuctionState(auctionId: string) {
    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
    });
    if (!auction) {
      return null;
    }
    return {
      value: {
        auctionId: auction.id,
        productId: auction.productId,
        status: auction.status,
        startingPrice: auction.startingPrice.toString(),
        minBidIncrement: auction.minBidIncrement.toString(),
        currentHighestBid: auction.currentHighestBid?.toString() ?? null,
        currentHighestBidderId: auction.currentHighestBidderId,
        version: auction.version,
        startsAt: auction.startsAt.toISOString(),
        endsAt: auction.endsAt.toISOString(),
        checkoutDeadline: auction.checkoutDeadline?.toISOString() ?? null,
      },
    };
  }

  private async readOrderState(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        sellerOrders: {
          select: {
            id: true,
            sellerId: true,
            status: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!order) {
      return null;
    }
    return {
      value: {
        orderId: order.id,
        status: order.status,
        updatedAt: order.updatedAt.toISOString(),
        sellerOrders: order.sellerOrders.map((so) => ({
          sellerOrderId: so.id,
          sellerId: so.sellerId,
          status: so.status,
          updatedAt: so.updatedAt.toISOString(),
        })),
      },
    };
  }

  private async readSellerOrderState(sellerOrderId: string) {
    const sellerOrder = await this.prisma.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      select: {
        id: true,
        orderId: true,
        sellerId: true,
        status: true,
        updatedAt: true,
        order: { select: { status: true } },
      },
    });
    if (!sellerOrder) {
      return null;
    }
    return {
      orderId: sellerOrder.orderId,
      value: {
        sellerOrderId: sellerOrder.id,
        orderId: sellerOrder.orderId,
        sellerId: sellerOrder.sellerId,
        status: sellerOrder.status,
        orderStatus: sellerOrder.order.status,
        updatedAt: sellerOrder.updatedAt.toISOString(),
      },
    };
  }

  // Never null — unlike the other rooms, there's no single row a
  // notification room is "about"; every authenticated user has one,
  // even with zero notifications so far. The full list stays a REST
  // concern (GET /notifications) — this only carries the header-badge
  // count, cheap enough to compute on every subscribe/resync.
  private async readNotificationState(userId: string) {
    const unreadCount = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { value: { userId, unreadCount } };
  }
}
