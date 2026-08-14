import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SellerOrderStatus } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { closeApp } from './support/close-app';
import {
  authHeader,
  createActiveProduct,
  createCategory,
  makeApprovedSeller,
  registerUser,
  uniqueSuffix,
} from './support/fixtures';

// The rating shown on a product page is only worth anything if the
// people behind it actually bought the thing. That is a claim about the
// database — a review row cannot exist without an OrderItem pointing at
// a COMPLETED SellerOrder owned by the author — so it is proven here
// against a real one rather than against a mocked repository.
describe('Product reviews (e2e, real database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const run = uniqueSuffix();

  let buyer: Awaited<ReturnType<typeof registerUser>>;
  let stranger: Awaited<ReturnType<typeof registerUser>>;
  let sellerUser: Awaited<ReturnType<typeof registerUser>>;
  let sellerProfileId: string;
  let categoryId: string;
  let productId: string;
  let rivalProductId: string;

  // A completed purchase of `productId` by `buyer`.
  let completedItemId: string;
  // A purchase that has NOT been completed yet.
  let pendingItemId: string;

  const createdUserIds: string[] = [];

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

    buyer = await registerUser(app, prisma, `rev-buyer-${run}@example.com`);
    stranger = await registerUser(
      app,
      prisma,
      `rev-stranger-${run}@example.com`,
    );
    sellerUser = await registerUser(
      app,
      prisma,
      `rev-seller-${run}@example.com`,
    );
    createdUserIds.push(buyer.id, stranger.id, sellerUser.id);

    const profile = await makeApprovedSeller(
      prisma,
      sellerUser.id,
      `Review Seller ${run}`,
    );
    sellerProfileId = profile.id;
    const category = await createCategory(
      prisma,
      `Review Cat ${run}`,
      `review-cat-${run}`,
    );
    categoryId = category.id;

    const product = await createActiveProduct(prisma, {
      sellerId: sellerProfileId,
      categoryId,
      name: `Reviewed Widget ${run}`,
      slug: `reviewed-widget-${run}`,
      basePrice: 10,
      stock: 50,
    });
    productId = product.id;

    const rival = await createActiveProduct(prisma, {
      sellerId: sellerProfileId,
      categoryId,
      name: `Unreviewed Widget ${run}`,
      slug: `unreviewed-widget-${run}`,
      basePrice: 10,
      stock: 50,
    });
    rivalProductId = rival.id;

    // Two orders written directly: this suite is about the review rule,
    // not about checkout, which checkout.e2e-spec.ts already covers.
    const completed = await prisma.order.create({
      data: {
        buyerId: buyer.id,
        totalAmount: 10,
        sellerOrders: {
          create: {
            sellerId: sellerProfileId,
            status: SellerOrderStatus.COMPLETED,
            subtotal: 10,
            items: { create: { productId, quantity: 1, unitPrice: 10 } },
          },
        },
      },
      include: { sellerOrders: { include: { items: true } } },
    });
    completedItemId = completed.sellerOrders[0].items[0].id;

    const pending = await prisma.order.create({
      data: {
        buyerId: buyer.id,
        totalAmount: 10,
        sellerOrders: {
          create: {
            sellerId: sellerProfileId,
            status: SellerOrderStatus.SHIPPED,
            subtotal: 10,
            items: { create: { productId, quantity: 1, unitPrice: 10 } },
          },
        },
      },
      include: { sellerOrders: { include: { items: true } } },
    });
    pendingItemId = pending.sellerOrders[0].items[0].id;
  });

  afterAll(async () => {
    await prisma.review.deleteMany({
      where: { productId: { in: [productId, rivalProductId] } },
    });
    await prisma.orderItem.deleteMany({
      where: { productId: { in: [productId, rivalProductId] } },
    });
    await prisma.sellerOrder.deleteMany({
      where: { sellerId: sellerProfileId },
    });
    await prisma.order.deleteMany({
      where: { buyerId: { in: createdUserIds } },
    });
    await prisma.inventory.deleteMany({
      where: { productId: { in: [productId, rivalProductId] } },
    });
    await prisma.product.deleteMany({ where: { sellerId: sellerProfileId } });
    await prisma.sellerProfile.deleteMany({ where: { id: sellerProfileId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.cart.deleteMany({
      where: { buyerId: { in: createdUserIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await closeApp(app);
  });

  it('lets the buyer of a COMPLETED order review what they bought', async () => {
    const res = await request(app.getHttpServer())
      .post('/reviews')
      .set(...authHeader(buyer))
      .send({
        orderItemId: completedItemId,
        rating: 5,
        comment: 'Exactly as described.',
      })
      .expect(201);

    const body = res.body as { productId: string; authorId: string };
    // Derived from the purchase, not from anything the client sent.
    expect(body.productId).toBe(productId);
    expect(body.authorId).toBe(buyer.id);
  });

  it('rejects a second review of the same purchase', async () => {
    await request(app.getHttpServer())
      .post('/reviews')
      .set(...authHeader(buyer))
      .send({ orderItemId: completedItemId, rating: 1 })
      .expect(409);
  });

  it('refuses to review an order that has not been completed', async () => {
    await request(app.getHttpServer())
      .post('/reviews')
      .set(...authHeader(buyer))
      .send({ orderItemId: pendingItemId, rating: 5 })
      .expect(403);
  });

  // IDOR: someone else's purchase is invisible, and reported as absent
  // rather than forbidden so the endpoint cannot confirm the id exists.
  it('IDOR: a stranger cannot review a purchase they did not make', async () => {
    await request(app.getHttpServer())
      .post('/reviews')
      .set(...authHeader(stranger))
      .send({ orderItemId: completedItemId, rating: 1 })
      .expect(404);
  });

  it('rejects a rating outside 1..5 and a productId smuggled into the body', async () => {
    await request(app.getHttpServer())
      .post('/reviews')
      .set(...authHeader(buyer))
      .send({ orderItemId: pendingItemId, rating: 9 })
      .expect(400);

    await request(app.getHttpServer())
      .post('/reviews')
      .set(...authHeader(buyer))
      .send({
        orderItemId: pendingItemId,
        rating: 5,
        productId: rivalProductId,
      })
      .expect(400);
  });

  it('shows the rating on the public product projection, aggregated live', async () => {
    const res = await request(app.getHttpServer())
      .get(`/products/${productId}`)
      .expect(200);

    const body = res.body as { ratingAverage: number; ratingCount: number };
    expect(body.ratingCount).toBe(1);
    expect(body.ratingAverage).toBe(5);
  });

  it('reports an unreviewed product as 0/0 rather than omitting the field', async () => {
    const res = await request(app.getHttpServer())
      .get(`/products/${rivalProductId}`)
      .expect(200);

    expect(res.body).toMatchObject({ ratingAverage: 0, ratingCount: 0 });
  });

  it('serves the reviews publicly, so a shopper can read them before buying', async () => {
    const res = await request(app.getHttpServer())
      .get(`/products/${productId}/reviews`)
      .expect(200);

    const body = res.body as Array<{ rating: number; comment: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      rating: 5,
      comment: 'Exactly as described.',
    });
  });

  it('sorts the catalogue by rating, best first', async () => {
    const res = await request(app.getHttpServer())
      .get(`/products?categoryId=${categoryId}&sort=rating`)
      .expect(200);

    const body = res.body as Array<{ id: string; ratingAverage: number }>;
    const ids = body.map((p) => p.id);
    // The reviewed 5-star product outranks the unreviewed one, which
    // sorts as 0 rather than being dropped from the catalogue.
    expect(ids.indexOf(productId)).toBeLessThan(ids.indexOf(rivalProductId));
  });

  it('rejects an unknown sort value instead of silently ignoring it', async () => {
    await request(app.getHttpServer())
      .get('/products?sort=price; DROP TABLE "Review"')
      .expect(400);
  });
});
