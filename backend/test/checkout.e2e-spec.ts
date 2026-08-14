import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { closeApp } from './support/close-app';
import {
  authHeader,
  createActiveProduct,
  createCategory,
  loginUser,
  makeApprovedSeller,
  registerUser,
  uniqueSuffix,
  type RegisteredUser,
} from './support/fixtures';

// Real-database integration tests for the multi-vendor checkout
// transaction (OrdersService.checkout) — this is the one part of the
// checkout task that mocked-Prisma unit tests genuinely cannot prove:
// atomic rollback, real concurrent-safe stock decrement, and the
// Idempotency-Key mechanism's actual HTTP-level behavior. Runs against
// the real configured DATABASE_URL (see jest-e2e-setup.ts).
describe('Checkout (e2e, real database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const run = uniqueSuffix();

  const createdUserIds: string[] = [];
  const createdSellerProfileIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdProductIds: string[] = [];

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
  });

  afterAll(async () => {
    // FK-safe deletion order — see the Restrict/Cascade/SetNull rules in
    // schema.prisma. Scoped to exactly what this file created.
    const sellerOrders = await prisma.sellerOrder.findMany({
      where: { sellerId: { in: createdSellerProfileIds } },
      select: { id: true, orderId: true },
    });
    const sellerOrderIds = sellerOrders.map((s) => s.id);
    const orderIds = [...new Set(sellerOrders.map((s) => s.orderId))];

    await prisma.orderItem.deleteMany({
      where: { sellerOrderId: { in: sellerOrderIds } },
    });
    await prisma.ledgerEntry.deleteMany({
      where: { sellerId: { in: createdSellerProfileIds } },
    });
    // Cancelling a SellerOrder opens a Refund (the refund saga —
    // see RefundConsumer), which holds a Restrict FK to it, so the
    // refund has to go first or the SellerOrder can't be deleted.
    await prisma.refund.deleteMany({
      where: { sellerOrderId: { in: sellerOrderIds } },
    });
    await prisma.sellerOrder.deleteMany({
      where: { id: { in: sellerOrderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.cartItem.deleteMany({
      where: { productId: { in: createdProductIds } },
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

  async function makeSeller(label: string): Promise<{
    user: RegisteredUser;
    sellerProfileId: string;
  }> {
    const user = await registerUser(app, prisma, `${label}-${run}@example.com`);
    createdUserIds.push(user.id);
    const profile = await makeApprovedSeller(
      prisma,
      user.id,
      `${label} Shop ${run}`,
    );
    createdSellerProfileIds.push(profile.id);
    // Re-login: the token from registerUser() predates the SELLER
    // promotion above and still carries the stale CUSTOMER role claim.
    const accessToken = await loginUser(app, user.email);
    return { user: { ...user, accessToken }, sellerProfileId: profile.id };
  }

  async function makeProduct(
    sellerId: string,
    categoryId: string,
    label: string,
    price: number,
    stock: number,
  ) {
    const product = await createActiveProduct(prisma, {
      sellerId,
      categoryId,
      name: label,
      slug: `${label.toLowerCase().replace(/\s+/g, '-')}-${run}`,
      basePrice: price,
      stock,
    });
    createdProductIds.push(product.id);
    return product;
  }

  it('multi-vendor checkout: splits a cart across sellers into one SellerOrder each, decrements stock, clears the cart', async () => {
    const category = await createCategory(prisma, `Cat ${run}`, `cat-${run}`);
    createdCategoryIds.push(category.id);

    const sellerA = await makeSeller(`sellerA-mv`);
    const sellerB = await makeSeller(`sellerB-mv`);
    const productA = await makeProduct(
      sellerA.sellerProfileId,
      category.id,
      `Widget A ${run}`,
      10,
      5,
    );
    const productB = await makeProduct(
      sellerB.sellerProfileId,
      category.id,
      `Widget B ${run}`,
      20,
      5,
    );

    const buyer = await registerUser(
      app,
      prisma,
      `buyer-mv-${run}@example.com`,
    );
    createdUserIds.push(buyer.id);

    await request(app.getHttpServer())
      .post('/cart/items')
      .set(...authHeader(buyer))
      .send({ productId: productA.id, quantity: 2 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/cart/items')
      .set(...authHeader(buyer))
      .send({ productId: productB.id, quantity: 1 })
      .expect(201);

    const checkoutRes = await request(app.getHttpServer())
      .post('/orders/checkout')
      .set(...authHeader(buyer))
      .expect(201);

    expect(checkoutRes.body.sellerOrders).toHaveLength(2);
    const sellerIds = checkoutRes.body.sellerOrders.map(
      (so: { sellerId: string }) => so.sellerId,
    );
    expect(sellerIds).toEqual(
      expect.arrayContaining([
        sellerA.sellerProfileId,
        sellerB.sellerProfileId,
      ]),
    );

    // Correct inventory decrement, read back from Postgres.
    const inventoryA = await prisma.inventory.findUnique({
      where: { productId: productA.id },
    });
    const inventoryB = await prisma.inventory.findUnique({
      where: { productId: productB.id },
    });
    expect(inventoryA?.quantityAvailable).toBe(3); // 5 - 2
    expect(inventoryB?.quantityAvailable).toBe(4); // 5 - 1

    // Cart cleared.
    const cartRes = await request(app.getHttpServer())
      .get('/cart')
      .set(...authHeader(buyer))
      .expect(200);
    expect(cartRes.body.items).toHaveLength(0);
  }, 20000);

  it('rolls back the ENTIRE checkout (no partial decrement, no order) when one line has insufficient stock', async () => {
    const category = await createCategory(
      prisma,
      `Cat RB ${run}`,
      `cat-rb-${run}`,
    );
    createdCategoryIds.push(category.id);

    const sellerA = await makeSeller(`sellerA-rb`);
    const sellerB = await makeSeller(`sellerB-rb`);
    const plentiful = await makeProduct(
      sellerA.sellerProfileId,
      category.id,
      `Plentiful ${run}`,
      10,
      10,
    );
    const scarce = await makeProduct(
      sellerB.sellerProfileId,
      category.id,
      `Scarce ${run}`,
      10,
      1,
    );

    const buyer = await registerUser(
      app,
      prisma,
      `buyer-rb-${run}@example.com`,
    );
    createdUserIds.push(buyer.id);

    await request(app.getHttpServer())
      .post('/cart/items')
      .set(...authHeader(buyer))
      .send({ productId: plentiful.id, quantity: 2 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/cart/items')
      .set(...authHeader(buyer))
      .send({ productId: scarce.id, quantity: 5 }) // only 1 in stock
      .expect(201);

    await request(app.getHttpServer())
      .post('/orders/checkout')
      .set(...authHeader(buyer))
      .expect(400);

    // No partial stock decrement on the line that WAS sufficient.
    const inventoryPlentiful = await prisma.inventory.findUnique({
      where: { productId: plentiful.id },
    });
    expect(inventoryPlentiful?.quantityAvailable).toBe(10);

    // No order/SellerOrder created at all.
    const orderCount = await prisma.order.count({
      where: { buyerId: buyer.id },
    });
    expect(orderCount).toBe(0);

    // Cart was never cleared.
    const cartRes = await request(app.getHttpServer())
      .get('/cart')
      .set(...authHeader(buyer))
      .expect(200);
    expect(cartRes.body.items).toHaveLength(2);
  }, 20000);

  it('rejects checkout for a product archived after it was added to the cart', async () => {
    const category = await createCategory(
      prisma,
      `Cat DA ${run}`,
      `cat-da-${run}`,
    );
    createdCategoryIds.push(category.id);

    const seller = await makeSeller(`seller-da`);
    const product = await makeProduct(
      seller.sellerProfileId,
      category.id,
      `Deactivated ${run}`,
      15,
      5,
    );

    const buyer = await registerUser(
      app,
      prisma,
      `buyer-da-${run}@example.com`,
    );
    createdUserIds.push(buyer.id);

    await request(app.getHttpServer())
      .post('/cart/items')
      .set(...authHeader(buyer))
      .send({ productId: product.id, quantity: 1 })
      .expect(201);

    // The seller deactivates it via the real archive endpoint AFTER it's
    // already sitting in the buyer's cart.
    await request(app.getHttpServer())
      .delete(`/products/${product.id}`)
      .set(...authHeader(seller.user))
      .expect(200);

    await request(app.getHttpServer())
      .post('/orders/checkout')
      .set(...authHeader(buyer))
      .expect(400);

    const orderCount = await prisma.order.count({
      where: { buyerId: buyer.id },
    });
    expect(orderCount).toBe(0);
  }, 20000);

  it('a duplicate checkout request with the same Idempotency-Key returns the SAME order, not a second one', async () => {
    const category = await createCategory(
      prisma,
      `Cat DUP ${run}`,
      `cat-dup-${run}`,
    );
    createdCategoryIds.push(category.id);

    const seller = await makeSeller(`seller-dup`);
    const product = await makeProduct(
      seller.sellerProfileId,
      category.id,
      `Dup Widget ${run}`,
      10,
      10,
    );

    const buyer = await registerUser(
      app,
      prisma,
      `buyer-dup-${run}@example.com`,
    );
    createdUserIds.push(buyer.id);

    await request(app.getHttpServer())
      .post('/cart/items')
      .set(...authHeader(buyer))
      .send({ productId: product.id, quantity: 1 })
      .expect(201);

    const idempotencyKey = `checkout-${run}`;

    const first = await request(app.getHttpServer())
      .post('/orders/checkout')
      .set(...authHeader(buyer))
      .set('Idempotency-Key', idempotencyKey)
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/orders/checkout')
      .set(...authHeader(buyer))
      .set('Idempotency-Key', idempotencyKey)
      .expect(201);

    expect(second.body.id).toBe(first.body.id);

    const orderCount = await prisma.order.count({
      where: { buyerId: buyer.id },
    });
    expect(orderCount).toBe(1);

    // Only decremented once, not twice.
    const inventory = await prisma.inventory.findUnique({
      where: { productId: product.id },
    });
    expect(inventory?.quantityAvailable).toBe(9); // 10 - 1, not 10 - 2
  }, 20000);
});
