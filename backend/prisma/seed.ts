// Dev/demo seed data: categories, approved sellers, a full catalog of
// fixed-price products, and a live auction per seller — then synced into
// Meilisearch so the seeded catalog is actually searchable, not just
// present in Postgres.
//
// Every Postgres write is an upsert keyed by a real unique constraint
// (email, slug, userId, productId) — safe to run repeatedly against the
// same database without duplicating rows or clobbering anything a manual
// test session already changed (see the database skill: no destructive
// statements here, ever). The Meilisearch sync is likewise a re-runnable
// upsert (addDocuments), never a delete-then-recreate.
//
// Run with: npm run seed  (from backend/)
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  AuctionStatus,
  PrismaClient,
  ProductStatus,
  ProductType,
  SellerProfileStatus,
  UserRole,
  type Category,
  type Product,
  type SellerProfile,
  type User,
} from '@prisma/client';

// Matches AuthService's own cost factor (see
// src/modules/auth/auth.service.ts) — a seeded account should be
// indistinguishable from a real registration, just with a known password.
const BCRYPT_ROUNDS = 12;

// Obviously-fake, same password for every seeded account — dev fixture
// data, the same pattern test/support/fixtures.ts already uses for its
// own seeded users. Not a real credential, so it living in source is fine
// (see .claude/rules/general.md's "no secrets in code" — this isn't one).
const SEED_PASSWORD = 'SeedPass123!';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// ===================== Meilisearch sync =====================
//
// Mirrors src/modules/search/consumers/search-sync.consumer.ts's
// syncProduct exactly (same document shape, same index, same upsert
// call) rather than going through the real ProductCreated -> Outbox ->
// BullMQ -> SearchSyncConsumer pipeline: this script runs standalone,
// with no worker process around to drain that queue. Re-implementing the
// sync as a direct call is what makes the seeded catalog searchable
// immediately, without needing the full app running first.
//
// Same env vars and defaults as src/config/configuration.ts's
// `meilisearch` section, and the same index name as
// src/infrastructure/meilisearch/meilisearch.service.ts's
// PRODUCTS_INDEX — duplicated here rather than imported so this script
// stays a plain Node/Prisma script with no Nest DI container to bootstrap.
const MEILISEARCH_HOST =
  process.env.MEILISEARCH_HOST ?? 'http://localhost:7700';
const MEILI_MASTER_KEY =
  process.env.MEILI_MASTER_KEY ?? 'changeme_dev_master_key';
const PRODUCTS_INDEX = 'products';

interface ProductSearchDocument {
  id: string;
  name: string;
  description: string | null;
  basePrice: number;
  categoryId: string;
  categoryName: string;
  sellerId: string;
  sellerName: string;
  sellerRating: number | null;
  type: string;
  inStock: boolean;
  quantityAvailable: number;
  createdAt: number;
}

// `meilisearch` ships ESM-only — same dynamic-import interop the real
// MeilisearchService uses, for the same reason (this script runs under
// ts-node/CommonJS).
async function getMeilisearchIndex() {
  const { Meilisearch } = await import('meilisearch');
  const client = new Meilisearch({
    host: MEILISEARCH_HOST,
    apiKey: MEILI_MASTER_KEY,
  });

  // Idempotent (updateSettings is a full replace) — configures the index
  // if this is the first thing to ever touch it, harmless to repeat
  // otherwise. Failure here is a warning, not fatal: the rest of the
  // seed run (the actual Postgres data) must not be lost just because
  // Meilisearch happens to be unreachable right now.
  try {
    await client.index(PRODUCTS_INDEX).updateSettings({
      searchableAttributes: [
        'name',
        'description',
        'categoryName',
        'sellerName',
      ],
      filterableAttributes: [
        'categoryId',
        'sellerId',
        'basePrice',
        'sellerRating',
        'inStock',
        'type',
      ],
      sortableAttributes: ['basePrice', 'createdAt', 'sellerRating'],
    });
  } catch (err) {
    console.warn(
      `Could not configure Meilisearch index settings (search will still work once it's reachable): ${(err as Error).message}`,
    );
  }

  return client.index(PRODUCTS_INDEX);
}

