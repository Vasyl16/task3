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
import { ProductsService } from './products.service';
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
      findManyWithInventory: jest.fn(),
      decrementStock: jest.fn(),
      restoreStock: jest.fn(),
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

  describe('checkout support', () => {
    it('decrementStockForCheckout succeeds silently when stock is sufficient', async () => {
      productsRepository.decrementStock.mockResolvedValue(buildInventory());

      await expect(
        productsService.decrementStockForCheckout(
          fakeTx as never,
          'product-1',
          2,
        ),
      ).resolves.toBeUndefined();
      expect(productsRepository.decrementStock).toHaveBeenCalledWith(
        fakeTx,
        'product-1',
        2,
      );
    });

    it('decrementStockForCheckout throws ConflictException when stock is insufficient', async () => {
      productsRepository.decrementStock.mockResolvedValue(null);

      await expect(
        productsService.decrementStockForCheckout(
          fakeTx as never,
          'product-1',
          2,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('restoreStock delegates to the repository with the given transaction', async () => {
      productsRepository.restoreStock.mockResolvedValue(buildInventory());

      await productsService.restoreStock(fakeTx as never, 'product-1', 3);

      expect(productsRepository.restoreStock).toHaveBeenCalledWith(
        fakeTx,
        'product-1',
        3,
      );
    });
  });

  // The realtime layer's inventory broadcast is only as trustworthy as
  // this event: it must be recorded on the CALLER'S transaction handle
  // (so a rolled-back checkout announces nothing) and must carry the
  // post-change quantities, not the pre-change ones.
  describe('InventoryUpdated event', () => {
    it('records the post-decrement quantities on the caller’s transaction, tagged CHECKOUT', async () => {
      productsRepository.decrementStock.mockResolvedValue(
        buildInventory({
          quantityAvailable: 3,
          quantityReserved: 2,
          version: 7,
        }),
      );

      await productsService.decrementStockForCheckout(
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

    it('records nothing when the decrement failed — a sold-out attempt changed no stock', async () => {
      productsRepository.decrementStock.mockResolvedValue(null);

      await expect(
        productsService.decrementStockForCheckout(
          fakeTx as never,
          'product-1',
          2,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(outboxService.record).not.toHaveBeenCalled();
    });

    it('tags a cancellation restore as CANCELLATION so subscribers can tell the two apart', async () => {
      productsRepository.restoreStock.mockResolvedValue(
        buildInventory({ quantityAvailable: 10, quantityReserved: 0 }),
      );

      await productsService.restoreStock(fakeTx as never, 'product-1', 3);

      const [, event] = outboxService.record.mock.calls[0];
      expect(event.eventType).toBe(INVENTORY_UPDATED_EVENT);
      expect(event.payload).toMatchObject({
        quantityAvailable: 10,
        reason: 'CANCELLATION',
      });
    });
  });
});
