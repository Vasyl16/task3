import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import type { AppConfig } from '../../config/configuration';
import { MetricsService } from '../metrics/metrics.service';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { RealtimeAckError } from './realtime-message.interface';
import { RealtimeGateway } from './realtime.gateway';
import type { RealtimeRoomsService } from './realtime-rooms.service';
import { CONNECTED_EVENT, RealtimeEventName } from './realtime.constants';

interface FakeSocket {
  data: { user: AuthenticatedUser | null };
  handshake: {
    auth: Record<string, unknown>;
    headers: Record<string, string | undefined>;
  };
  join: jest.Mock;
  leave: jest.Mock;
  emit: jest.Mock;
  disconnect: jest.Mock;
}

function buildSocket(overrides: Partial<FakeSocket['handshake']> = {}) {
  return {
    data: { user: null },
    handshake: { auth: {}, headers: {}, ...overrides },
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as FakeSocket;
}

const SNAPSHOT = {
  room: 'product:p1',
  state: { productId: 'p1', quantityAvailable: 3 },
  fetchedAt: '2026-01-01T00:00:00.000Z',
  authoritativeSource: 'GET /products/p1',
};

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let rooms: jest.Mocked<Pick<RealtimeRoomsService, 'authorize' | 'snapshot'>>;
  let jwtService: { verifyAsync: jest.Mock };
  let emit: jest.Mock;
  let to: jest.Mock;

  beforeEach(() => {
    rooms = { authorize: jest.fn(), snapshot: jest.fn() };
    jwtService = { verifyAsync: jest.fn() };
    emit = jest.fn();
    to = jest.fn().mockReturnValue({ emit });

    gateway = new RealtimeGateway(
      rooms as unknown as RealtimeRoomsService,
      jwtService as unknown as JwtService,
      {
        get: jest.fn().mockReturnValue('test-secret'),
      } as unknown as ConfigService<AppConfig, true>,
      new MetricsService(),
    );
    gateway.server = { to } as never;
  });

  describe('handleConnection', () => {
    it('accepts a connection with no token as anonymous, for public rooms', async () => {
      const client = buildSocket();

      await gateway.handleConnection(client as never);

      expect(client.data.user).toBeNull();
      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith(CONNECTED_EVENT, {
        authenticated: false,
      });
    });

    it('attaches the verified identity from a socket.io auth token', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        email: 'buyer@example.com',
        role: UserRole.CUSTOMER,
      });
      const client = buildSocket({ auth: { token: 'a.b.c' } });

      await gateway.handleConnection(client as never);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('a.b.c', {
        secret: 'test-secret',
      });
      expect(client.data.user).toEqual({
        id: 'user-1',
        email: 'buyer@example.com',
        role: UserRole.CUSTOMER,
      });
    });

    it('also accepts a bearer Authorization header, for non-browser clients', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        email: 'buyer@example.com',
        role: UserRole.CUSTOMER,
      });
      const client = buildSocket({
        headers: { authorization: 'Bearer a.b.c' },
      });

      await gateway.handleConnection(client as never);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('a.b.c', {
        secret: 'test-secret',
      });
      expect(client.data.user?.id).toBe('user-1');
    });

    // Silently downgrading to anonymous would leave the client believing
    // it was still subscribed to its orders while receiving nothing.
    it('disconnects a connection whose token is invalid, rather than downgrading it', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
      const client = buildSocket({ auth: { token: 'expired' } });

      await gateway.handleConnection(client as never);

      expect(client.emit).toHaveBeenCalledWith(CONNECTED_EVENT, {
        authenticated: false,
        error: 'INVALID_TOKEN',
      });
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('subscribe', () => {
    it('joins the room and returns a snapshot in the same round trip', async () => {
      rooms.authorize.mockResolvedValue({ allowed: true });
      rooms.snapshot.mockResolvedValue(SNAPSHOT);
      const client = buildSocket();

      const ack = await gateway.subscribe(client as never, {
        room: 'product:p1',
      });

      expect(client.join).toHaveBeenCalledWith('product:p1');
      expect(ack).toEqual({ ok: true, snapshot: SNAPSHOT });
    });

    it('refuses an unauthorized room and never joins it', async () => {
      rooms.authorize.mockResolvedValue({
        allowed: false,
        error: RealtimeAckError.NOT_FOUND,
        message: 'Order o1 not found',
      });
      const client = buildSocket();

      const ack = await gateway.subscribe(client as never, {
        room: 'order:o1',
      });

      expect(client.join).not.toHaveBeenCalled();
      expect(ack).toEqual({
        ok: false,
        error: RealtimeAckError.NOT_FOUND,
        message: 'Order o1 not found',
      });
    });

    it('rejects a room name that is not one of the known families', async () => {
      const client = buildSocket();

      const ack = await gateway.subscribe(client as never, {
        room: 'admin:everything',
      });

      expect(ack).toMatchObject({
        ok: false,
        error: RealtimeAckError.INVALID_ROOM,
      });
      expect(rooms.authorize).not.toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });

    // Joining a room for a row that doesn't exist would leave the client
    // waiting forever on a channel that can never produce anything.
    it('does not join a room whose underlying row is gone', async () => {
      rooms.authorize.mockResolvedValue({ allowed: true });
      rooms.snapshot.mockResolvedValue(null);
      const client = buildSocket();

      const ack = await gateway.subscribe(client as never, {
        room: 'product:missing',
      });

      expect(ack).toMatchObject({
        ok: false,
        error: RealtimeAckError.NOT_FOUND,
      });
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe('resync', () => {
    it('returns current state without re-joining the room', async () => {
      rooms.authorize.mockResolvedValue({ allowed: true });
      rooms.snapshot.mockResolvedValue(SNAPSHOT);
      const client = buildSocket();

      const ack = await gateway.resync(client as never, { room: 'product:p1' });

      expect(ack).toEqual({ ok: true, snapshot: SNAPSHOT });
      expect(client.join).not.toHaveBeenCalled();
    });

    // Access can be revoked while a socket stays open, so prior
    // membership must never be treated as standing permission.
    it('re-authorizes on every resync rather than trusting existing membership', async () => {
      rooms.authorize.mockResolvedValue({
        allowed: false,
        error: RealtimeAckError.NOT_FOUND,
        message: 'Order o1 not found',
      });
      const client = buildSocket();

      const ack = await gateway.resync(client as never, { room: 'order:o1' });

      expect(rooms.authorize).toHaveBeenCalled();
      expect(ack).toMatchObject({ ok: false });
    });
  });

  describe('unsubscribe', () => {
    it('leaves a valid room', async () => {
      const client = buildSocket();

      const ack = await gateway.unsubscribe(client as never, {
        room: 'auction:a1',
      });

      expect(client.leave).toHaveBeenCalledWith('auction:a1');
      expect(ack).toEqual({ ok: true });
    });

    it('rejects a malformed room name', async () => {
      const client = buildSocket();

      const ack = await gateway.unsubscribe(client as never, { room: 'nope' });

      expect(client.leave).not.toHaveBeenCalled();
      expect(ack).toMatchObject({
        ok: false,
        error: RealtimeAckError.INVALID_ROOM,
      });
    });
  });

  describe('broadcast', () => {
    it('emits the envelope to its own room only', () => {
      const envelope = {
        room: 'auction:a1',
        event: RealtimeEventName.AUCTION_BID_UPDATED,
        payload: { auctionId: 'a1' },
        emittedAt: '2026-01-01T00:00:00.000Z',
        authoritativeSource: 'GET /auctions/a1',
      };

      gateway.broadcast(envelope);

      expect(to).toHaveBeenCalledWith('auction:a1');
      expect(emit).toHaveBeenCalledWith(
        RealtimeEventName.AUCTION_BID_UPDATED,
        envelope,
      );
    });

    // Throwing (rather than silently dropping) lets BullMQ retry — the
    // one broadcast failure where a retry actually delivers something.
    it('throws when the socket server is not initialized yet', () => {
      gateway.server = undefined as never;

      expect(() =>
        gateway.broadcast({
          room: 'auction:a1',
          event: RealtimeEventName.AUCTION_BID_UPDATED,
          payload: {},
          emittedAt: '2026-01-01T00:00:00.000Z',
          authoritativeSource: 'GET /auctions/a1',
        }),
      ).toThrow(/not initialized/);
    });
  });
});