// Re-reads from Postgres rather than trusting the caller's in-memory
// values, exactly like the real consumer does — the point of the sync is
// that Meilisearch reflects committed Postgres state, not whatever this
// script happened to compute a moment earlier.
async function syncProductToSearch(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || product.status === ProductStatus.ARCHIVED) {
    return;
  }

  const [category, seller, inventory, ratingAgg] = await Promise.all([
    prisma.category.findUniqueOrThrow({ where: { id: product.categoryId } }),
    prisma.sellerProfile.findUniqueOrThrow({ where: { id: product.sellerId } }),
    prisma.inventory.findUnique({ where: { productId } }),
    prisma.review.aggregate({
      where: { sellerId: product.sellerId },
      _avg: { rating: true },
    }),
  ]);

  const doc: ProductSearchDocument = {
    id: product.id,
    name: product.name,
    description: product.description,
    basePrice: Number(product.basePrice),
    categoryId: product.categoryId,
    categoryName: category.name,
    sellerId: product.sellerId,
    sellerName: seller.businessName,
    sellerRating: ratingAgg._avg.rating,
    type: product.type,
    inStock:
      (inventory?.quantityAvailable ?? 0) - (inventory?.quantityReserved ?? 0) >
      0,
    quantityAvailable: inventory?.quantityAvailable ?? 0,
    createdAt: product.createdAt.getTime(),
  };

  const index = await getMeilisearchIndex();
  await index.addDocuments([doc], { primaryKey: 'id' });
}

// ===================== Seed data =====================

const CATEGORIES = [
  { name: 'Electronics', slug: 'electronics' },
  { name: 'Home & Garden', slug: 'home-garden' },
  { name: 'Collectibles', slug: 'collectibles' },
  { name: 'Fashion', slug: 'fashion' },
  { name: 'Sports & Outdoors', slug: 'sports-outdoors' },
  { name: 'Books', slug: 'books' },
  { name: 'Toys & Games', slug: 'toys-games' },
] as const;

interface ProductSeed {
  name: string;
  slug: string;
  description: string;
  basePrice: number;
  stock: number;
  categorySlug: (typeof CATEGORIES)[number]['slug'];
}

interface AuctionSeed {
  name: string;
  slug: string;
  description: string;
  startingPrice: number;
  minBidIncrement: number;
  durationHours: number;
  categorySlug: (typeof CATEGORIES)[number]['slug'];
}

interface SellerSeed {
  email: string;
  name: string;
  businessName: string;
  products: ProductSeed[];
  auction: AuctionSeed;
}

