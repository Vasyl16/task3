import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuctionStatus } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { BiddingService } from '../src/modules/bidding/bidding.service';
import { closeApp } from './support/close-app';
import {
  authHeader,
  createActiveProduct,
  createCategory,
  loginUser,
  makeApprovedSeller,
  registerUser,
  uniqueSuffix,
} from './support/fixtures';

// Real-database integration tests for auction bidding — in particular
// the concurrency guarantee (no lost update under two genuinely
// concurrent requests), which cannot be meaningfully proven against a
// mocked Prisma client: it depends on Postgres actually serializing two
// simultaneous UPDATEs to the same row. Runs against the real
// configured DATABASE_URL (see jest-e2e-setup.ts).
describe('Bidding concurrency (e2e, real database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let biddingService: BiddingService;
  const run = uniqueSuffix();

  const createdUserIds: string[] = [];
  const createdSellerProfileIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdAuctionIds: string[] = [];

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
    biddingService = app.get(BiddingService);
  });

  afterAll(async () => {
    await prisma.bid.deleteMany({
      where: { auctionId: { in: createdAuctionIds } },
    });
    await prisma.auction.deleteMany({
      where: { id: { in: createdAuctionIds } },
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

  async function makeAuctionFixture(label: string) {
    const category = await createCategory(
      prisma,
      `Cat ${label}`,
      `cat-${label}-${run}`,
    );
    createdCategoryIds.push(category.id);

    const sellerUser = await registerUser(
      app,
      prisma,
      `seller-${label}-${run}@example.com`,
    );
    createdUserIds.push(sellerUser.id);
    const sellerProfile = await makeApprovedSeller(
      prisma,
      sellerUser.id,
      `Seller ${label} ${run}`,
    );
    createdSellerProfileIds.push(sellerProfile.id);
    const sellerToken = await loginUser(app, sellerUser.email);

    const product = await createActiveProduct(prisma, {
      sellerId: sellerProfile.id,
      categoryId: category.id,
      name: `Auction ${label} ${run}`,
      slug: `auction-${label}-${run}`,
      basePrice: 0,
      stock: 1,
      type: 'AUCTION',
    });
    createdProductIds.push(product.id);

    const auctionRes = await request(app.getHttpServer())
      .post('/auctions')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        productId: product.id,
        startingPrice: 100,
        minBidIncrement: 10,
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 3600_000).toISOString(),
      })
      .expect(201);
    createdAuctionIds.push(auctionRes.body.id);

    return { auctionId: auctionRes.body.id as string };
  }

  it('accepts a normal bid at the starting price', async () => {
    const { auctionId } = await makeAuctionFixture('normal');
    const bidder = await registerUser(
      app,
      prisma,
      `bidder-normal-${run}@example.com`,
    );
    createdUserIds.push(bidder.id);

    const res = await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set(...authHeader(bidder))
      .send({ amount: 100 })
      .expect(201);

    expect(res.body.amount).toBe('100');

    const auction = await prisma.auction.findUniqueOrThrow({
      where: { id: auctionId },
    });
    expect(Number(auction.currentHighestBid)).toBe(100);
    expect(auction.currentHighestBidderId).toBe(bidder.id);
  }, 20000);

  it('rejects a bid below the minimum acceptable amount', async () => {
    const { auctionId } = await makeAuctionFixture('minimum');
    const bidder = await registerUser(
      app,
      prisma,
      `bidder-min-${run}@example.com`,
    );
    createdUserIds.push(bidder.id);

    await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set(...authHeader(bidder))
      .send({ amount: 50 }) // starting price is 100
      .expect(400);
  }, 20000);

  it('rejects a bid placed after the deadline', async () => {
    const { auctionId } = await makeAuctionFixture('deadline');
    await prisma.auction.update({
      where: { id: auctionId },
      data: { endsAt: new Date(Date.now() - 1000) },
    });
    const bidder = await registerUser(
      app,
      prisma,
      `bidder-late-${run}@example.com`,
    );
    createdUserIds.push(bidder.id);

    await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set(...authHeader(bidder))
      .send({ amount: 100 })
      .expect(400);
  }, 20000);

  it('a duplicate bid request with the same Idempotency-Key does not place a second bid', async () => {
    const { auctionId } = await makeAuctionFixture('dup');
    const bidder = await registerUser(
      app,
      prisma,
      `bidder-dup-${run}@example.com`,
    );
    createdUserIds.push(bidder.id);
    const idempotencyKey = `bid-${run}`;

    const first = await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set(...authHeader(bidder))
      .set('Idempotency-Key', idempotencyKey)
      .send({ amount: 100 })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set(...authHeader(bidder))
      .set('Idempotency-Key', idempotencyKey)
      .send({ amount: 100 })
      .expect(201);

    expect(second.body.id).toBe(first.body.id);

    const bidCount = await prisma.bid.count({ where: { auctionId } });
    expect(bidCount).toBe(1);
  }, 20000);

  // THE concurrency proof: two different bidders fire the SAME next bid
  // amount at genuinely the same time (Promise.all — both requests are
  // in flight against the real database simultaneously, not sequenced by
  // the test). Exactly one must win; the other must be correctly
  // rejected — never both accepted (which would silently overwrite one
  // bidder's win) and never both rejected (which would mean a valid bid
  // was lost).
  it('two concurrent bids for the same amount produce exactly one accepted bid — no lost update', async () => {
    const { auctionId } = await makeAuctionFixture('concurrent');
    const bidderA = await registerUser(
      app,
      prisma,
      `bidder-concA-${run}@example.com`,
    );
    const bidderB = await registerUser(
      app,
      prisma,
      `bidder-concB-${run}@example.com`,
    );
    createdUserIds.push(bidderA.id, bidderB.id);

    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post(`/auctions/${auctionId}/bids`)
        .set(...authHeader(bidderA))
        .send({ amount: 110 })
        .then((res) => res),
      request(app.getHttpServer())
        .post(`/auctions/${auctionId}/bids`)
        .set(...authHeader(bidderB))
        .send({ amount: 110 })
        .then((res) => res),
    ]);

    const statuses = [resA.status, resB.status].sort();
    // One succeeds (201); the other is correctly rejected once it
    // retries against the new state and finds 110 no longer meets the
    // (now higher) minimum acceptable bid (400) — see
    // BiddingService.placeBid's retry loop.
    expect(statuses).toEqual([201, 400]);

    // Exactly one Bid row was created for this amount/pair — not zero,
    // not two.
    const bids = await prisma.bid.findMany({ where: { auctionId } });
    expect(bids).toHaveLength(1);

    const auction = await prisma.auction.findUniqueOrThrow({
      where: { id: auctionId },
    });
    expect(Number(auction.currentHighestBid)).toBe(110);
    expect([bidderA.id, bidderB.id]).toContain(auction.currentHighestBidderId);
    // version was bumped exactly once (0 -> 1), not twice — confirms
    // only one UPDATE actually applied.
    expect(auction.version).toBe(1);
  }, 20000);

  it('winner determination: endAuction sets ENDED, records the winner, and opens the checkout window', async () => {
    const { auctionId } = await makeAuctionFixture('winner');
    const bidder = await registerUser(
      app,
      prisma,
      `bidder-winner-${run}@example.com`,
    );
    createdUserIds.push(bidder.id);

    await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set(...authHeader(bidder))
      .send({ amount: 100 })
      .expect(201);

    // Simulates the deadline arriving (normally driven by the BullMQ
    // delayed job or the AuctionDeadlineSweeperService — see
    // BiddingService.endAuction's doc comment).
    await biddingService.endAuction(auctionId);

    const auction = await prisma.auction.findUniqueOrThrow({
      where: { id: auctionId },
    });
    expect(auction.status).toBe(AuctionStatus.ENDED);
    expect(auction.currentHighestBidderId).toBe(bidder.id);
    expect(auction.checkoutDeadline).not.toBeNull();
    expect(auction.checkoutDeadline!.getTime()).toBeGreaterThan(Date.now());
  }, 20000);

  it('an auction with no bids expires directly, with no checkout window', async () => {
    const { auctionId } = await makeAuctionFixture('nobids');

    await biddingService.endAuction(auctionId);

    const auction = await prisma.auction.findUniqueOrThrow({
      where: { id: auctionId },
    });
    expect(auction.status).toBe(AuctionStatus.EXPIRED);
    expect(auction.checkoutDeadline).toBeNull();
  }, 20000);
});
