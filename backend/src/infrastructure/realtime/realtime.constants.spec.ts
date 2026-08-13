import {
  auctionRoom,
  authoritativeSourceForRoom,
  isPublicRoomType,
  orderRoom,
  parseRoom,
  productRoom,
  RealtimeRoomType,
  sellerOrderRoom,
} from './realtime.constants';

// parseRoom is a security boundary, not a formatting helper: it is the
// only thing standing between a client-supplied string and
// socket.join(). Anything it accepts, a client can join.
describe('parseRoom', () => {
  it('parses each of the four known room families', () => {
    expect(parseRoom('product:abc')).toEqual({
      type: RealtimeRoomType.PRODUCT,
      id: 'abc',
      name: 'product:abc',
    });
    expect(parseRoom('auction:abc')?.type).toBe(RealtimeRoomType.AUCTION);
    expect(parseRoom('order:abc')?.type).toBe(RealtimeRoomType.ORDER);
    expect(parseRoom('seller-order:abc')?.type).toBe(
      RealtimeRoomType.SELLER_ORDER,
    );
  });

  it('rejects an unknown room type, so a client cannot invent its own room', () => {
    expect(parseRoom('admin:everything')).toBeNull();
    expect(parseRoom('user:some-user-id')).toBeNull();
  });

  it('rejects malformed names rather than throwing', () => {
    expect(parseRoom('')).toBeNull();
    expect(parseRoom('product')).toBeNull();
    expect(parseRoom('product:')).toBeNull();
    expect(parseRoom(':abc')).toBeNull();
  });

  // Socket.IO room names are opaque strings, so without this a client
  // could smuggle separators or wildcards into the id half.
  it('rejects ids containing separators or other unexpected characters', () => {
    expect(parseRoom('product:abc:def')).toBeNull();
    expect(parseRoom('product:abc def')).toBeNull();
    expect(parseRoom('product:*')).toBeNull();
    expect(parseRoom('product:a/b')).toBeNull();
  });

  it('rejects an id longer than any real uuid, bounding the room-name space', () => {
    expect(parseRoom(`product:${'a'.repeat(65)}`)).toBeNull();
    expect(parseRoom(`product:${'a'.repeat(64)}`)).not.toBeNull();
  });

  it('round-trips the room builders the server itself broadcasts to', () => {
    expect(parseRoom(productRoom('p1'))?.name).toBe('product:p1');
    expect(parseRoom(auctionRoom('a1'))?.name).toBe('auction:a1');
    expect(parseRoom(orderRoom('o1'))?.name).toBe('order:o1');
    expect(parseRoom(sellerOrderRoom('s1'))?.name).toBe('seller-order:s1');
  });
});

describe('isPublicRoomType', () => {
  // Getting this wrong in either direction is a real bug: too strict and
  // logged-out visitors lose live auction prices, too loose and order
  // data leaks to anonymous sockets.
  it('treats product and auction rooms as public, order rooms as private', () => {
    expect(isPublicRoomType(RealtimeRoomType.PRODUCT)).toBe(true);
    expect(isPublicRoomType(RealtimeRoomType.AUCTION)).toBe(true);
    expect(isPublicRoomType(RealtimeRoomType.ORDER)).toBe(false);
    expect(isPublicRoomType(RealtimeRoomType.SELLER_ORDER)).toBe(false);
  });
});

describe('authoritativeSourceForRoom', () => {
  it('names the REST endpoint that is the source of truth for each room', () => {
    expect(authoritativeSourceForRoom(RealtimeRoomType.PRODUCT, 'p1')).toBe(
      'GET /products/p1',
    );
    expect(authoritativeSourceForRoom(RealtimeRoomType.AUCTION, 'a1')).toBe(
      'GET /auctions/a1',
    );
    expect(authoritativeSourceForRoom(RealtimeRoomType.ORDER, 'o1')).toBe(
      'GET /orders/o1',
    );
  });

  // A SellerOrder has no endpoint of its own — it's only readable
  // through its parent order.
  it('points a seller-order room at its parent order', () => {
    expect(
      authoritativeSourceForRoom(RealtimeRoomType.SELLER_ORDER, 's1', 'o1'),
    ).toBe('GET /orders/o1');
  });
});
