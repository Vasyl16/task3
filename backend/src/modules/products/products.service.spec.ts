import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ProductStatus,
  ProductType,
  SellerProfileStatus,
  UserRole,
  type Inventory,
  type Product,
  type SellerProfile,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { CorrelationIdService } from '../../core/correlation-id/correlation-id.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CategoriesService } from '../categories/categories.service';
import { SellersService } from '../sellers/sellers.service';
import { ProductsRepository } from './domain/products.repository';
import { INVENTORY_UPDATED_EVENT } from './domain/events/inventory-updated.event';
import { PRODUCT_UPDATED_EVENT } from './domain/events/product-updated.event';
import { ProductsService } from './products.service';
import { ReviewsService } from '../reviews/reviews.service';
import { ProductModerationAction } from './dto/moderate-product.dto';

const NOW = new Date();

function buildSellerProfile(
  overrides: Partial<SellerProfile> = {},
): SellerProfile {
  return {
    id: 'seller-profile-1',
    userId: 'user-1',
    businessName: 'Shop',
    description: null,
    status: SellerProfileStatus.APPROVED,
    reviewedByUserId: null,
    reviewedAt: NOW,
    appliedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    sellerId: 'seller-profile-1',
    categoryId: 'category-1',
    name: 'Widget',
    slug: 'widget',
    description: null,
    imageUrl: null,
    basePrice: '9.99' as unknown as Product['basePrice'],
    type: ProductType.FIXED_PRICE,
    status: ProductStatus.ACTIVE,
    createdAt: NOW,
    updatedAt: NOW,
    moderatedByUserId: null,
    moderatedAt: null,
    moderationNote: null,
    ...overrides,
  };
}

function buildInventory(overrides: Partial<Inventory> = {}): Inventory {
  return {
    id: 'inventory-1',
    productId: 'product-1',
    quantityAvailable: 5,
    quantityReserved: 0,
    version: 1,
    updatedAt: NOW,
    ...overrides,
  };
}

function buildCaller(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    email: 'seller@example.com',
    role: UserRole.SELLER,
    ...overrides,
  };
}

