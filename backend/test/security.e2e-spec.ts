import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SellerOrderStatus, UserRole } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { closeApp } from './support/close-app';
import {
  createActiveProduct,
  createCategory,
  loginUser,
  makeApprovedSeller,
  registerUser,
  uniqueSuffix,
  type RegisteredUser,
} from './support/fixtures';

// Cross-tenant authorization, end to end over real HTTP against the real
// database. Unit tests already cover the ownership rules in isolation;
// what this file proves is that the rules are actually WIRED to the
// routes — a guard left off a controller, or a service method called
// without the caller, is invisible to a service-level unit test.
//
// The four regression blocks at the bottom cover holes that were live in
// this codebase and are reproduced here exactly as they were exploited:
// an unrelated account reading a seller's ledger, reading a stranger's
// refund, forging requestedById, reading another user's notification
// through markRead, and the public catalog serving the moderation trail.
describe('Cross-tenant authorization (e2e, real database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const run = uniqueSuffix();

  const createdUserIds: string[] = [];
  const createdSellerProfileIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdProductIds: string[] = [];

  // Seller A and Seller B are two unrelated tenants; customer is a buyer
  // with no seller profile at all; stranger is an unrelated third party.
  let sellerA: RegisteredUser;
  let sellerAProfileId: string;
  let sellerB: RegisteredUser;
  let sellerBProfileId: string;
  let customer: RegisteredUser;
  let stranger: RegisteredUser;
  let admin: RegisteredUser;

  let productA: { id: string };
  let productB: { id: string };
  let categoryId: string;

  // A real order placed by `customer` against seller B, giving us a
  // genuine SellerOrder + ledger + refund to attack.
  let sellerOrderB: { id: string; orderId: string };

  function http() {
    return request(app.getHttpServer());
  }

  function as(user: RegisteredUser): [string, string] {
    return ['Authorization', `Bearer ${user.accessToken}`];
  }

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
    await app.init();
    prisma = app.get(PrismaService);

    const category = await createCategory(prisma, `Sec ${run}`, `sec-${run}`);
    categoryId = category.id;
    createdCategoryIds.push(category.id);

    [sellerA, sellerAProfileId] = await makeSeller('sec-a');
    [sellerB, sellerBProfileId] = await makeSeller('sec-b');
    customer = await makeCustomer('sec-cust');
    stranger = await makeCustomer('sec-stranger');
    admin = await makeAdmin('sec-admin');

    productA = await createActiveProduct(prisma, {
      sellerId: sellerAProfileId,
      categoryId,
      name: `A Widget ${run}`,
      slug: `a-widget-${run}`,
      basePrice: 10,
      stock: 20,
    });
    createdProductIds.push(productA.id);

    productB = await createActiveProduct(prisma, {
      sellerId: sellerBProfileId,
      categoryId,
      name: `B Widget ${run}`,
      slug: `b-widget-${run}`,
      basePrice: 25,
      stock: 20,
    });
    createdProductIds.push(productB.id);

    // Customer buys from seller B, so there is a real SellerOrder that
    // belongs to B and a real order that belongs to the customer.
    await http()
      .post('/cart/items')
      .set(...as(customer))
      .send({ productId: productB.id, quantity: 2 })
      .expect(201);
    const checkout = await http()
      .post('/orders/checkout')
      .set(...as(customer))
      .expect(201);
    const order = checkout.body as {
      id: string;
      sellerOrders: { id: string; sellerId: string }[];
    };
    sellerOrderB = { id: order.sellerOrders[0].id, orderId: order.id };
  });

  afterAll(async () => {
    const sellerOrders = await prisma.sellerOrder.findMany({
      where: { sellerId: { in: createdSellerProfileIds } },
      select: { id: true, orderId: true },
    });
    const sellerOrderIds = sellerOrders.map((s) => s.id);
    const orderIds = [...new Set(sellerOrders.map((s) => s.orderId))];

    await prisma.refund.deleteMany({
      where: { sellerOrderId: { in: sellerOrderIds } },
    });
    await prisma.orderItem.deleteMany({
      where: { sellerOrderId: { in: sellerOrderIds } },
    });
    await prisma.ledgerEntry.deleteMany({
      where: { sellerId: { in: createdSellerProfileIds } },
    });
    await prisma.sellerOrder.deleteMany({
      where: { id: { in: sellerOrderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.notification.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.cartItem.deleteMany({
      where: { productId: { in: createdProductIds } },
    });
    await prisma.cartSession.deleteMany({
      where: { buyerId: { in: createdUserIds } },
    });
    await prisma.cart.deleteMany({
      where: { buyerId: { in: createdUserIds } },
    });
    await prisma.inventory.deleteMany({
      where: { productId: { in: createdProductIds } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: createdProductIds } },
    });
    await prisma.sellerProfile.deleteMany({
      where: { id: { in: createdSellerProfileIds } },
    });
    await prisma.category.deleteMany({
      where: { id: { in: createdCategoryIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

    await closeApp(app);
  });

  async function makeSeller(label: string): Promise<[RegisteredUser, string]> {
    const user = await registerUser(app, prisma, `${label}-${run}@example.com`);
    createdUserIds.push(user.id);
    const profile = await makeApprovedSeller(
      prisma,
      user.id,
      `${label} Shop ${run}`,
    );
    createdSellerProfileIds.push(profile.id);
    // Re-login: the registration token predates the SELLER promotion.
    const accessToken = await loginUser(app, user.email);
    return [{ ...user, accessToken }, profile.id];
  }

  async function makeCustomer(label: string): Promise<RegisteredUser> {
    const user = await registerUser(app, prisma, `${label}-${run}@example.com`);
    createdUserIds.push(user.id);
    return user;
  }

  async function makeAdmin(label: string): Promise<RegisteredUser> {
    const user = await registerUser(app, prisma, `${label}-${run}@example.com`);
    createdUserIds.push(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { role: UserRole.ADMIN },
    });
    const accessToken = await loginUser(app, user.email);
    return { ...user, accessToken };
  }

  // ===================== Seller A vs Seller B =====================

  describe('Seller A against Seller B’s Product', () => {
    it('cannot edit it', async () => {
      await http()
        .patch(`/products/${productB.id}`)
        .set(...as(sellerA))
        .send({ basePrice: 0.01 })
        .expect(403);

      const unchanged = await prisma.product.findUniqueOrThrow({
        where: { id: productB.id },
      });
      expect(Number(unchanged.basePrice)).toBe(25);
    });

    it('cannot archive it', async () => {
      await http()
        .delete(`/products/${productB.id}`)
        .set(...as(sellerA))
        .expect(403);

      const unchanged = await prisma.product.findUniqueOrThrow({
        where: { id: productB.id },
      });
      expect(unchanged.status).toBe('ACTIVE');
    });

    // The most valuable field to attack: stock is money, and
    // UpdateProductDto legitimately accepts quantityAvailable.
    it('cannot rewrite its stock level', async () => {
      const before = await prisma.inventory.findUniqueOrThrow({
        where: { productId: productB.id },
      });

      await http()
        .patch(`/products/${productB.id}`)
        .set(...as(sellerA))
        .send({ quantityAvailable: 0 })
        .expect(403);

      const after = await prisma.inventory.findUniqueOrThrow({
        where: { productId: productB.id },
      });
      expect(after.quantityAvailable).toBe(before.quantityAvailable);
    });

    it('cannot open an auction on it', async () => {
      await http()
        .post('/auctions')
        .set(...as(sellerA))
        .send({
          productId: productB.id,
          quantity: 1,
          startingPrice: 5,
          minBidIncrement: 1,
          startsAt: new Date(Date.now() + 60_000).toISOString(),
          endsAt: new Date(Date.now() + 120_000).toISOString(),
        })
        .expect(403);
    });

    it('CAN still edit their own product — the rule blocks strangers, not owners', async () => {
      await http()
        .patch(`/products/${productA.id}`)
        .set(...as(sellerA))
        .send({ basePrice: 11 })
        .expect(200);
    });
  });

  describe('Seller A against Seller B’s SellerOrder', () => {
    it('cannot advance its status', async () => {
      await http()
        .patch(`/orders/seller-orders/${sellerOrderB.id}/status`)
        .set(...as(sellerA))
        .send({ status: SellerOrderStatus.SHIPPED })
        .expect(403);
    });

    // Cancellation is the dangerous one: it restores stock, reverses the
    // ledger, and now triggers the refund saga.
    it('cannot cancel it, and no refund is opened as a side effect', async () => {
      await http()
        .patch(`/orders/seller-orders/${sellerOrderB.id}/status`)
        .set(...as(sellerA))
        .send({ status: SellerOrderStatus.CANCELLED })
        .expect(403);

      const sellerOrder = await prisma.sellerOrder.findUniqueOrThrow({
        where: { id: sellerOrderB.id },
      });
      expect(sellerOrder.status).not.toBe(SellerOrderStatus.CANCELLED);
      await expect(
        prisma.refund.count({ where: { sellerOrderId: sellerOrderB.id } }),
      ).resolves.toBe(0);
    });

    it('does not see it in their own seller-order list', async () => {
      const res = await http()
        .get('/orders/seller-orders')
        .set(...as(sellerA))
        .expect(200);
      const ids = (res.body as { id: string }[]).map((s) => s.id);
      expect(ids).not.toContain(sellerOrderB.id);
    });
  });

  describe('Customer against another Customer’s Order', () => {
    it('404s rather than 403 — a 403 would confirm the order exists', async () => {
      await http()
        .get(`/orders/${sellerOrderB.orderId}`)
        .set(...as(stranger))
        .expect(404);
    });

    it('does not appear in the stranger’s own order list', async () => {
      const res = await http()
        .get('/orders')
        .set(...as(stranger))
        .expect(200);
      const ids = (res.body as { id: string }[]).map((o) => o.id);
      expect(ids).not.toContain(sellerOrderB.orderId);
    });

    it('the real buyer can read it', async () => {
      await http()
        .get(`/orders/${sellerOrderB.orderId}`)
        .set(...as(customer))
        .expect(200);
    });

    it('a customer cannot raise a dispute on an order they did not buy', async () => {
      await http()
        .post('/disputes')
        .set(...as(stranger))
        .send({
          sellerOrderId: sellerOrderB.id,
          reason: 'This is not my order but I want a say in it',
        })
        .expect(404);
    });
  });

  // ===================== Payload tampering =====================

  describe('manipulating price and stock through the request payload', () => {
    it('rejects a sellerId smuggled into product creation', async () => {
      const res = await http()
        .post('/products')
        .set(...as(sellerA))
        .send({
          categoryId,
          name: `Smuggled ${run}`,
          slug: `smuggled-${run}`,
          basePrice: 5,
          initialQuantity: 1,
          sellerId: sellerBProfileId,
        })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('sellerId should not exist');
    });

    it('rejects a bidderId smuggled into a bid', async () => {
      await http()
        .post('/auctions/00000000-0000-4000-8000-000000000000/bids')
        .set(...as(customer))
        .send({ amount: 5, bidderId: sellerA.id })
        .expect(400);
    });

    it('rejects a negative price and a negative stock quantity', async () => {
      await http()
        .patch(`/products/${productA.id}`)
        .set(...as(sellerA))
        .send({ basePrice: -100 })
        .expect(400);
      await http()
        .patch(`/products/${productA.id}`)
        .set(...as(sellerA))
        .send({ quantityAvailable: -5 })
        .expect(400);
    });

    // Checkout prices from the authoritative DB row, so repricing a
    // product mid-flight cannot make a cart cheaper than what is charged.
    it('charges the current catalogue price, not a client-supplied one', async () => {
      await http()
        .post('/cart/items')
        .set(...as(stranger))
        .send({ productId: productA.id, quantity: 1, unitPrice: 0.01 })
        .expect(400);
    });
  });

  describe('bypassing checkout validation', () => {
    it('refuses to check out more units than exist', async () => {
      await http()
        .post('/cart/items')
        .set(...as(stranger))
        .send({ productId: productA.id, quantity: 999 })
        .expect(201);

      await http()
        .post('/orders/checkout')
        .set(...as(stranger))
        .expect(400);

      // Nothing was taken from stock by the rejected attempt.
      const inventory = await prisma.inventory.findUniqueOrThrow({
        where: { productId: productA.id },
      });
      expect(inventory.quantityAvailable).toBe(20);

      await http()
        .delete(`/cart/items/${productA.id}`)
        .set(...as(stranger))
        .expect(200);
    });

    it('refuses an empty cart', async () => {
      await http()
        .post('/orders/checkout')
        .set(...as(stranger))
        .expect(400);
    });
  });

  // ===================== Admin-only surface =====================

  describe('admin-only operations', () => {
    const adminRoutes = [
      '/admin/seller-applications',
      '/admin/products',
      '/admin/disputes',
      '/admin/analytics',
    ];

    it.each(adminRoutes)('refuses a customer on %s', async (route) => {
      await http()
        .get(route)
        .set(...as(customer))
        .expect(403);
    });

    it.each(adminRoutes)(
      'refuses a seller on %s — being a seller is not being an admin',
      async (route) => {
        await http()
          .get(route)
          .set(...as(sellerA))
          .expect(403);
      },
    );

    it.each(adminRoutes)(
      'refuses an unauthenticated caller on %s',
      async (route) => {
        await http().get(route).expect(401);
      },
    );

    it('allows a real admin', async () => {
      await http()
        .get('/admin/seller-applications')
        .set(...as(admin))
        .expect(200);
    });

    it('refuses a non-admin taking a listing down', async () => {
      await http()
        .patch(`/admin/products/${productB.id}/moderation`)
        .set(...as(sellerA))
        .send({ action: 'TAKE_DOWN', note: 'competitor removal attempt' })
        .expect(403);
    });

    it('refuses a non-admin approving their own seller application', async () => {
      await http()
        .patch(`/sellers/${sellerAProfileId}/review`)
        .set(...as(sellerA))
        .send({ status: 'APPROVED' })
        .expect(403);
    });
  });

  // ===================== Regressions =====================
  // Each of these was exploitable in this codebase. Reproduced exactly.

  describe('regression: seller ledger was readable by anyone', () => {
    it('refuses a customer entirely (role gate)', async () => {
      await http()
        .get(`/sellers/${sellerBProfileId}/ledger`)
        .set(...as(customer))
        .expect(403);
    });

    it('refuses one seller reading another seller’s ledger', async () => {
      await http()
        .get(`/sellers/${sellerBProfileId}/ledger`)
        .set(...as(sellerA))
        .expect(403);
    });

    it('still lets a seller read their own', async () => {
      await http()
        .get(`/sellers/${sellerBProfileId}/ledger`)
        .set(...as(sellerB))
        .expect(200);
    });

    it('lets an admin read anyone’s', async () => {
      await http()
        .get(`/sellers/${sellerBProfileId}/ledger`)
        .set(...as(admin))
        .expect(200);
    });
  });

  describe('regression: refunds were readable and forgeable by anyone', () => {
    let refundId: string;

    beforeAll(async () => {
      const res = await http()
        .post('/refunds')
        .set(...as(customer))
        .send({ sellerOrderId: sellerOrderB.id, amount: 10, reason: 'damaged' })
        .expect(201);
      refundId = (res.body as { id: string }).id;
    });

    it('attributes the refund to the caller, not to whoever they name', async () => {
      const refund = await prisma.refund.findUniqueOrThrow({
        where: { id: refundId },
      });
      expect(refund.requestedById).toBe(customer.id);
    });

    it('rejects a body carrying requestedById at all', async () => {
      const res = await http()
        .post('/refunds')
        .set(...as(stranger))
        .send({
          sellerOrderId: sellerOrderB.id,
          amount: 9999,
          requestedById: customer.id,
        })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain(
        'requestedById should not exist',
      );
    });

    it('refuses a refund on a SellerOrder the caller did not buy', async () => {
      await http()
        .post('/refunds')
        .set(...as(stranger))
        .send({ sellerOrderId: sellerOrderB.id, amount: 9999 })
        .expect(404);
    });

    it('refuses an unrelated account reading the refund', async () => {
      await http()
        .get(`/refunds/${refundId}`)
        .set(...as(stranger))
        .expect(404);
    });

    it('does not disclose the SellerOrder id in that 404', async () => {
      const res = await http()
        .get(`/refunds/${refundId}`)
        .set(...as(stranger))
        .expect(404);
      expect(JSON.stringify(res.body)).not.toContain(sellerOrderB.id);
    });

    it('lets the buyer and the fulfilling seller read it', async () => {
      await http()
        .get(`/refunds/${refundId}`)
        .set(...as(customer))
        .expect(200);
      await http()
        .get(`/refunds/${refundId}`)
        .set(...as(sellerB))
        .expect(200);
    });

    it('refuses a non-admin resolving a refund', async () => {
      await http()
        .patch(`/refunds/${refundId}/resolve`)
        .set(...as(sellerB))
        .send({ status: 'PROCESSED' })
        .expect(403);
    });
  });

  describe('regression: notifications were readable through markRead', () => {
    let notificationId: string;

    beforeAll(async () => {
      const notification = await prisma.notification.create({
        data: {
          userId: customer.id,
          type: 'TEST',
          title: 'Private title',
          body: 'Private body nobody else should see',
        },
      });
      notificationId = notification.id;
    });

    it('refuses another user, and leaks none of the content', async () => {
      const res = await http()
        .patch(`/notifications/${notificationId}/read`)
        .set(...as(stranger))
        .expect(404);
      expect(JSON.stringify(res.body)).not.toContain('Private body');
    });

    it('does not mark it read as a side effect', async () => {
      const notification = await prisma.notification.findUniqueOrThrow({
        where: { id: notificationId },
      });
      expect(notification.readAt).toBeNull();
    });

    it('still works for the owner', async () => {
      await http()
        .patch(`/notifications/${notificationId}/read`)
        .set(...as(customer))
        .expect(200);
    });
  });

  describe('regression: the public catalogue served the moderation trail', () => {
    beforeAll(async () => {
      await prisma.product.update({
        where: { id: productA.id },
        data: {
          moderatedByUserId: admin.id,
          moderatedAt: new Date(),
          moderationNote: 'Counterfeit goods, reported by three buyers',
        },
      });
    });

    it('omits the audit fields from the unauthenticated detail route', async () => {
      const res = await http().get(`/products/${productA.id}`).expect(200);
      expect(res.body).not.toHaveProperty('moderationNote');
      expect(res.body).not.toHaveProperty('moderatedByUserId');
      expect(JSON.stringify(res.body)).not.toContain('Counterfeit');
    });

    it('omits them from the unauthenticated list route too', async () => {
      const res = await http()
        .get(`/products?categoryId=${categoryId}`)
        .expect(200);
      expect(JSON.stringify(res.body)).not.toContain('Counterfeit');
    });

    it('still returns the fields a shopper needs', async () => {
      const res = await http().get(`/products/${productA.id}`).expect(200);
      expect(res.body).toMatchObject({ id: productA.id, status: 'ACTIVE' });
    });
  });
});
