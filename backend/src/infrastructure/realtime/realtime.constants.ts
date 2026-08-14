export const REALTIME_NAMESPACE = '/realtime';

// The five subscribable room families. A room name is always
// `{type}:{id}` — see parseRoom, which is the ONLY thing that turns a
// client-supplied string into one of these.
export enum RealtimeRoomType {
  PRODUCT = 'product',
  AUCTION = 'auction',
  ORDER = 'order',
  SELLER_ORDER = 'seller-order',
  NOTIFICATION = 'notification',
}

// Which rooms are readable without an authenticated identity. A
// product's stock level and an auction's current price are already
// visible to anonymous visitors over REST (`GET /products/:id`,
// `GET /auctions/:id` are @Public()), so gating them behind a socket
// token would be theatre, not security. Orders (and notifications) are
// the opposite: they are per-user data and require both a verified
// identity AND an ownership check — see RealtimeRoomsService.authorize.
const PUBLIC_ROOM_TYPES: ReadonlySet<RealtimeRoomType> = new Set([
  RealtimeRoomType.PRODUCT,
  RealtimeRoomType.AUCTION,
]);

export function isPublicRoomType(type: RealtimeRoomType): boolean {
  return PUBLIC_ROOM_TYPES.has(type);
}

// Server -> client message names. Named after the fact that happened,
// not after the UI that consumes it.
export enum RealtimeEventName {
  INVENTORY_UPDATED = 'inventory.updated',
  AUCTION_BID_UPDATED = 'auction.bid.updated',
  AUCTION_ENDED = 'auction.ended',
  SELLER_ORDER_STATUS_UPDATED = 'seller-order.status.updated',
  NOTIFICATION_CREATED = 'notification.created',
}

// Client -> server message names.
export const SUBSCRIBE_MESSAGE = 'subscribe';
export const UNSUBSCRIBE_MESSAGE = 'unsubscribe';
export const RESYNC_MESSAGE = 'resync';

// Emitted once per connection, so a client knows whether its token was
// accepted before it tries to subscribe to anything private.
export const CONNECTED_EVENT = 'connected';

const ROOM_PATTERN = /^([a-z-]+):([A-Za-z0-9-]{1,64})$/;

export interface ParsedRoom {
  type: RealtimeRoomType;
  id: string;
  name: string;
}

const ROOM_TYPES = new Set<string>(Object.values(RealtimeRoomType));

// Returns null for anything that isn't a well-formed, known room —
// never throws, so a malformed subscribe is a clean rejection rather
// than a crashed handler. Guards against a client joining an arbitrary
// Socket.IO room name of its choosing (which would otherwise let it
// receive another user's broadcasts by guessing the room string).
export function parseRoom(room: string): ParsedRoom | null {
  const match = ROOM_PATTERN.exec(room);
  if (!match) {
    return null;
  }
  const [, type, id] = match;
  if (!ROOM_TYPES.has(type)) {
    return null;
  }
  return { type: type as RealtimeRoomType, id, name: `${type}:${id}` };
}

// The REST endpoint that is authoritative for a room, echoed on every
// message so a client is never left guessing where the real state lives.
// A SellerOrder is only exposed through its parent order, hence orderId.
export function authoritativeSourceForRoom(
  type: RealtimeRoomType,
  id: string,
  orderId?: string,
): string {
  switch (type) {
    case RealtimeRoomType.PRODUCT:
      return `GET /products/${id}`;
    case RealtimeRoomType.AUCTION:
      return `GET /auctions/${id}`;
    case RealtimeRoomType.ORDER:
      return `GET /orders/${id}`;
    case RealtimeRoomType.SELLER_ORDER:
      return orderId ? `GET /orders/${orderId}` : 'GET /orders';
    case RealtimeRoomType.NOTIFICATION:
      return 'GET /notifications';
  }
}

export function productRoom(productId: string): string {
  return `${RealtimeRoomType.PRODUCT}:${productId}`;
}

export function auctionRoom(auctionId: string): string {
  return `${RealtimeRoomType.AUCTION}:${auctionId}`;
}

export function orderRoom(orderId: string): string {
  return `${RealtimeRoomType.ORDER}:${orderId}`;
}

export function sellerOrderRoom(sellerOrderId: string): string {
  return `${RealtimeRoomType.SELLER_ORDER}:${sellerOrderId}`;
}

// Keyed by userId directly (not a notification id) — one room per
// recipient, not per notification, since a client subscribes to "my
// notifications" as a whole, not to any single one.
export function notificationRoom(userId: string): string {
  return `${RealtimeRoomType.NOTIFICATION}:${userId}`;
}