const SELLERS: SellerSeed[] = [
  {
    email: 'aurora@seed.marketplace.test',
    name: 'Aurora Chen',
    businessName: 'Aurora Electronics',
    products: [
      {
        name: 'Wireless Headphones',
        slug: 'wireless-headphones',
        description:
          'Noise-cancelling over-ear headphones with 30-hour battery life.',
        basePrice: 89.99,
        stock: 40,
        categorySlug: 'electronics',
      },
      {
        name: 'Mechanical Keyboard',
        slug: 'mechanical-keyboard',
        description: 'Hot-swappable mechanical keyboard with tactile switches.',
        basePrice: 129.0,
        stock: 25,
        categorySlug: 'electronics',
      },
      {
        name: 'Smart Watch',
        slug: 'smart-watch',
        description: 'Fitness-tracking smart watch with heart-rate monitor.',
        basePrice: 199.5,
        stock: 15,
        categorySlug: 'electronics',
      },
      {
        name: '4K Action Camera',
        slug: '4k-action-camera',
        description: 'Waterproof 4K action camera with image stabilization.',
        basePrice: 249.0,
        stock: 12,
        categorySlug: 'electronics',
      },
      {
        name: 'Portable Bluetooth Speaker',
        slug: 'portable-bluetooth-speaker',
        description: 'Compact splash-proof speaker with 20-hour playback.',
        basePrice: 59.99,
        stock: 60,
        categorySlug: 'electronics',
      },
    ],
    auction: {
      name: 'Limited Edition Studio Speaker',
      slug: 'limited-edition-studio-speaker',
      description: 'One-of-a-kind studio monitor speaker, numbered edition.',
      startingPrice: 50,
      minBidIncrement: 5,
      durationHours: 72,
      categorySlug: 'electronics',
    },
  },
  {
    email: 'vintage@seed.marketplace.test',
    name: 'Marco Delgado',
    businessName: 'Vintage Finds Co',
    products: [
      {
        name: 'Vintage Film Camera',
        slug: 'vintage-film-camera',
        description: 'Fully working 1970s 35mm film camera, recently serviced.',
        basePrice: 150.0,
        stock: 5,
        categorySlug: 'collectibles',
      },
      {
        name: 'Antique Brass Lamp',
        slug: 'antique-brass-lamp',
        description: 'Restored antique brass table lamp with a new cloth cord.',
        basePrice: 75.0,
        stock: 8,
        categorySlug: 'home-garden',
      },
      {
        name: '1960s Vinyl Record Set',
        slug: '1960s-vinyl-record-set',
        description: 'A curated set of ten original-pressing 1960s vinyl LPs.',
        basePrice: 45.0,
        stock: 20,
        categorySlug: 'collectibles',
      },
      {
        name: 'Hand-Carved Wooden Chest',
        slug: 'hand-carved-wooden-chest',
        description:
          'Solid oak chest with hand-carved detailing, 19th century style.',
        basePrice: 220.0,
        stock: 3,
        categorySlug: 'home-garden',
      },
      {
        name: 'Retro Rotary Phone',
        slug: 'retro-rotary-phone',
        description: 'Fully restored rotary dial telephone, in working order.',
        basePrice: 65.0,
        stock: 6,
        categorySlug: 'collectibles',
      },
    ],
    auction: {
      name: 'Rare Engraved Pocket Watch',
      slug: 'rare-engraved-pocket-watch',
      description: '19th-century engraved pocket watch, working condition.',
      startingPrice: 200,
      minBidIncrement: 10,
      durationHours: 120,
      categorySlug: 'collectibles',
    },
  },
  {
    email: 'trailhead@seed.marketplace.test',
    name: 'Priya Nair',
    businessName: 'Trailhead Outfitters',
    products: [
      {
        name: 'Trail Running Shoes',
        slug: 'trail-running-shoes',
        description:
          'Grippy, lightweight trail running shoes for rough terrain.',
        basePrice: 110.0,
        stock: 30,
        categorySlug: 'sports-outdoors',
      },
      {
        name: '4-Person Camping Tent',
        slug: '4-person-camping-tent',
        description: 'Weatherproof 4-person tent with quick-pitch poles.',
        basePrice: 189.99,
        stock: 10,
        categorySlug: 'sports-outdoors',
      },
      {
        name: 'Insulated Water Bottle',
        slug: 'insulated-water-bottle',
        description:
          'Double-wall stainless steel bottle, keeps drinks cold 24h.',
        basePrice: 24.99,
        stock: 100,
        categorySlug: 'sports-outdoors',
      },
      {
        name: 'Carbon Fiber Trekking Poles',
        slug: 'carbon-fiber-trekking-poles',
        description:
          'Adjustable, ultralight carbon fiber trekking poles (pair).',
        basePrice: 79.0,
        stock: 18,
        categorySlug: 'sports-outdoors',
      },
      {
        name: 'Compact Sleeping Bag',
        slug: 'compact-sleeping-bag',
        description: 'Three-season sleeping bag, packs down to backpack size.',
        basePrice: 95.0,
        stock: 22,
        categorySlug: 'sports-outdoors',
      },
    ],
    auction: {
      name: 'Signed Pro Cycling Jersey',
      slug: 'signed-pro-cycling-jersey',
      description: 'Race-worn jersey signed by a professional cycling team.',
      startingPrice: 60,
      minBidIncrement: 5,
      durationHours: 48,
      categorySlug: 'sports-outdoors',
    },
  },
  {
    email: 'norah@seed.marketplace.test',
    name: 'Norah Whitfield',
    businessName: 'Norah & Co Fashion',
    products: [
      {
        name: 'Merino Wool Sweater',
        slug: 'merino-wool-sweater',
        description: 'Soft, breathable merino wool crewneck sweater.',
        basePrice: 78.0,
        stock: 35,
        categorySlug: 'fashion',
      },
      {
        name: 'Leather Crossbody Bag',
        slug: 'leather-crossbody-bag',
        description: 'Full-grain leather crossbody bag with adjustable strap.',
        basePrice: 145.0,
        stock: 20,
        categorySlug: 'fashion',
      },
      {
        name: 'Classic Denim Jacket',
        slug: 'classic-denim-jacket',
        description: 'Timeless mid-wash denim jacket, unisex fit.',
        basePrice: 89.0,
        stock: 28,
        categorySlug: 'fashion',
      },
      {
        name: 'Silk Scarf',
        slug: 'silk-scarf',
        description: '100% mulberry silk scarf with a hand-rolled hem.',
        basePrice: 39.0,
        stock: 50,
        categorySlug: 'fashion',
      },
      {
        name: 'Minimalist Leather Watch',
        slug: 'minimalist-leather-watch',
        description: 'Slim-profile watch with a genuine leather strap.',
        basePrice: 120.0,
        stock: 16,
        categorySlug: 'fashion',
      },
    ],
    auction: {
      name: 'Designer Runway Sample Dress',
      slug: 'designer-runway-sample-dress',
      description: 'One-off sample dress from a designer runway collection.',
      startingPrice: 150,
      minBidIncrement: 15,
      durationHours: 72,
      categorySlug: 'fashion',
    },
  },
  {
    email: 'chapterone@seed.marketplace.test',
    name: 'Elias Brant',
    businessName: 'Chapter One Books',
    products: [
      {
        name: 'The Midnight Library (Novel)',
        slug: 'the-midnight-library-novel',
        description: 'Paperback edition of the bestselling novel.',
        basePrice: 18.99,
        stock: 45,
        categorySlug: 'books',
      },
      {
        name: 'Atomic Habits',
        slug: 'atomic-habits',
        description:
          'Hardcover edition — an easy and proven way to build good habits.',
        basePrice: 16.5,
        stock: 60,
        categorySlug: 'books',
      },
      {
        name: 'A Brief History of Time',
        slug: 'a-brief-history-of-time',
        description: "Paperback edition of Stephen Hawking's classic.",
        basePrice: 14.0,
        stock: 30,
        categorySlug: 'books',
      },
      {
        name: 'The Art of War (Illustrated Edition)',
        slug: 'the-art-of-war-illustrated',
        description: 'Illustrated hardcover edition of the classic text.',
        basePrice: 22.0,
        stock: 25,
        categorySlug: 'books',
      },
      {
        name: "Cooking with Fire: A Chef's Journal",
        slug: 'cooking-with-fire-chefs-journal',
        description: 'A hardcover collection of live-fire cooking recipes.',
        basePrice: 28.0,
        stock: 15,
        categorySlug: 'books',
      },
    ],
    auction: {
      name: 'Signed First-Edition Novel',
      slug: 'signed-first-edition-novel',
      description: 'Author-signed first-edition hardcover, rare find.',
      startingPrice: 80,
      minBidIncrement: 8,
      durationHours: 96,
      categorySlug: 'books',
    },
  },
  {
    email: 'playful@seed.marketplace.test',
    name: 'Dana Osei',
    businessName: 'Playful Toys Studio',
    products: [
      {
        name: 'Wooden Building Blocks Set',
        slug: 'wooden-building-blocks-set',
        description: '100-piece natural wood building block set for kids.',
        basePrice: 34.99,
        stock: 40,
        categorySlug: 'toys-games',
      },
      {
        name: 'Strategy Board Game: Settlers',
        slug: 'strategy-board-game-settlers',
        description: 'Award-winning resource-trading strategy board game.',
        basePrice: 45.0,
        stock: 25,
        categorySlug: 'toys-games',
      },
      {
        name: 'Remote Control Drone',
        slug: 'remote-control-drone',
        description: 'Beginner-friendly RC drone with a built-in HD camera.',
        basePrice: 89.99,
        stock: 18,
        categorySlug: 'toys-games',
      },
      {
        name: 'Plush Dinosaur (Large)',
        slug: 'plush-dinosaur-large',
        description: 'Oversized, super-soft plush dinosaur toy.',
        basePrice: 24.99,
        stock: 55,
        categorySlug: 'toys-games',
      },
      {
        name: '1000-Piece Jigsaw Puzzle',
        slug: '1000-piece-jigsaw-puzzle',
        description: 'A scenic 1000-piece jigsaw puzzle for all ages.',
        basePrice: 19.99,
        stock: 35,
        categorySlug: 'toys-games',
      },
    ],
    auction: {
      name: 'Rare Vintage Board Game (First Print)',
      slug: 'rare-vintage-board-game-first-print',
      description:
        'First-print run of a now out-of-production classic board game.',
      startingPrice: 40,
      minBidIncrement: 5,
      durationHours: 60,
      categorySlug: 'toys-games',
    },
  },
];

