import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { App } from 'supertest/types';
import { OrderStatus, SellerOrderStatus } from '@prisma/client';
import { io, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { RealtimeConsumer } from '../src/infrastructure/realtime/consumers/realtime.consumer';
import {
  REALTIME_NAMESPACE,
  RealtimeEventName,
} from '../src/infrastructure/realtime/realtime.constants';
import { RealtimeAckError } from '../src/infrastructure/realtime/realtime-message.interface';
import { INVENTORY_UPDATED_EVENT } from '../src/modules/products/domain/events/inventory-updated.event';
import { SELLER_ORDER_STATUS_CHANGED_EVENT } from '../src/modules/orders/domain/events/seller-order-status-changed.event';
import { closeApp } from './support/close-app';
import {
  createActiveProduct,
  createCategory,
  makeApprovedSeller,
  registerUser,
  uniqueSuffix,
  type RegisteredUser,
} from './support/fixtures';

// Real Socket.IO clients against a really-listening server, on the real
// configured database. Mocked sockets (see realtime.gateway.spec.ts)
// prove the handler logic; only this proves the parts that live between
// the pieces: that the handshake actually carries a JWT, that room
// membership actually filters delivery, and — most importantly — that a
// client which MISSED a broadcast can still recover current truth by
// asking again. That last one is the whole reconnect guarantee, and it
// is not assertable without a real connection.
describe('Realtime gateway (e2e, real socket + real database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let url: string;
  const run = uniqueSuffix();
  const sockets: Socket[] = [];

  let buyer: RegisteredUser;
  let stranger: RegisteredUser;
  let sellerUser: RegisteredUser;
  let sellerProfileId: string;
  let categoryId: string;
  let productId: string;
  let orderId: string;
  let sellerOrderId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    // listen(), not just init(): Socket.IO needs a real HTTP server
    // bound to a real port. Port 0 lets the OS pick a free one.
    await app.listen(0);
    prisma = app.get(PrismaService);
    const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
    url = `http://127.0.0.1:${port}${REALTIME_NAMESPACE}`;

    buyer = await registerUser(app, prisma, `rt-buyer-${run}@example.com`);
    stranger = await registerUser(
      app,
      prisma,
      `rt-stranger-${run}@example.com`,
    );
    sellerUser = await registerUser(
      app,
      prisma,
      `rt-seller-${run}@example.com`,
    );

    const sellerProfile = await makeApprovedSeller(
      prisma,
      sellerUser.id,
      `RT Shop ${run}`,
    );
    sellerProfileId = sellerProfile.id;
    categoryId = (
      await createCategory(prisma, `RT Cat ${run}`, `rt-cat-${run}`)
    ).id;
    productId = (
      await createActiveProduct(prisma, {
        sellerId: sellerProfileId,
        categoryId,
        name: `RT Widget ${run}`,
        slug: `rt-widget-${run}`,
        basePrice: 20,
        stock: 10,
      })
    ).id;

    const order = await prisma.order.create({
      data: { buyerId: buyer.id, status: OrderStatus.NEW, totalAmount: 20 },
    });
    orderId = order.id;
    const sellerOrder = await prisma.sellerOrder.create({
      data: {
        orderId,
        sellerId: sellerProfileId,
        status: SellerOrderStatus.NEW,
        subtotal: 20,
      },
    });
    sellerOrderId = sellerOrder.id;
  });

  afterAll(async () => {
    for (const socket of sockets) {
      socket.disconnect();
    }
    // Cancelling a SellerOrder opens a Refund (the refund saga —
    // see RefundConsumer), which holds a Restrict FK to it, so the
    // refund has to go first or the SellerOrder can't be deleted.
    await prisma.refund.deleteMany({ where: { sellerOrderId } });
    await prisma.sellerOrder.deleteMany({ where: { id: sellerOrderId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.inventory.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.sellerProfile.deleteMany({ where: { id: sellerProfileId } });
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: [buyer.id, stranger.id, sellerUser.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [buyer.id, stranger.id, sellerUser.id] } },
    });
    await closeApp(app);
  });

  interface TestClient {
    socket: Socket;
    // The server's `connected` greeting and any server-initiated
    // disconnect are captured the instant the socket is created, BEFORE
    // awaiting the connect handshake. Both can arrive in the same tick
    // as `connect` itself, and socket.io drops an event with no
    // listener — attaching afterwards is a race that loses roughly
    // whenever the packets share a TCP frame.
    hello: Promise<Record<string, unknown>>;
    disconnected: Promise<void>;
  }

  async function connect(token?: string): Promise<TestClient> {
    const socket = io(url, {
      transports: ['websocket'],
      auth: token ? { token } : {},
      forceNew: true,
    });
    sockets.push(socket);

    const hello = new Promise<Record<string, unknown>>((resolve) => {
      socket.once('connected', resolve);
    });
    const disconnected = new Promise<void>((resolve) => {
      socket.once('disconnect', () => resolve());
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('connect timed out')),
        8000,
      );
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    return { socket, hello, disconnected };
  }

  function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`timed out waiting for ${what}`)),
          8000,
        ),
      ),
    ]);
  }

  function send(
    socket: Socket,
    message: string,
    room: string,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no ack for "${message}"`)),
        8000,
      );
      socket.emit(message, { room }, (ack: Record<string, unknown>) => {
        clearTimeout(timer);
        resolve(ack);
      });
    });
  }

  function nextEvent(
    socket: Socket,
    event: string,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`never received "${event}"`)),
        8000,
      );
      socket.once(event, (payload: Record<string, unknown>) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  describe('connection handling', () => {
    it('accepts an anonymous connection', async () => {
      const { socket, hello } = await connect();

      expect(socket.connected).toBe(true);
      expect(await withTimeout(hello, 'greeting')).toMatchObject({
        authenticated: false,
      });
    });

    it('accepts a connection carrying a valid access token', async () => {
      const { hello } = await connect(buyer.accessToken);

      expect(await withTimeout(hello, 'greeting')).toMatchObject({
        authenticated: true,
        userId: buyer.id,
      });
    });

    // Not a silent downgrade to anonymous: the client is told, and the
    // socket is closed so it reconnects with a fresh token.
    it('disconnects a connection whose token is garbage', async () => {
      const { socket, hello, disconnected } = await connect('not-a-real-jwt');

      expect(await withTimeout(hello, 'greeting')).toMatchObject({
        authenticated: false,
        error: 'INVALID_TOKEN',
      });
      await withTimeout(disconnected, 'disconnect');
      expect(socket.connected).toBe(false);
    });
  });

  describe('rooms and authorization', () => {
    it('lets an anonymous client subscribe to a public product room and returns live stock', async () => {
      const { socket } = await connect();

      const ack = await send(socket, 'subscribe', `product:${productId}`);

      expect(ack).toMatchObject({
        ok: true,
        snapshot: {
          room: `product:${productId}`,
          authoritativeSource: `GET /products/${productId}`,
          state: { productId, quantityAvailable: 10 },
        },
      });
    });

    it('refuses an anonymous client on a private order room', async () => {
      const { socket } = await connect();

      const ack = await send(socket, 'subscribe', `order:${orderId}`);

      expect(ack).toMatchObject({
        ok: false,
        error: RealtimeAckError.UNAUTHENTICATED,
      });
    });

    it('lets the buyer subscribe to their own order and see every SellerOrder', async () => {
      const { socket } = await connect(buyer.accessToken);

      const ack = await send(socket, 'subscribe', `order:${orderId}`);

      expect(ack).toMatchObject({
        ok: true,
        snapshot: {
          state: {
            orderId,
            sellerOrders: [{ sellerOrderId, status: SellerOrderStatus.NEW }],
          },
        },
      });
    });

    // The IDOR case, over a socket instead of over HTTP.
    it('refuses an authenticated stranger on someone else’s order, without confirming it exists', async () => {
      const { socket } = await connect(stranger.accessToken);

      const ack = await send(socket, 'subscribe', `order:${orderId}`);

      expect(ack).toMatchObject({
        ok: false,
        error: RealtimeAckError.NOT_FOUND,
      });
    });

    it('lets the fulfilling seller subscribe to their own seller-order', async () => {
      const { socket } = await connect(sellerUser.accessToken);

      const ack = await send(
        socket,
        'subscribe',
        `seller-order:${sellerOrderId}`,
      );

      expect(ack).toMatchObject({
        ok: true,
        snapshot: { state: { sellerOrderId, orderId } },
      });
    });

    it('rejects a room name outside the four known families', async () => {
      const { socket } = await connect(buyer.accessToken);

      const ack = await send(socket, 'subscribe', 'admin:everything');

      expect(ack).toMatchObject({
        ok: false,
        error: RealtimeAckError.INVALID_ROOM,
      });
    });
  });

  describe('broadcasting', () => {
    // Drives the consumer directly rather than through Redis: this test
    // is about the queue -> gateway -> subscribed client hop, and BullMQ
    // delivery is already covered by the outbox publisher's own tests.
    function deliver(eventType: string, payload: Record<string, unknown>) {
      return app.get(RealtimeConsumer).process({
        data: {
          eventId: `evt-${Math.random().toString(36).slice(2)}`,
          eventType,
          aggregateType: 'Test',
          aggregateId: 'agg',
          correlationId: 'corr-rt',
          payload,
        },
        attemptsMade: 0,
      } as never);
    }

    it('delivers an inventory update to a subscriber of that product room', async () => {
      const { socket } = await connect();
      await send(socket, 'subscribe', `product:${productId}`);

      const received = nextEvent(socket, RealtimeEventName.INVENTORY_UPDATED);
      await deliver(INVENTORY_UPDATED_EVENT, {
        productId,
        quantityAvailable: 7,
        quantityReserved: 3,
        reason: 'CHECKOUT',
      });

      expect(await received).toMatchObject({
        room: `product:${productId}`,
        event: RealtimeEventName.INVENTORY_UPDATED,
        authoritativeSource: `GET /products/${productId}`,
        payload: { productId, quantityAvailable: 7 },
      });
    });

    // Room membership is the access control at delivery time, not just
    // at subscribe time — a socket that never joined must hear nothing.
    it('does not deliver a room’s events to a client that never subscribed', async () => {
      const { socket: subscriber } = await connect();
      const { socket: bystander } = await connect();
      await send(subscriber, 'subscribe', `product:${productId}`);

      const heard = jest.fn();
      bystander.on(RealtimeEventName.INVENTORY_UPDATED, heard);
      const received = nextEvent(
        subscriber,
        RealtimeEventName.INVENTORY_UPDATED,
      );
      await deliver(INVENTORY_UPDATED_EVENT, {
        productId,
        quantityAvailable: 6,
        quantityReserved: 4,
        reason: 'CHECKOUT',
      });
      await received;

      expect(heard).not.toHaveBeenCalled();
    });

    it('delivers a SellerOrder status change to the parent order room', async () => {
      const { socket } = await connect(buyer.accessToken);
      await send(socket, 'subscribe', `order:${orderId}`);

      const received = nextEvent(
        socket,
        RealtimeEventName.SELLER_ORDER_STATUS_UPDATED,
      );
      await deliver(SELLER_ORDER_STATUS_CHANGED_EVENT, {
        sellerOrderId,
        orderId,
        buyerId: buyer.id,
        status: SellerOrderStatus.SHIPPED,
        orderStatus: OrderStatus.SHIPPED,
      });

      expect(await received).toMatchObject({
        room: `order:${orderId}`,
        payload: { status: SellerOrderStatus.SHIPPED },
      });
    });
  });

  describe('reconnect / resync', () => {
    // The requirement this whole design exists to satisfy: a client that
    // missed events must not be left permanently stale. Here the state
    // changes with NO broadcast at all — the harshest version of "missed
    // it" — and the client still converges on truth by asking.
    it('returns current authoritative state on resync, even for a change that was never broadcast', async () => {
      const { socket } = await connect();
      const first = await send(socket, 'subscribe', `product:${productId}`);
      expect(first).toMatchObject({
        snapshot: { state: { quantityAvailable: 10 } },
      });

      await prisma.inventory.update({
        where: { productId },
        data: { quantityAvailable: 2, quantityReserved: 8 },
      });

      const resynced = await send(socket, 'resync', `product:${productId}`);

      expect(resynced).toMatchObject({
        ok: true,
        snapshot: { state: { quantityAvailable: 2, quantityReserved: 8 } },
      });

      await prisma.inventory.update({
        where: { productId },
        data: { quantityAvailable: 10, quantityReserved: 0 },
      });
    });

    // A genuine reconnect: a brand-new socket re-subscribing is handed
    // current state, so nothing needs to survive the disconnect.
    it('hands a freshly reconnected client current state via subscribe alone', async () => {
      const { socket: before } = await connect();
      await send(before, 'subscribe', `product:${productId}`);
      before.disconnect();

      await prisma.inventory.update({
        where: { productId },
        data: { quantityAvailable: 5 },
      });

      const { socket: reconnected } = await connect();
      const ack = await send(reconnected, 'subscribe', `product:${productId}`);

      expect(ack).toMatchObject({
        ok: true,
        snapshot: { state: { quantityAvailable: 5 } },
      });

      await prisma.inventory.update({
        where: { productId },
        data: { quantityAvailable: 10 },
      });
    });

    it('re-checks authorization on resync rather than trusting prior membership', async () => {
      const { socket } = await connect(stranger.accessToken);

      const ack = await send(socket, 'resync', `order:${orderId}`);

      expect(ack).toMatchObject({
        ok: false,
        error: RealtimeAckError.NOT_FOUND,
      });
    });
  });
});