describe('ProductsService', () => {
  let productsService: ProductsService;
  let productsRepository: jest.Mocked<ProductsRepository>;
  let sellersService: jest.Mocked<
    Pick<SellersService, 'getOwnApprovedSellerProfileOrThrow' | 'findById'>
  >;
  let categoriesService: jest.Mocked<Pick<CategoriesService, 'findById'>>;
  let outboxService: jest.Mocked<Pick<OutboxService, 'record'>>;
  let correlationIdService: jest.Mocked<Pick<CorrelationIdService, 'getId'>>;
  // The fake transaction client passed to callbacks below — asserting
  // against this same object below is how the tests confirm the
  // repository write and the outbox event were recorded through the
  // SAME transaction handle, not two independent calls.
  const fakeTx = { marker: 'tx' };

  beforeEach(async () => {
    productsRepository = {
      findAll: jest.fn(),
      findById: jest.fn(),
      createWithInventory: jest.fn(),
      update: jest.fn(),
      archive: jest.fn(),
      restore: jest.fn(),
      findManyWithInventory: jest.fn(),
      reserveStock: jest.fn(),
      commitReservation: jest.fn(),
      releaseReservation: jest.fn(),
      setStock: jest.fn(),
      findForModeration: jest.fn(),
      setModerationStatus: jest.fn(),
    };
    sellersService = {
      getOwnApprovedSellerProfileOrThrow: jest.fn(),
      findById: jest.fn(),
    };
    categoriesService = {
      findById: jest.fn(),
    };
    outboxService = { record: jest.fn() };
    correlationIdService = { getId: jest.fn().mockReturnValue('corr-1') };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: ProductsRepository, useValue: productsRepository },
        { provide: SellersService, useValue: sellersService },
        { provide: CategoriesService, useValue: categoriesService },
        { provide: OutboxService, useValue: outboxService },
        { provide: CorrelationIdService, useValue: correlationIdService },
        {
          // The catalogue projections enrich each product with its
          // rating; these tests are about ownership and outbox writes,
          // so an unreviewed catalogue is the right stand-in.
          provide: ReviewsService,
          useValue: {
            getRatingsFor: jest.fn().mockResolvedValue(new Map()),
            getRatingFor: jest
              .fn()
              .mockImplementation((productId: string) =>
                Promise.resolve({ productId, average: 0, count: 0 }),
              ),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            // Mirrors real $transaction semantics closely enough for a
            // unit test: the callback runs with a single shared tx
            // handle, and if the callback's promise rejects, so does
            // $transaction — nothing it did gets treated as committed.
            $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(fakeTx)),
          },
        },
      ],
    }).compile();

    productsService = moduleRef.get(ProductsService);
  });

  describe('create', () => {
    it('derives sellerId from the caller’s own approved SellerProfile, never from the request', async () => {
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'my-real-profile' }),
      );
      categoriesService.findById.mockResolvedValue({
        id: 'category-1',
      } as never);
      productsRepository.createWithInventory.mockResolvedValue(
        buildProduct({ sellerId: 'my-real-profile' }),
      );

      await productsService.create('user-1', {
        categoryId: 'category-1',
        name: 'Widget',
        slug: 'widget',
        basePrice: 9.99,
        initialQuantity: 5,
      });

      expect(
        sellersService.getOwnApprovedSellerProfileOrThrow,
      ).toHaveBeenCalledWith('user-1');
      const [, createArg] =
        productsRepository.createWithInventory.mock.calls[0];
      expect(createArg.sellerId).toBe('my-real-profile');
      expect(createArg.type).toBe(ProductType.FIXED_PRICE);
    });

    it('IDOR: a caller with no approved seller profile cannot create a product', async () => {
      sellersService.getOwnApprovedSellerProfileOrThrow.mockRejectedValue(
        new ForbiddenException('No approved seller profile for this account'),
      );

      await expect(
        productsService.create('customer-1', {
          categoryId: 'category-1',
          name: 'Widget',
          slug: 'widget',
          basePrice: 9.99,
          initialQuantity: 5,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(productsRepository.createWithInventory).not.toHaveBeenCalled();
    });

    // "successful state + outbox creation" — the reference case for the
    // whole transactional-outbox pattern: Product row + OutboxEvent row
    // both recorded through the same transaction handle.
    it('records a ProductCreated outbox event in the same transaction as the product write, carrying the request correlationId', async () => {
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'my-profile' }),
      );
      categoriesService.findById.mockResolvedValue({
        id: 'category-1',
      } as never);
      productsRepository.createWithInventory.mockResolvedValue(
        buildProduct({ id: 'new-product', sellerId: 'my-profile' }),
      );

      await productsService.create('user-1', {
        categoryId: 'category-1',
        name: 'Widget',
        slug: 'widget',
        basePrice: 9.99,
        initialQuantity: 5,
      });

      expect(outboxService.record).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({
          eventType: 'ProductCreated',
          aggregateType: 'Product',
          aggregateId: 'new-product',
          correlationId: 'corr-1',
        }),
      );
    });

    // DB transaction rollback: if the outbox write fails, the operation
    // must fail as a whole — never a product that silently has no event
    // (that would defeat the entire point of the outbox pattern). A real
    // Postgres transaction guarantees this at the database level; this
    // test asserts the service surfaces it as a single failure rather
    // than swallowing the outbox error.
    it('fails the whole operation if recording the outbox event fails, rather than leaving an event-less product', async () => {
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'my-profile' }),
      );
      categoriesService.findById.mockResolvedValue({
        id: 'category-1',
      } as never);
      productsRepository.createWithInventory.mockResolvedValue(
        buildProduct({ sellerId: 'my-profile' }),
      );
      outboxService.record.mockRejectedValue(new Error('outbox insert failed'));

      await expect(
        productsService.create('user-1', {
          categoryId: 'category-1',
          name: 'Widget',
          slug: 'widget',
          basePrice: 9.99,
          initialQuantity: 5,
        }),
      ).rejects.toThrow('outbox insert failed');
    });

    it('falls back to a generated correlationId when none is on the request context', async () => {
      correlationIdService.getId.mockReturnValue(undefined);
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'my-profile' }),
      );
      categoriesService.findById.mockResolvedValue({
        id: 'category-1',
      } as never);
      productsRepository.createWithInventory.mockResolvedValue(
        buildProduct({ sellerId: 'my-profile' }),
      );

      await productsService.create('user-1', {
        categoryId: 'category-1',
        name: 'Widget',
        slug: 'widget',
        basePrice: 9.99,
        initialQuantity: 5,
      });

      const [, eventArg] = outboxService.record.mock.calls[0];
      expect(typeof eventArg.correlationId).toBe('string');
      expect(eventArg.correlationId.length).toBeGreaterThan(0);
    });
  });

  describe('update', () => {
    it('allows the owning seller', async () => {
      productsRepository.findById.mockResolvedValue(
        buildProduct({ sellerId: 'my-profile' }),
      );
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'my-profile' }),
      );
      productsRepository.update.mockResolvedValue(buildProduct());

      await productsService.update('product-1', buildCaller(), {
        name: 'New name',
      });

      const [, idArg, dataArg] = productsRepository.update.mock.calls[0];
      expect(idArg).toBe('product-1');
      expect(dataArg).toEqual({ name: 'New name' });
    });

    it('records a ProductUpdated outbox event in the same transaction', async () => {
      productsRepository.findById.mockResolvedValue(
        buildProduct({ sellerId: 'my-profile' }),
      );
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'my-profile' }),
      );
      productsRepository.update.mockResolvedValue(buildProduct());

      await productsService.update('product-1', buildCaller(), {
        name: 'New name',
      });

      expect(outboxService.record).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({
          eventType: 'ProductUpdated',
          aggregateType: 'Product',
          correlationId: 'corr-1',
        }),
      );
    });

    it('IDOR: rejects a seller who does not own this product', async () => {
      productsRepository.findById.mockResolvedValue(
        buildProduct({ sellerId: 'someone-elses-profile' }),
      );
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'my-profile' }),
      );

      await expect(
        productsService.update('product-1', buildCaller({ id: 'attacker' }), {
          name: 'Hijacked',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(productsRepository.update).not.toHaveBeenCalled();
    });

    it('ADMIN bypasses ownership entirely', async () => {
      productsRepository.findById.mockResolvedValue(
        buildProduct({ sellerId: 'someone-elses-profile' }),
      );
      productsRepository.update.mockResolvedValue(buildProduct());

      await productsService.update(
        'product-1',
        buildCaller({ id: 'admin-1', role: UserRole.ADMIN }),
        { name: 'Moderated' },
      );

      expect(
        sellersService.getOwnApprovedSellerProfileOrThrow,
      ).not.toHaveBeenCalled();
      expect(productsRepository.update).toHaveBeenCalled();
    });

    it('does not touch inventory when quantityAvailable is omitted', async () => {
      productsRepository.findById.mockResolvedValue(
        buildProduct({ sellerId: 'my-profile' }),
      );
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'my-profile' }),
      );
      productsRepository.update.mockResolvedValue(buildProduct());

      await productsService.update('product-1', buildCaller(), {
        name: 'New name',
      });

      expect(productsRepository.setStock).not.toHaveBeenCalled();
    });

    it('sets stock and records a SELLER_ADJUSTMENT InventoryUpdated event, in the same transaction as the product write', async () => {
      productsRepository.findById.mockResolvedValue(
        buildProduct({ sellerId: 'my-profile' }),
      );
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'my-profile' }),
      );
      productsRepository.update.mockResolvedValue(buildProduct());
      productsRepository.setStock.mockResolvedValue(
        buildInventory({ quantityAvailable: 25, version: 2 }),
      );

      await productsService.update('product-1', buildCaller(), {
        quantityAvailable: 25,
      });

      const [txArg, productIdArg, quantityArg] =
        productsRepository.setStock.mock.calls[0];
      expect(txArg).toBe(fakeTx);
      expect(productIdArg).toBe('product-1');
      expect(quantityArg).toBe(25);

      // quantityAvailable must not leak into the plain product-fields
      // update — it's a separate write against Inventory, not Product.
      const [, , productDataArg] = productsRepository.update.mock.calls[0];
      expect(productDataArg).not.toHaveProperty('quantityAvailable');

      expect(outboxService.record).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({
          eventType: INVENTORY_UPDATED_EVENT,
          aggregateType: 'Inventory',
          payload: expect.objectContaining({
            quantityAvailable: 25,
            reason: 'SELLER_ADJUSTMENT',
          }),
        }),
      );
    });

    // Optimistic-locking guard: ProductsRepository.setStock returns null
    // when Inventory.version moved between its read and its conditional
    // write (a concurrent checkout/restore committed in between) — the
    // service must surface that as a conflict, never silently drop the
    // seller's edit or clobber the concurrent change.
    it('rejects the whole update if stock changed concurrently, rather than silently losing the edit', async () => {
      productsRepository.findById.mockResolvedValue(
        buildProduct({ sellerId: 'my-profile' }),
      );
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'my-profile' }),
      );
      productsRepository.update.mockResolvedValue(buildProduct());
      productsRepository.setStock.mockResolvedValue(null);

      await expect(
        productsService.update('product-1', buildCaller(), {
          quantityAvailable: 25,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('archive (deactivation)', () => {
    it('soft-deletes by setting status ARCHIVED, never a physical delete', async () => {
      productsRepository.findById.mockResolvedValue(
        buildProduct({ sellerId: 'my-profile' }),
      );
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'my-profile' }),
      );
      productsRepository.archive.mockResolvedValue(
        buildProduct({ status: ProductStatus.ARCHIVED }),
      );

      const result = await productsService.archive('product-1', buildCaller());

      const [, idArg] = productsRepository.archive.mock.calls[0];
      expect(idArg).toBe('product-1');
      expect(result.status).toBe(ProductStatus.ARCHIVED);
    });

    it('records a ProductArchived outbox event, so search-sync removes it from the index', async () => {
      productsRepository.findById.mockResolvedValue(
        buildProduct({ sellerId: 'my-profile' }),
      );
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'my-profile' }),
      );
      productsRepository.archive.mockResolvedValue(
        buildProduct({ status: ProductStatus.ARCHIVED }),
      );

      await productsService.archive('product-1', buildCaller());

      expect(outboxService.record).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({
          eventType: 'ProductArchived',
          aggregateType: 'Product',
        }),
      );
    });

    it('IDOR: rejects a seller who does not own this product', async () => {
      productsRepository.findById.mockResolvedValue(
        buildProduct({ sellerId: 'someone-elses-profile' }),
      );
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'my-profile' }),
      );

      await expect(
        productsService.archive('product-1', buildCaller({ id: 'attacker' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(productsRepository.archive).not.toHaveBeenCalled();
    });
  });

  describe('restore (seller un-archives their own listing)', () => {
    it('puts an archived product back on sale and re-indexes it', async () => {
      productsRepository.findById.mockResolvedValue(
        buildProduct({ status: ProductStatus.ARCHIVED }),
      );
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'seller-profile-1' }),
      );
      productsRepository.restore.mockResolvedValue(
        buildProduct({ status: ProductStatus.ACTIVE }),
      );

      const restored = await productsService.restore(
        'product-1',
        buildCaller({ id: 'seller-user' }),
      );

      expect(restored.status).toBe(ProductStatus.ACTIVE);
      // Search-sync DELETED the document when it was archived, so the
      // restore has to announce itself or the product stays unfindable.
      expect(outboxService.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ eventType: PRODUCT_UPDATED_EVENT }),
      );
    });

    it('rejects restoring a product that is not archived', async () => {
      productsRepository.findById.mockResolvedValue(
        buildProduct({ status: ProductStatus.ACTIVE }),
      );
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'seller-profile-1' }),
      );

      await expect(
        productsService.restore(
          'product-1',
          buildCaller({ id: 'seller-user' }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    // A takedown a seller could undo from their own dashboard would not
    // be a takedown at all.
    it('refuses to let a seller undo an ADMIN takedown', async () => {
      productsRepository.findById.mockResolvedValue(
        buildProduct({
          status: ProductStatus.ARCHIVED,
          moderatedAt: new Date(),
          moderatedByUserId: 'admin-1',
        }),
      );
      sellersService.getOwnApprovedSellerProfileOrThrow.mockResolvedValue(
        buildSellerProfile({ id: 'seller-profile-1' }),
      );

      await expect(
        productsService.restore(
          'product-1',
          buildCaller({ id: 'seller-user' }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(productsRepository.restore).not.toHaveBeenCalled();
    });

    it('but an ADMIN may reinstate their own takedown', async () => {
      productsRepository.findById.mockResolvedValue(
        buildProduct({
          status: ProductStatus.ARCHIVED,
          moderatedAt: new Date(),
        }),
      );
      productsRepository.restore.mockResolvedValue(
        buildProduct({ status: ProductStatus.ACTIVE }),
      );

      await expect(
        productsService.restore(
          'product-1',
          buildCaller({ id: 'admin-1', role: UserRole.ADMIN }),
        ),
      ).resolves.toMatchObject({ status: ProductStatus.ACTIVE });
    });
  });

  describe('moderation', () => {
    const admin = buildCaller({ id: 'admin-1', role: UserRole.ADMIN });

    it('takes a listing down, recording who did it and why', async () => {
      productsRepository.findById.mockResolvedValue(buildProduct());
      productsRepository.setModerationStatus.mockResolvedValue(
        buildProduct({ status: ProductStatus.ARCHIVED }),
      );

      await productsService.moderate('product-1', admin, {
        action: ProductModerationAction.TAKE_DOWN,
        note: 'Counterfeit branding reported by three buyers',
      });

      expect(productsRepository.setModerationStatus).toHaveBeenCalledWith(
        fakeTx,
        'product-1',
        {
          status: ProductStatus.ARCHIVED,
          moderatedByUserId: 'admin-1',
          moderationNote: 'Counterfeit branding reported by three buyers',
        },
      );
    });

    // The search index has to follow a takedown, or the product stays
    // discoverable through search after being removed from the catalog.
    // ProductArchived is the event the search consumer DELETES on.
    it('records ProductArchived in the same transaction as the takedown', async () => {
      productsRepository.findById.mockResolvedValue(buildProduct());
      productsRepository.setModerationStatus.mockResolvedValue(
        buildProduct({ status: ProductStatus.ARCHIVED }),
      );

      await productsService.moderate('product-1', admin, {
        action: ProductModerationAction.TAKE_DOWN,
        note: 'Prohibited item',
      });

      expect(outboxService.record).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({
          eventType: 'ProductArchived',
          aggregateId: 'product-1',
        }),
      );
    });

    it('reinstates a taken-down listing and re-indexes it', async () => {
      productsRepository.findById.mockResolvedValue(
        buildProduct({ status: ProductStatus.ARCHIVED }),
      );
      productsRepository.setModerationStatus.mockResolvedValue(
        buildProduct({ status: ProductStatus.ACTIVE }),
      );

      await productsService.moderate('product-1', admin, {
        action: ProductModerationAction.REINSTATE,
        note: 'Report was unfounded on review',
      });

      const [, , data] = productsRepository.setModerationStatus.mock.calls[0];
      expect(data.status).toBe(ProductStatus.ACTIVE);
      expect(outboxService.record).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({ eventType: 'ProductUpdated' }),
      );
    });

    // Without this, re-running a takedown would overwrite the original
    // moderator and timestamp with a second identical one, and emit a
    // pointless index delete.
    it('rejects a takedown of an already-archived product', async () => {
      productsRepository.findById.mockResolvedValue(
        buildProduct({ status: ProductStatus.ARCHIVED }),
      );

      await expect(
        productsService.moderate('product-1', admin, {
          action: ProductModerationAction.TAKE_DOWN,
          note: 'Again',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(productsRepository.setModerationStatus).not.toHaveBeenCalled();
    });

    it('lists archived products too, so a moderator can find what to reinstate', async () => {
      productsRepository.findForModeration.mockResolvedValue([]);

      await productsService.listForModeration({
        status: ProductStatus.ARCHIVED,
      });

      expect(productsRepository.findForModeration).toHaveBeenCalledWith({
        status: ProductStatus.ARCHIVED,
      });
    });
  });

  // GET /products and GET /products/:id are @Public(). They were
  // returning the raw Product row, which carries the moderation audit
  // trail — an admin's user id and their free-text reason for taking a
  // listing down — to anonymous callers.
  describe('public catalog projection', () => {
    const MODERATED = {
      moderatedByUserId: 'admin-1',
      moderatedAt: NOW,
      moderationNote: 'Counterfeit — reported by three buyers',
    };

    it('strips the moderation audit trail from a single product', async () => {
      productsRepository.findById.mockResolvedValue(
        buildProduct({ ...MODERATED }),
      );

      const product = await productsService.findByIdForCatalog('product-1');

      expect(product).not.toHaveProperty('moderatedByUserId');
      expect(product).not.toHaveProperty('moderatedAt');
      expect(product).not.toHaveProperty('moderationNote');
      expect(JSON.stringify(product)).not.toContain('Counterfeit');
    });

    it('keeps every field a shopper actually needs', async () => {
      productsRepository.findById.mockResolvedValue(buildProduct());

      const product = await productsService.findByIdForCatalog('product-1');

      expect(product).toMatchObject({
        id: 'product-1',
        sellerId: 'seller-profile-1',
        name: 'Widget',
        slug: 'widget',
        basePrice: '9.99',
        status: ProductStatus.ACTIVE,
        type: ProductType.FIXED_PRICE,
      });
    });

    it('strips the audit trail from every item in a list, not just the first', async () => {
      productsRepository.findAll.mockResolvedValue([
        buildProduct({ id: 'p1' }),
        buildProduct({ id: 'p2', ...MODERATED }),
      ]);

      const products = await productsService.findAllForCatalog();

      expect(products).toHaveLength(2);
      for (const product of products) {
        expect(product).not.toHaveProperty('moderationNote');
      }
    });

    // The internal lookups feed cart/bidding/orders and the
    // ownership-checked write paths, which legitimately need the full
    // row — only the @Public() routes get the projection.
    it('leaves the internal findById untouched', async () => {
      productsRepository.findById.mockResolvedValue(
        buildProduct({ ...MODERATED }),
      );

      await expect(
        productsService.findById('product-1'),
      ).resolves.toHaveProperty(
        'moderationNote',
        'Counterfeit — reported by three buyers',
      );
    });
  });

  describe('checkout support', () => {
    it('decrementStockForCheckout succeeds silently when stock is sufficient', async () => {
      productsRepository.reserveStock.mockResolvedValue(buildInventory());

      await expect(
        productsService.reserveStockForCheckout(
          fakeTx as never,
          'product-1',
          2,
        ),
      ).resolves.toBeUndefined();
      expect(productsRepository.reserveStock).toHaveBeenCalledWith(
        fakeTx,
        'product-1',
        2,
      );
    });

    it('reserveStockForCheckout throws ConflictException when stock is insufficient', async () => {
      productsRepository.reserveStock.mockResolvedValue(null);

      await expect(
        productsService.reserveStockForCheckout(
          fakeTx as never,
          'product-1',
          2,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('releaseReservationForCancellation frees the hold rather than restocking', async () => {
      productsRepository.releaseReservation.mockResolvedValue(buildInventory());

      await productsService.releaseReservationForCancellation(
        fakeTx as never,
        'product-1',
        3,
      );

      expect(productsRepository.releaseReservation).toHaveBeenCalledWith(
        fakeTx,
        'product-1',
        3,
      );
    });

    // Shipping is the only thing that reduces quantityAvailable now.
    it('commitReservationForShipment converts the hold and reports that it applied', async () => {
      productsRepository.commitReservation.mockResolvedValue(buildInventory());

      await expect(
        productsService.commitReservationForShipment(
          fakeTx as never,
          'product-1',
          2,
        ),
      ).resolves.toBe(true);
    });

    // A re-run ship transition must not decrement a second time.
    it('commitReservationForShipment is a no-op when the reservation is already gone', async () => {
      productsRepository.commitReservation.mockResolvedValue(null);

      await expect(
        productsService.commitReservationForShipment(
          fakeTx as never,
          'product-1',
          2,
        ),
      ).resolves.toBe(false);
      expect(outboxService.record).not.toHaveBeenCalled();
    });
  });

  // A hold keeps units in stock but out of the cart's reach. Consumers
  // (search's inStock, BiddingService's lot check) treat sellable as
  // quantityAvailable - quantityReserved, so a hold must move exactly
  // one of the two counters — moving both would charge a unit twice.
  describe('auction stock holds', () => {
    it('reserveStockForAuction succeeds when enough units are free', async () => {
      productsRepository.reserveStock.mockResolvedValue(buildInventory());

      await expect(
        productsService.reserveStockForAuction(fakeTx as never, 'product-1', 2),
      ).resolves.toBeUndefined();
      expect(productsRepository.reserveStock).toHaveBeenCalledWith(
        fakeTx,
        'product-1',
        2,
      );
    });

    it('reserveStockForAuction throws ConflictException when the units are not free', async () => {
      productsRepository.reserveStock.mockResolvedValue(null);

      await expect(
        productsService.reserveStockForAuction(fakeTx as never, 'product-1', 2),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('announces a hold as AUCTION_HOLD, carrying the post-hold quantities', async () => {
      productsRepository.reserveStock.mockResolvedValue(
        buildInventory({ quantityAvailable: 5, quantityReserved: 2 }),
      );

      await productsService.reserveStockForAuction(
        fakeTx as never,
        'product-1',
        2,
      );

      expect(outboxService.record).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({
          eventType: 'InventoryUpdated',
          payload: expect.objectContaining({
            quantityAvailable: 5,
            quantityReserved: 2,
            reason: 'AUCTION_HOLD',
          }),
        }),
      );
    });

    it('announces a release as AUCTION_RELEASE', async () => {
      productsRepository.releaseReservation.mockResolvedValue(
        buildInventory({ quantityAvailable: 5, quantityReserved: 0 }),
      );

      await productsService.releaseAuctionReservation(
        fakeTx as never,
        'product-1',
        2,
      );

      expect(productsRepository.releaseReservation).toHaveBeenCalledWith(
        fakeTx,
        'product-1',
        2,
      );
      expect(outboxService.record).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({
          eventType: 'InventoryUpdated',
          payload: expect.objectContaining({ reason: 'AUCTION_RELEASE' }),
        }),
      );
    });
  });

  // The realtime layer's inventory broadcast is only as trustworthy as
  // this event: it must be recorded on the CALLER'S transaction handle
  // (so a rolled-back checkout announces nothing) and must carry the
  // post-change quantities, not the pre-change ones.
  describe('InventoryUpdated event', () => {
    it('records the post-reservation quantities on the caller’s transaction, tagged CHECKOUT', async () => {
      productsRepository.reserveStock.mockResolvedValue(
        buildInventory({
          quantityAvailable: 3,
          quantityReserved: 2,
          version: 7,
        }),
      );

      await productsService.reserveStockForCheckout(
        fakeTx as never,
        'product-1',
        2,
      );

      expect(outboxService.record).toHaveBeenCalledWith(fakeTx, {
        aggregateType: 'Inventory',
        aggregateId: 'product-1',
        eventType: INVENTORY_UPDATED_EVENT,
        payload: {
          productId: 'product-1',
          quantityAvailable: 3,
          quantityReserved: 2,
          version: 7,
          reason: 'CHECKOUT',
        },
        correlationId: 'corr-1',
      });
    });

    it('records nothing when the reservation failed — a sold-out attempt changed no stock', async () => {
      productsRepository.reserveStock.mockResolvedValue(null);

      await expect(
        productsService.reserveStockForCheckout(
          fakeTx as never,
          'product-1',
          2,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(outboxService.record).not.toHaveBeenCalled();
    });

    it('tags a cancellation release as CANCELLATION so subscribers can tell the two apart', async () => {
      productsRepository.releaseReservation.mockResolvedValue(
        buildInventory({ quantityAvailable: 10, quantityReserved: 0 }),
      );

      await productsService.releaseReservationForCancellation(
        fakeTx as never,
        'product-1',
        3,
      );

      const [, event] = outboxService.record.mock.calls[0];
      expect(event.eventType).toBe(INVENTORY_UPDATED_EVENT);
      expect(event.payload).toMatchObject({
        quantityAvailable: 10,
        reason: 'CANCELLATION',
      });
    });
  });
});