// ===================== Upsert helpers =====================

async function upsertCategory(seed: {
  name: string;
  slug: string;
}): Promise<Category> {
  return prisma.category.upsert({
    where: { slug: seed.slug },
    update: {},
    create: seed,
  });
}

// User role is set directly to SELLER and the profile to APPROVED — this
// is a seed script standing in for the real apply/admin-review flow
// (already covered by sellers.service.spec.ts), not re-testing it.
async function upsertSeller(
  seed: SellerSeed,
): Promise<{ user: User; sellerProfile: SellerProfile }> {
  let user = await prisma.user.findUnique({ where: { email: seed.email } });
  if (!user) {
    const passwordHash = await bcrypt.hash(SEED_PASSWORD, BCRYPT_ROUNDS);
    user = await prisma.user.create({
      data: {
        email: seed.email,
        passwordHash,
        name: seed.name,
        role: UserRole.SELLER,
      },
    });
  }

  const sellerProfile = await prisma.sellerProfile.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      businessName: seed.businessName,
      status: SellerProfileStatus.APPROVED,
    },
  });

  return { user, sellerProfile };
}

async function upsertFixedPriceProduct(
  seed: ProductSeed,
  sellerId: string,
  categoryId: string,
): Promise<Product> {
  const product = await prisma.product.upsert({
    where: { slug: seed.slug },
    update: {},
    create: {
      sellerId,
      categoryId,
      name: seed.name,
      slug: seed.slug,
      description: seed.description,
      basePrice: seed.basePrice,
      type: ProductType.FIXED_PRICE,
      status: ProductStatus.ACTIVE,
    },
  });

  // Left as a no-op update on an existing row so a manual test session
  // that already decremented stock via a real checkout isn't reset.
  await prisma.inventory.upsert({
    where: { productId: product.id },
    update: {},
    create: { productId: product.id, quantityAvailable: seed.stock },
  });

  return product;
}

