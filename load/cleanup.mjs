// Removes the fixtures a load run leaves behind: the throwaway bidder
// accounts, the auction, and the AUCTION-type product created in the k6
// script's setup(). Without this, every run permanently adds a product
// to the catalogue and 50 users to the database.
//
//   node load/cleanup.mjs            # delete every past run's fixtures
//   node load/cleanup.mjs --dry-run  # list what would be deleted
//
// Matches only what the load script itself creates: emails under
// @loadtest.local and products slugged "load-test-lot-*".
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BACKEND = new URL('../backend/', import.meta.url).pathname;

require(`${BACKEND}node_modules/dotenv`).config({ path: `${BACKEND}.env` });
const { PrismaClient } = require(`${BACKEND}node_modules/@prisma/client`);
const { PrismaPg } = require(`${BACKEND}node_modules/@prisma/adapter-pg`);

const dryRun = process.argv.includes('--dry-run');
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const BIDDER_EMAIL_DOMAIN = '@loadtest.local';
const PRODUCT_SLUG_PREFIX = 'load-test-lot-';

async function main() {
  const bidders = await prisma.user.findMany({
    where: { email: { endsWith: BIDDER_EMAIL_DOMAIN } },
    select: { id: true, email: true },
  });
  const products = await prisma.product.findMany({
    where: { slug: { startsWith: PRODUCT_SLUG_PREFIX } },
    select: { id: true, slug: true },
  });
  const productIds = products.map((p) => p.id);
  const auctions = await prisma.auction.findMany({
    where: { productId: { in: productIds } },
    select: { id: true },
  });

  console.log(
    `load fixtures: ${bidders.length} bidder account(s), ` +
      `${products.length} product(s), ${auctions.length} auction(s)`,
  );
  if (dryRun) {
    console.log('(dry run — nothing deleted)');
    return;
  }
  if (!bidders.length && !products.length) {
    console.log('nothing to clean up');
    return;
  }

  const bidderIds = bidders.map((b) => b.id);
  const auctionIds = auctions.map((a) => a.id);

  // FK-safe order, mirroring the e2e teardowns: bids reference both the
  // auction and the bidder, so they go before either.
  await prisma.bid.deleteMany({ where: { auctionId: { in: auctionIds } } });
  await prisma.auction.deleteMany({ where: { id: { in: auctionIds } } });
  await prisma.inventory.deleteMany({
    where: { productId: { in: productIds } },
  });
  await prisma.outboxEvent.deleteMany({
    where: { aggregateId: { in: [...productIds, ...auctionIds] } },
  });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.refreshToken.deleteMany({
    where: { userId: { in: bidderIds } },
  });
  await prisma.cart.deleteMany({ where: { buyerId: { in: bidderIds } } });
  await prisma.user.deleteMany({ where: { id: { in: bidderIds } } });

  console.log('cleaned up');
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
