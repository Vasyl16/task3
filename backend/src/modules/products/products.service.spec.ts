import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ProductStatus,
  ProductType,
  SellerProfileStatus,
  UserRole,
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
import { ProductsService } from './products.service';

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

  beforeEach(async () => {
    productsRepository = {
      findAll: jest.fn(),
      findById: jest.fn(),
      createWithInventory: jest.fn(),
      update: jest.fn(),
      archive: jest.fn(),
    };
    sellersService = {
      getOwnApprovedSellerProfileOrThrow: jest.fn(),
      findById: jest.fn(),
    };
    categoriesService = {
      findById: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: ProductsRepository, useValue: productsRepository },
        { provide: SellersService, useValue: sellersService },
        { provide: CategoriesService, useValue: categoriesService },
        { provide: OutboxService, useValue: { record: jest.fn() } },
        { provide: CorrelationIdService, useValue: { getId: () => 'corr-1' } },
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})),
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

      expect(productsRepository.update).toHaveBeenCalledWith('product-1', {
        name: 'New name',
      });
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

      expect(productsRepository.archive).toHaveBeenCalledWith('product-1');
      expect(result.status).toBe(ProductStatus.ARCHIVED);
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
});
