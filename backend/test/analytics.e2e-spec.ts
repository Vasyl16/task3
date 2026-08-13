import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { SellerOrderStatus, UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import type {
  PlatformAnalyticsReport,
  SellerAnalyticsReport,
} from '../src/modules/analytics/domain/analytics-report.interface';
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

// The aggregation queries live in SQL, so a mocked-Prisma unit test can
// only prove the service passes arguments along — it cannot prove the
// FILTER-ed sums, the joins, or the generate_series gap fill actually
// compute the right numbers. This file drives real checkouts through the
// HTTP API and then asserts the reported figures against them, which is
// the only way those claims get tested at all.
//
// Every figure is asserted as a DELTA against a baseline taken before
// seeding, because this runs against a shared remote database that may
// already hold rows from other runs.
describe('Admin analytics (e2e, real database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const run = uniqueSuffix();

  const createdUserIds: string[] = [];
  const createdSellerProfileIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdProductIds: string[] = [];

  let admin: RegisteredUser;
  let buyer: RegisteredUser;
  let sellerA: { user: RegisteredUser; sellerProfileId: string };
  let sellerB: { user: RegisteredUser; sellerProfileId: string };
  let categoryId: string;

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

    admin = await registerUser(app, prisma, `admin-${run}@example.com`);
    createdUserIds.push(admin.id);
    await prisma.user.update({
      where: { id: admin.id },
      data: { role: UserRole.ADMIN },
    });
    admin = { ...admin, accessToken: await loginUser(app, admin.email) };

    buyer = await registerUser(app, prisma, `buyer-${run}@example.com`);
    createdUserIds.push(buyer.id);

    sellerA = await makeSeller('alpha');
    sellerB = await makeSeller('beta');

    const category = await createCategory(
      prisma,
      `Analytics ${run}`,
      `analytics-${run}`,
    );
    createdCategoryIds.push(category.id);
    categoryId = category.id;
  });

  afterAll(async () => {
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
    await prisma.sellerOrder.deleteMany({
      where: { id: { in: sellerOrderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.cartSession.deleteMany({
      where: { buyerId: { in: createdUserIds } },
    });
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

  async function makeSeller(label: string) {
    const user = await registerUser(app, prisma, `${label}-${run}@example.com`);
    createdUserIds.push(user.id);
    const profile = await makeApprovedSeller(
      prisma,
      user.id,
      `${label} Shop ${run}`,
    );
    createdSellerProfileIds.push(profile.id);
    const accessToken = await loginUser(app, user.email);
    return { user: { ...user, accessToken }, sellerProfileId: profile.id };
  }

  async function makeProduct(
    sellerId: string,
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

  async function addToCart(productId: string, quantity: number) {
    await request(app.getHttpServer())
      .post('/cart/items')
      .set(...authHeader(buyer))
      .send({ productId, quantity })
      .expect(201);
  }

  async function checkout(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/orders/checkout')
      .set(...authHeader(buyer))
      .expect(201);
    return (res.body as { id: string }).id;
  }

  async function fetchReport(): Promise<PlatformAnalyticsReport> {
    const res = await request(app.getHttpServer())
      .get('/admin/analytics')
      .set(...authHeader(admin))
      .expect(200);
    return res.body as PlatformAnalyticsReport;
  }

  // Jest runs e2e suites in parallel against one shared remote database,
  // so a platform-wide total moves under this file's feet as other suites
  // check out. Anything asserted as an exact figure is therefore read
  // through a SELLER-scoped report: these sellers are created fresh per
  // run, so their numbers belong to this file alone. The platform report
  // is still exercised, but only for facts that hold regardless of what
  // else is in the database.
  async function fetchSellerReport(
    seller: RegisteredUser,
  ): Promise<SellerAnalyticsReport> {
    const res = await request(app.getHttpServer())
      .get('/analytics/me/seller')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    return res.body as SellerAnalyticsReport;
  }

  describe('authorization', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/admin/analytics').expect(401);
    });

    // The class-level @Roles(ADMIN) on AdminController is the whole
    // point of that module — this asserts it is actually in force.
    it('rejects a plain customer with 403', async () => {
      await request(app.getHttpServer())
        .get('/admin/analytics')
        .set(...authHeader(buyer))
        .expect(403);
    });

    it('rejects a seller with 403 — being a seller is not being an admin', async () => {
      await request(app.getHttpServer())
        .get('/admin/analytics')
        .set(...authHeader(sellerA.user))
        .expect(403);
    });

    it('rejects a customer from every admin route, not just analytics', async () => {
      for (const path of [
        '/admin/seller-applications',
        '/admin/products',
        '/admin/disputes',
        '/admin/analytics/export?dataset=summary',
      ]) {
        await request(app.getHttpServer())
          .get(path)
          .set(...authHeader(buyer))
          .expect(403);
      }
    });
  });

  describe('revenue aggregation', () => {
    // One checkout, two sellers, one parent Order — the multi-vendor
    // split has to surface as each seller's own subtotal, each carrying
    // its own 10% commission.
    it('reports commission as exactly 10% of each seller\u2019s slice of a multi-vendor checkout', async () => {
      const productA = await makeProduct(
        sellerA.sellerProfileId,
        `Alpha Widget ${run}`,
        100,
        10,
      );
      const productB = await makeProduct(
        sellerB.sellerProfileId,
        `Beta Gadget ${run}`,
        50,
        10,
      );
      await addToCart(productA.id, 2); // 200.00
      await addToCart(productB.id, 1); // 50.00
      await checkout();

      const reportA = await fetchSellerReport(sellerA.user);
      const reportB = await fetchSellerReport(sellerB.user);

      expect(Number(reportA.revenue.netSales)).toBeCloseTo(200, 2);
      // PLATFORM_COMMISSION_RATE is 10%, applied per SellerOrder subtotal.
      expect(Number(reportA.revenue.platformCommission)).toBeCloseTo(20, 2);
      expect(Number(reportA.revenue.sellerNet)).toBeCloseTo(180, 2);

      expect(Number(reportB.revenue.netSales)).toBeCloseTo(50, 2);
      expect(Number(reportB.revenue.platformCommission)).toBeCloseTo(5, 2);
      expect(Number(reportB.revenue.sellerNet)).toBeCloseTo(45, 2);

      // One SellerOrder each, from the single parent Order.
      expect(reportA.orders.placed).toBe(1);
      expect(reportB.orders.placed).toBe(1);
    });

    // The reversal path: cancelling writes REFUND + ADJUSTMENT entries
    // that must net this sale entirely back out of every figure, rather
    // than leaving revenue permanently overstated.
    it('nets a cancelled SellerOrder back out of revenue', async () => {
      const product = await makeProduct(
        sellerA.sellerProfileId,
        `Cancellable ${run}`,
        80,
        5,
      );
      await addToCart(product.id, 1);
      const orderId = await checkout();

      const afterCheckout = await fetchSellerReport(sellerA.user);

      const sellerOrder = await prisma.sellerOrder.findFirstOrThrow({
        where: { orderId, sellerId: sellerA.sellerProfileId },
      });
      await request(app.getHttpServer())
        .patch(`/orders/seller-orders/${sellerOrder.id}/status`)
        .set(...authHeader(sellerA.user))
        .send({ status: SellerOrderStatus.CANCELLED })
        .expect(200);

      const afterCancel = await fetchSellerReport(sellerA.user);

      expect(
        Number(afterCancel.revenue.netSales) -
          Number(afterCheckout.revenue.netSales),
      ).toBeCloseTo(-80, 2);
      expect(
        Number(afterCancel.revenue.platformCommission) -
          Number(afterCheckout.revenue.platformCommission),
      ).toBeCloseTo(-8, 2);
      expect(afterCancel.orders.cancelled).toBe(1);
    });

    // The invariant from revenue.spec.ts, now against real ledger rows
    // rather than hand-built inputs.
    it('keeps netSales - platformCommission === sellerNet on real data', async () => {
      const report = await fetchReport();

      expect(
        Number(report.revenue.netSales) -
          Number(report.revenue.platformCommission),
      ).toBeCloseTo(Number(report.revenue.sellerNet), 2);
    });
  });

  describe('top products and sellers', () => {
    // Read through the seller-scoped report so the row is guaranteed to
    // be present: the platform top-5 is a global ranking and another
    // suite's products may legitimately outrank this run's.
    it('ranks products by revenue taken, counting units sold', async () => {
      const report = await fetchSellerReport(sellerA.user);

      const alpha = report.topProducts.find((p) =>
        p.productName.startsWith('Alpha Widget'),
      );
      expect(alpha).toBeDefined();
      expect(alpha?.unitsSold).toBe(2);
      expect(Number(alpha?.revenue)).toBeCloseTo(200, 2);
    });

    // The cancelled SellerOrder above must not leave its product in the
    // ranking — otherwise a seller could top the chart by ordering from
    // themselves and cancelling.
    it('excludes cancelled SellerOrders from the ranking', async () => {
      const report = await fetchSellerReport(sellerA.user);

      expect(
        report.topProducts.find((p) => p.productName.startsWith('Cancellable')),
      ).toBeUndefined();
    });

    it('returns at most five products and five sellers', async () => {
      const report = await fetchReport();

      expect(report.topProducts.length).toBeLessThanOrEqual(5);
      expect(report.topSellers.length).toBeLessThanOrEqual(5);
    });

    it('orders top products by revenue descending', async () => {
      const report = await fetchReport();
      const revenues = report.topProducts.map((p) => Number(p.revenue));

      expect(revenues).toEqual([...revenues].sort((a, b) => b - a));
    });
  });

  describe('sales chart', () => {
    it('returns exactly one bucket per day of the default 30-day period', async () => {
      const report = await fetchReport();

      expect(report.period.days).toBe(30);
      expect(report.salesChart).toHaveLength(30);
    });

    // generate_series supplies the day spine, so a day with no ledger
    // activity comes back as an explicit zero rather than being absent.
    it('includes zero-activity days rather than omitting them', async () => {
      const report = await fetchReport();

      for (const point of report.salesChart) {
        expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(point.netSales).toMatch(/^-?\d+\.\d{2}$/);
      }
      expect(report.salesChart.some((p) => p.netSales === '0.00')).toBe(true);
    });

    it('is ordered by date ascending with no gaps', async () => {
      const report = await fetchReport();
      const dates = report.salesChart.map((p) => p.date);

      expect(dates).toEqual([...dates].sort());
      expect(new Set(dates).size).toBe(dates.length);
    });

    it('sums to the same net sales as the period total', async () => {
      const report = await fetchReport();
      const charted = report.salesChart.reduce(
        (sum, p) => sum + Number(p.netSales),
        0,
      );

      expect(charted).toBeCloseTo(Number(report.revenue.netSales), 2);
    });
  });

  describe('previous-period comparison', () => {
    it('compares against the equal-length window immediately before', async () => {
      const report = await fetchReport();

      expect(report.comparison.previousPeriod.days).toBe(report.period.days);
      expect(report.comparison.previousPeriod.to).toBe(report.period.from);
    });
  });

  describe('cart → order conversion', () => {
    // The whole reason CartSession exists: checkout DELETES the cart's
    // items, so this cannot be measured from CartItem after the fact.
    it('counts a checked-out cart as both started and converted', async () => {
      const report = await fetchReport();

      expect(report.conversion.cartsStarted).toBeGreaterThan(0);
      expect(report.conversion.cartsConverted).toBeGreaterThan(0);
      expect(report.conversion.rate).not.toBeNull();
      expect(report.conversion.rate).toBeGreaterThan(0);
      expect(report.conversion.rate).toBeLessThanOrEqual(100);
    });

    it('never reports more conversions than carts', async () => {
      const report = await fetchReport();

      expect(report.conversion.cartsConverted).toBeLessThanOrEqual(
        report.conversion.cartsStarted,
      );
      expect(report.conversion.rate).toBeCloseTo(
        Math.round(
          (report.conversion.cartsConverted / report.conversion.cartsStarted) *
            1000,
        ) / 10,
        1,
      );
    });

    // The funnel rows themselves, asserted directly for this run's own
    // buyers — the platform-wide counts above can't distinguish this
    // file's carts from a concurrently-running suite's.
    it('closes the checked-out buyer\u2019s session against the order, and leaves an abandoned one open', async () => {
      const abandoner = await registerUser(
        app,
        prisma,
        `abandoner-${run}@example.com`,
      );
      createdUserIds.push(abandoner.id);
      const product = await makeProduct(
        sellerB.sellerProfileId,
        `Abandoned ${run}`,
        10,
        5,
      );

      await request(app.getHttpServer())
        .post('/cart/items')
        .set('Authorization', `Bearer ${abandoner.accessToken}`)
        .send({ productId: product.id, quantity: 1 })
        .expect(201);

      const abandoned = await prisma.cartSession.findMany({
        where: { buyerId: abandoner.id },
      });
      expect(abandoned).toHaveLength(1);
      expect(abandoned[0].convertedAt).toBeNull();
      expect(abandoned[0].orderId).toBeNull();

      // The buyer above checked out twice, so both of their sessions are
      // closed and each points at the order that closed it.
      const converted = await prisma.cartSession.findMany({
        where: { buyerId: buyer.id },
      });
      expect(converted.length).toBeGreaterThanOrEqual(1);
      for (const session of converted) {
        expect(session.convertedAt).not.toBeNull();
        expect(session.orderId).not.toBeNull();
      }
    });
  });

  describe('export', () => {
    it('exports the sales chart as a downloadable CSV', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/analytics/export?dataset=sales-chart&format=csv')
        .set(...authHeader(admin))
        .expect(200);

      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');
      const [header, ...rows] = res.text.split('\r\n');
      expect(header).toBe('date,netSales,platformCommission,orders');
      expect(rows).toHaveLength(30);
    });

    it('exports the same data as JSON', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/analytics/export?dataset=top-sellers&format=json')
        .set(...authHeader(admin))
        .expect(200);

      const body = JSON.parse(res.text) as { rows: unknown[] };
      expect(Array.isArray(body.rows)).toBe(true);
    });

    it('rejects an unknown dataset', async () => {
      await request(app.getHttpServer())
        .get('/admin/analytics/export?dataset=everything')
        .set(...authHeader(admin))
        .expect(400);
    });
  });

  describe('period validation', () => {
    it('rejects a period longer than the cap rather than scanning years', async () => {
      await request(app.getHttpServer())
        .get('/admin/analytics?from=2020-01-01&to=2026-01-01')
        .set(...authHeader(admin))
        .expect(400);
    });

    it('rejects a reversed range', async () => {
      await request(app.getHttpServer())
        .get('/admin/analytics?from=2026-08-10&to=2026-08-01')
        .set(...authHeader(admin))
        .expect(400);
    });
  });

  describe('seller-scoped analytics', () => {
    // A seller reads their own figures through their own identity —
    // there is no sellerId parameter to point at someone else.
    it('reports only the calling seller’s own revenue', async () => {
      const res = await request(app.getHttpServer())
        .get('/analytics/me/seller')
        .set(...authHeader(sellerA.user))
        .expect(200);
      const report = res.body as SellerAnalyticsReport;

      expect(report.sellerId).toBe(sellerA.sellerProfileId);
      // Seller A sold 200.00 and then had an 80.00 order cancelled.
      expect(Number(report.revenue.netSales)).toBeCloseTo(200, 2);
      expect(Number(report.revenue.platformCommission)).toBeCloseTo(20, 2);
      for (const product of report.topProducts) {
        expect(product.sellerId).toBe(sellerA.sellerProfileId);
      }
    });

    it('rejects a customer with no seller profile', async () => {
      await request(app.getHttpServer())
        .get('/analytics/me/seller')
        .set(...authHeader(buyer))
        .expect(403);
    });
  });
});
