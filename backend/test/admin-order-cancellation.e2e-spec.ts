import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
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

// Real-database proof for the one thing a mocked-Prisma unit test cannot
// show: that force-cancelling a SHIPPED or COMPLETED order actually
// restocks quantityAvailable, rather than merely calling the right
// method with the right arguments. See OrdersService.updateSellerOrderStatus
// and ProductsRepository.returnStock.
describe('Admin order force-cancellation (e2e, real database)', () => {
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
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await closeApp(app);
  });

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

  // A fresh, checked-out, shipped order for one test — kept independent
  // per test rather than shared, so cancelling one never affects another
  // still in flight.
  async function makeShippedOrder(
    label: string,
    quantity: number,
  ): Promise<{
    sellerOrderId: string;
    productId: string;
    seller: RegisteredUser;
  }> {
    const category = await createCategory(
      prisma,
      `Cancel Cat ${label} ${run}`,
      `cancel-cat-${label}-${run}`,
    );
    createdCategoryIds.push(category.id);

    const sellerUser = await registerUser(
      app,
      prisma,
      `cancel-seller-${label}-${run}@example.com`,
    );
    createdUserIds.push(sellerUser.id);
    const sellerProfile = await makeApprovedSeller(
      prisma,
      sellerUser.id,
      `Cancel Shop ${label} ${run}`,
    );
    createdSellerProfileIds.push(sellerProfile.id);
    const sellerAccessToken = await loginUser(app, sellerUser.email);
    const seller = { ...sellerUser, accessToken: sellerAccessToken };

    const product = await createActiveProduct(prisma, {
      sellerId: sellerProfile.id,
      categoryId: category.id,
      name: `Cancel Widget ${label} ${run}`,
      slug: `cancel-widget-${label}-${run}`,
      basePrice: 10,
      stock: 10,
    });
    createdProductIds.push(product.id);

    const buyer = await registerUser(
      app,
      prisma,
      `cancel-buyer-${label}-${run}@example.com`,
    );
    createdUserIds.push(buyer.id);

    await request(app.getHttpServer())
      .post('/cart/items')
      .set(...authHeader(buyer))
      .send({ productId: product.id, quantity })
      .expect(201);
    const checkoutRes = await request(app.getHttpServer())
      .post('/orders/checkout')
      .set(...authHeader(buyer))
      .expect(201);
    const sellerOrderId = (checkoutRes.body.sellerOrders as { id: string }[])[0]
      .id;

    await request(app.getHttpServer())
      .patch(`/orders/seller-orders/${sellerOrderId}/status`)
      .set(...authHeader(seller))
      .send({ status: 'PROCESSING' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/orders/seller-orders/${sellerOrderId}/status`)
      .set(...authHeader(seller))
      .send({ status: 'SHIPPED' })
      .expect(200);

    return { sellerOrderId, productId: product.id, seller };
  }

  it('refuses the seller, but lets an admin force-cancel a SHIPPED order — and it genuinely restocks', async () => {
    const { sellerOrderId, productId, seller } = await makeShippedOrder(
      'shipped',
      3,
    );

    const shipped = await prisma.inventory.findUniqueOrThrow({
      where: { productId },
    });
    expect(shipped.quantityAvailable).toBe(7); // 10 - 3, held then shipped
    expect(shipped.quantityReserved).toBe(0); // consumed at SHIPMENT

    // The ordinary transition table has nothing past SHIPPED for a
    // seller except COMPLETED.
    await request(app.getHttpServer())
      .patch(`/orders/seller-orders/${sellerOrderId}/status`)
      .set(...authHeader(seller))
      .send({ status: 'CANCELLED' })
      .expect(400);

    const admin = await makeAdmin('shipped-admin');
    await request(app.getHttpServer())
      .patch(`/orders/seller-orders/${sellerOrderId}/status`)
      .set(...authHeader(admin))
      .send({ status: 'CANCELLED' })
      .expect(200);

    const sellerOrder = await prisma.sellerOrder.findUniqueOrThrow({
      where: { id: sellerOrderId },
    });
    expect(sellerOrder.status).toBe('CANCELLED');

    // The genuine proof: quantityAvailable is back to where it started.
    // A pre-ship cancellation would only ever RELEASE a hold — there was
    // none left here, so this can only be the RETURN path actually
    // running against a real row.
    const restocked = await prisma.inventory.findUniqueOrThrow({
      where: { productId },
    });
    expect(restocked.quantityAvailable).toBe(10);
    expect(restocked.quantityReserved).toBe(0);

    // The sale is unwound in the ledger too — a REFUND against the
    // original SALE, and an ADJUSTMENT reversing the COMMISSION.
    const ledger = await prisma.ledgerEntry.findMany({
      where: { sellerOrderId },
    });
    const types = ledger.map((entry) => entry.type).sort();
    expect(types).toEqual(
      ['ADJUSTMENT', 'COMMISSION', 'REFUND', 'SALE'].sort(),
    );
  }, 20000);

  it('also force-cancels a COMPLETED order, restocking the same way', async () => {
    const { sellerOrderId, productId, seller } = await makeShippedOrder(
      'completed',
      2,
    );

    await request(app.getHttpServer())
      .patch(`/orders/seller-orders/${sellerOrderId}/status`)
      .set(...authHeader(seller))
      .send({ status: 'COMPLETED' })
      .expect(200);

    const admin = await makeAdmin('completed-admin');
    await request(app.getHttpServer())
      .patch(`/orders/seller-orders/${sellerOrderId}/status`)
      .set(...authHeader(admin))
      .send({ status: 'CANCELLED' })
      .expect(200);

    const restocked = await prisma.inventory.findUniqueOrThrow({
      where: { productId },
    });
    expect(restocked.quantityAvailable).toBe(10);
    expect(restocked.quantityReserved).toBe(0);
  }, 20000);

  it('an already-CANCELLED order cannot be force-cancelled again', async () => {
    const { sellerOrderId } = await makeShippedOrder('twice', 1);

    const admin = await makeAdmin('twice-admin');
    await request(app.getHttpServer())
      .patch(`/orders/seller-orders/${sellerOrderId}/status`)
      .set(...authHeader(admin))
      .send({ status: 'CANCELLED' })
      .expect(200);

    // CANCELLED is genuinely terminal — even for the admin override.
    await request(app.getHttpServer())
      .patch(`/orders/seller-orders/${sellerOrderId}/status`)
      .set(...authHeader(admin))
      .send({ status: 'CANCELLED' })
      .expect(400);
  }, 20000);
});
