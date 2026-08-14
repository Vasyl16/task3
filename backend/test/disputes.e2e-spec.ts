import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SellerOrderStatus, UserRole } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { closeApp } from './support/close-app';
import {
  authHeader,
  loginUser,
  makeApprovedSeller,
  registerUser,
  uniqueSuffix,
  type RegisteredUser,
} from './support/fixtures';

// Real-database proof that a dispute's access rule is exactly three
// people: the buyer who raised it, any admin, and the SELLER whose
// shipment it is about — the last of whom is new. A mocked-repository
// unit test can prove the branching logic; it cannot prove the seller
// genuinely gets past NestJS's guards over real HTTP and genuinely
// cannot read or post to a dispute about someone else's shipment.
describe('Dispute access (e2e, real database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const run = uniqueSuffix();

  const createdUserIds: string[] = [];
  const createdSellerProfileIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdDisputeIds: string[] = [];

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
    await prisma.disputeComment.deleteMany({
      where: { disputeId: { in: createdDisputeIds } },
    });
    await prisma.dispute.deleteMany({
      where: { id: { in: createdDisputeIds } },
    });
    await prisma.orderItem.deleteMany({
      where: { productId: { in: createdProductIds } },
    });
    await prisma.sellerOrder.deleteMany({
      where: { sellerId: { in: createdSellerProfileIds } },
    });
    await prisma.order.deleteMany({
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

  async function makeApprovedSellerUser(
    label: string,
  ): Promise<RegisteredUser> {
    const user = await registerUser(app, prisma, `${label}-${run}@example.com`);
    createdUserIds.push(user.id);
    // Promotes the USER's role to SELLER as well as creating the
    // profile — the JWT's role claim is what the access check reads,
    // and a stale CUSTOMER claim would 404 a genuinely-owning seller.
    const profile = await makeApprovedSeller(
      prisma,
      user.id,
      `${label} Shop ${run}`,
    );
    createdSellerProfileIds.push(profile.id);
    // Re-login: the token from registerUser() predates the promotion
    // above and still carries the stale CUSTOMER claim.
    const accessToken = await loginUser(app, user.email);
    return { ...user, accessToken };
  }

  // A completed purchase from `seller`, with a dispute already raised
  // against it by a fresh buyer.
  async function makeDisputedOrder(
    label: string,
    seller: RegisteredUser,
  ): Promise<{ disputeId: string; buyer: RegisteredUser }> {
    const category = await prisma.category.create({
      data: {
        name: `Dispute Cat ${label} ${run}`,
        slug: `dispute-cat-${label}-${run}`,
      },
    });
    createdCategoryIds.push(category.id);

    const sellerProfile = await prisma.sellerProfile.findUniqueOrThrow({
      where: { userId: seller.id },
    });
    const product = await prisma.product.create({
      data: {
        sellerId: sellerProfile.id,
        categoryId: category.id,
        name: `Dispute Widget ${label} ${run}`,
        slug: `dispute-widget-${label}-${run}`,
        basePrice: 20,
        status: 'ACTIVE',
      },
    });
    createdProductIds.push(product.id);
    await prisma.inventory.create({
      data: { productId: product.id, quantityAvailable: 10 },
    });

    const buyer = await registerUser(
      app,
      prisma,
      `dispute-buyer-${label}-${run}@example.com`,
    );
    createdUserIds.push(buyer.id);

    const order = await prisma.order.create({
      data: {
        buyerId: buyer.id,
        totalAmount: 20,
        sellerOrders: {
          create: {
            sellerId: sellerProfile.id,
            status: SellerOrderStatus.COMPLETED,
            subtotal: 20,
            items: {
              create: { productId: product.id, quantity: 1, unitPrice: 20 },
            },
          },
        },
      },
      include: { sellerOrders: true },
    });
    const sellerOrderId = order.sellerOrders[0].id;

    const raiseRes = await request(app.getHttpServer())
      .post('/disputes')
      .set(...authHeader(buyer))
      .send({
        sellerOrderId,
        reason: 'The item arrived with visible shipping damage.',
      })
      .expect(201);
    const disputeId = raiseRes.body.id as string;
    createdDisputeIds.push(disputeId);

    return { disputeId, buyer };
  }

  it('lets the seller whose shipment it is read the dispute, its thread, and reply to it', async () => {
    const sellerA = await makeApprovedSellerUser('seller-a-access');
    const { disputeId } = await makeDisputedOrder('access', sellerA);

    const getRes = await request(app.getHttpServer())
      .get(`/disputes/${disputeId}`)
      .set(...authHeader(sellerA))
      .expect(200);
    // Widened access is specifically about seeing the PURCHASE, not just
    // the bare dispute row.
    expect(getRes.body.sellerOrder).toBeDefined();
    expect(getRes.body.sellerOrder.items).toHaveLength(1);

    await request(app.getHttpServer())
      .get(`/disputes/${disputeId}/comments`)
      .set(...authHeader(sellerA))
      .expect(200);

    const commentRes = await request(app.getHttpServer())
      .post(`/disputes/${disputeId}/comments`)
      .set(...authHeader(sellerA))
      .send({ body: 'Tracking shows this was delivered undamaged on our end.' })
      .expect(201);
    expect(commentRes.body.authorId).toBe(sellerA.id);
  });

  // IDOR: shipping something ELSE does not grant access to a dispute
  // about a different seller's order.
  it('404s a different seller whose shipment this dispute is NOT about', async () => {
    const sellerA = await makeApprovedSellerUser('seller-a-idor');
    const sellerB = await makeApprovedSellerUser('seller-b-idor');
    const { disputeId } = await makeDisputedOrder('idor', sellerA);

    await request(app.getHttpServer())
      .get(`/disputes/${disputeId}`)
      .set(...authHeader(sellerB))
      .expect(404);
    await request(app.getHttpServer())
      .get(`/disputes/${disputeId}/comments`)
      .set(...authHeader(sellerB))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/disputes/${disputeId}/comments`)
      .set(...authHeader(sellerB))
      .send({ body: 'trying to reply anyway' })
      .expect(404);
  });

  it('lists the dispute under GET /disputes/seller for the owning seller only', async () => {
    const sellerA = await makeApprovedSellerUser('seller-a-list');
    const sellerB = await makeApprovedSellerUser('seller-b-list');
    const { disputeId } = await makeDisputedOrder('list', sellerA);

    const asA = await request(app.getHttpServer())
      .get('/disputes/seller')
      .set(...authHeader(sellerA))
      .expect(200);
    expect(asA.body.items.some((d: { id: string }) => d.id === disputeId)).toBe(
      true,
    );

    const asB = await request(app.getHttpServer())
      .get('/disputes/seller')
      .set(...authHeader(sellerB))
      .expect(200);
    expect(asB.body.items.some((d: { id: string }) => d.id === disputeId)).toBe(
      false,
    );
  });

  it('a non-seller (customer role) cannot reach the seller queue at all', async () => {
    const customer = await registerUser(
      app,
      prisma,
      `dispute-customer-${run}@example.com`,
    );
    createdUserIds.push(customer.id);

    await request(app.getHttpServer())
      .get('/disputes/seller')
      .set(...authHeader(customer))
      .expect(403);
  });

  it('admin keeps full access regardless of who owns the shipment', async () => {
    const sellerA = await makeApprovedSellerUser('seller-a-admin');
    const { disputeId } = await makeDisputedOrder('admin', sellerA);
    const admin = await makeAdmin('dispute-admin');

    const res = await request(app.getHttpServer())
      .get(`/disputes/${disputeId}`)
      .set(...authHeader(admin))
      .expect(200);
    expect(res.body.id).toBe(disputeId);

    await request(app.getHttpServer())
      .post(`/disputes/${disputeId}/comments`)
      .set(...authHeader(admin))
      .send({ body: 'Reviewing this now.' })
      .expect(201);
  });
});