// Bypasses BiddingService.createAuction entirely — no BullMQ jobs get
// scheduled for this auction's start/end. That's fine for "starts now"
// (already ACTIVE) and doesn't need a manual end either:
// AuctionDeadlineSweeperService polls every 30s as the reliability
// backstop for exactly this kind of missed-job case (see
// bidding.service.ts's comment on it), so a seeded auction still ends
// itself on schedule once the real app is running.
async function upsertAuction(
  seed: AuctionSeed,
  sellerId: string,
  categoryId: string,
): Promise<Product> {
  const product = await prisma.product.upsert({
    where: { slug: seed.slug },
    update: {},
    create: {
      sellerId,
      categoryId,
      name: seed.name,
      slug: seed.slug,
      description: seed.description,
      basePrice: seed.startingPrice,
      type: ProductType.AUCTION,
      status: ProductStatus.ACTIVE,
    },
  });

  // Every product needs an Inventory row — decrementStock/restoreStock/
  // setStock and the checkout path all assume one exists. The real
  // BiddingService.createAuction flow gets this for free from
  // createWithInventory; this shortcut has to create it itself. Sized to
  // 1 to cover the single lot this auction awards (Auction.quantity's
  // default — see below), and left as a no-op update like
  // upsertFixedPriceProduct so a manual test session isn't reset.
  await prisma.inventory.upsert({
    where: { productId: product.id },
    update: {},
    create: { productId: product.id, quantityAvailable: 1 },
  });

  // Auction has no unique key to upsert against, so idempotency here
  // means "skip if this product already has a live one" instead.
  const existing = await prisma.auction.findFirst({
    where: {
      productId: product.id,
      status: { in: [AuctionStatus.SCHEDULED, AuctionStatus.ACTIVE] },
    },
  });
  if (!existing) {
    const startsAt = new Date();
    const endsAt = new Date(
      startsAt.getTime() + seed.durationHours * 60 * 60 * 1000,
    );
    await prisma.auction.create({
      data: {
        productId: product.id,
        sellerId,
        startingPrice: seed.startingPrice,
        minBidIncrement: seed.minBidIncrement,
        status: AuctionStatus.ACTIVE,
        startsAt,
        endsAt,
      },
    });
  }

  return product;
}

// ===================== Run =====================

// The admin dashboard is otherwise unreachable in a fresh environment —
// there is no self-serve path to ADMIN (by design: admin promotion isn't
// an in-app flow), so without this seeded row nobody could ever sign in
// to review seller applications, moderate products, or resolve disputes.
const ADMIN_EMAIL = 'admin@seed.marketplace.test';

async function upsertAdmin(): Promise<User> {
  const existing = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
  });
  if (existing) {
    return existing.role === UserRole.ADMIN
      ? existing
      : prisma.user.update({
          where: { id: existing.id },
          data: { role: UserRole.ADMIN },
        });
  }
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, BCRYPT_ROUNDS);
  return prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      passwordHash,
      name: 'Sam Okafor',
      role: UserRole.ADMIN,
    },
  });
}

// A second applicant, deliberately left PENDING (not auto-approved like
// the SELLERS above) — gives the seeded admin something real to review
// in the Seller Applications tab instead of an empty list.
const PENDING_APPLICANT = {
  email: 'newseller@seed.marketplace.test',
  name: 'Jordan Kim',
  businessName: 'Kim Handmade Goods',
};

async function upsertPendingApplicant(): Promise<void> {
  let user = await prisma.user.findUnique({
    where: { email: PENDING_APPLICANT.email },
  });
  if (!user) {
    const passwordHash = await bcrypt.hash(SEED_PASSWORD, BCRYPT_ROUNDS);
    user = await prisma.user.create({
      data: {
        email: PENDING_APPLICANT.email,
        passwordHash,
        name: PENDING_APPLICANT.name,
        role: UserRole.CUSTOMER,
      },
    });
  }
  await prisma.sellerProfile.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      businessName: PENDING_APPLICANT.businessName,
      status: SellerProfileStatus.PENDING,
    },
  });
}

async function main() {
  console.log('Seeding admin account...');
  await upsertAdmin();

  console.log('Seeding a pending seller application...');
  await upsertPendingApplicant();

  console.log('Seeding categories...');
  const categoriesBySlug = new Map<string, Category>();
  for (const seed of CATEGORIES) {
    categoriesBySlug.set(seed.slug, await upsertCategory(seed));
  }

  const productIdsToSync: string[] = [];

  for (const sellerSeed of SELLERS) {
    console.log(`Seeding ${sellerSeed.businessName}...`);
    const { sellerProfile } = await upsertSeller(sellerSeed);

    for (const productSeed of sellerSeed.products) {
      const category = categoriesBySlug.get(productSeed.categorySlug);
      if (!category)
        throw new Error(`Unknown category slug: ${productSeed.categorySlug}`);
      const product = await upsertFixedPriceProduct(
        productSeed,
        sellerProfile.id,
        category.id,
      );
      productIdsToSync.push(product.id);
    }

    const auctionCategory = categoriesBySlug.get(
      sellerSeed.auction.categorySlug,
    );
    if (!auctionCategory) {
      throw new Error(
        `Unknown category slug: ${sellerSeed.auction.categorySlug}`,
      );
    }
    const auctionProduct = await upsertAuction(
      sellerSeed.auction,
      sellerProfile.id,
      auctionCategory.id,
    );
    productIdsToSync.push(auctionProduct.id);
  }

  console.log(
    `\nSyncing ${productIdsToSync.length} products to Meilisearch...`,
  );
  let synced = 0;
  for (const productId of productIdsToSync) {
    try {
      await syncProductToSearch(productId);
      synced += 1;
    } catch (err) {
      console.warn(
        `Could not sync product ${productId} to Meilisearch: ${(err as Error).message}`,
      );
    }
  }
  console.log(`Synced ${synced}/${productIdsToSync.length} products.`);

  const totalProducts = SELLERS.reduce(
    (sum, s) => sum + s.products.length + 1,
    0,
  );
  console.log(
    `\nDone. ${CATEGORIES.length} categories, ${SELLERS.length} sellers, ` +
      `${totalProducts} products (${SELLERS.length} of them auctions).`,
  );
  console.log(`\nSeeded accounts (password for all: ${SEED_PASSWORD}):`);
  console.log(`  ${ADMIN_EMAIL}  (admin)`);
  for (const seed of SELLERS) {
    console.log(`  ${seed.email}  (${seed.businessName})`);
  }
  console.log(
    `  ${PENDING_APPLICANT.email}  (customer, PENDING seller application — review it as admin)`,
  );
  console.log(
    "\nAny seller can bid on another seller's auction to test bidding " +
      'end-to-end — placing a bid has no role restriction beyond being ' +
      'signed in.',
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
