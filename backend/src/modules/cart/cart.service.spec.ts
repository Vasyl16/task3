import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ProductStatus, ProductType, type Product } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { CartRepository } from './domain/cart.repository';
import { CartService } from './cart.service';

const NOW = new Date();
// Stand-in transaction client — CartService only ever passes it through
// to the repository, so its identity is all these tests need to assert.
const fakeTx = { __tx: true } as unknown as Parameters<
  CartRepository['addItem']
>[0];

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    sellerId: 'seller-1',
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

describe('CartService', () => {
  let cartService: CartService;
  let cartRepository: jest.Mocked<CartRepository>;
  let productsService: jest.Mocked<Pick<ProductsService, 'findById'>>;

  beforeEach(async () => {
    cartRepository = {
      findByBuyerId: jest.fn(),
      createForBuyer: jest.fn(),
      addItem: jest.fn(),
      setItemQuantity: jest.fn(),
      findItem: jest.fn(),
      removeItem: jest.fn(),
      clearCart: jest.fn(),
      ensureOpenSession: jest.fn(),
      markSessionsConverted: jest.fn(),
    };
    productsService = { findById: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: CartRepository, useValue: cartRepository },
        { provide: ProductsService, useValue: productsService },
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(fakeTx)),
          },
        },
      ],
    }).compile();

    cartService = moduleRef.get(CartService);
  });

  describe('addItem', () => {
    it('adds a product to an existing cart', async () => {
      cartRepository.findByBuyerId.mockResolvedValue({
        id: 'cart-1',
        buyerId: 'buyer-1',
        createdAt: NOW,
        updatedAt: NOW,
        items: [],
      });
      productsService.findById.mockResolvedValue(buildProduct());
      cartRepository.addItem.mockResolvedValue({
        id: 'item-1',
        cartId: 'cart-1',
        productId: 'product-1',
        quantity: 2,
        addedAt: NOW,
      });

      await cartService.addItem('buyer-1', {
        productId: 'product-1',
        quantity: 2,
      });

      expect(cartRepository.addItem).toHaveBeenCalledWith(
        fakeTx,
        'cart-1',
        'product-1',
        2,
      );
    });

    // The denominator of the cart→order conversion rate. It has to be
    // written here, on the way in, because checkout deletes the cart's
    // items on the way out — see the CartSession model in schema.prisma.
    it('opens a conversion-funnel session in the same transaction as the item', async () => {
      cartRepository.findByBuyerId.mockResolvedValue({
        id: 'cart-1',
        buyerId: 'buyer-1',
        createdAt: NOW,
        updatedAt: NOW,
        items: [],
      });
      productsService.findById.mockResolvedValue(buildProduct());
      cartRepository.addItem.mockResolvedValue({
        id: 'item-1',
        cartId: 'cart-1',
        productId: 'product-1',
        quantity: 1,
        addedAt: NOW,
      });

      await cartService.addItem('buyer-1', {
        productId: 'product-1',
        quantity: 1,
      });

      expect(cartRepository.ensureOpenSession).toHaveBeenCalledWith(
        fakeTx,
        'cart-1',
        'buyer-1',
      );
    });

    it('records no funnel session when the product is rejected', async () => {
      productsService.findById.mockResolvedValue(
        buildProduct({ type: ProductType.AUCTION }),
      );

      await expect(
        cartService.addItem('buyer-1', { productId: 'product-1', quantity: 1 }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(cartRepository.ensureOpenSession).not.toHaveBeenCalled();
    });

    it('creates the cart on first add if the buyer has none yet', async () => {
      cartRepository.findByBuyerId.mockResolvedValue(null);
      cartRepository.createForBuyer.mockResolvedValue({
        id: 'new-cart',
        buyerId: 'buyer-1',
        createdAt: NOW,
        updatedAt: NOW,
      });
      productsService.findById.mockResolvedValue(buildProduct());
      cartRepository.addItem.mockResolvedValue({
        id: 'item-1',
        cartId: 'new-cart',
        productId: 'product-1',
        quantity: 1,
        addedAt: NOW,
      });

      await cartService.addItem('buyer-1', {
        productId: 'product-1',
        quantity: 1,
      });

      expect(cartRepository.createForBuyer).toHaveBeenCalledWith('buyer-1');
      expect(cartRepository.addItem).toHaveBeenCalledWith(
        fakeTx,
        'new-cart',
        'product-1',
        1,
      );
    });

    // Multiple sellers: cart items are never grouped/restricted by
    // seller — adding products from two different sellers is just two
    // ordinary addItem calls against the same cart.
    it('allows adding products from different sellers to the same cart', async () => {
      cartRepository.findByBuyerId.mockResolvedValue({
        id: 'cart-1',
        buyerId: 'buyer-1',
        createdAt: NOW,
        updatedAt: NOW,
        items: [],
      });
      productsService.findById
        .mockResolvedValueOnce(
          buildProduct({ id: 'product-a', sellerId: 'seller-a' }),
        )
        .mockResolvedValueOnce(
          buildProduct({ id: 'product-b', sellerId: 'seller-b' }),
        );
      cartRepository.addItem.mockResolvedValue({
        id: 'item',
        cartId: 'cart-1',
        productId: 'product-a',
        quantity: 1,
        addedAt: NOW,
      });

      await cartService.addItem('buyer-1', {
        productId: 'product-a',
        quantity: 1,
      });
      await cartService.addItem('buyer-1', {
        productId: 'product-b',
        quantity: 1,
      });

      expect(cartRepository.addItem).toHaveBeenNthCalledWith(
        1,
        fakeTx,
        'cart-1',
        'product-a',
        1,
      );
      expect(cartRepository.addItem).toHaveBeenNthCalledWith(
        2,
        fakeTx,
        'cart-1',
        'product-b',
        1,
      );
    });

    it('rejects an AUCTION-type product', async () => {
      cartRepository.findByBuyerId.mockResolvedValue({
        id: 'cart-1',
        buyerId: 'buyer-1',
        createdAt: NOW,
        updatedAt: NOW,
        items: [],
      });
      productsService.findById.mockResolvedValue(
        buildProduct({ type: ProductType.AUCTION }),
      );

      await expect(
        cartService.addItem('buyer-1', { productId: 'product-1', quantity: 1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(cartRepository.addItem).not.toHaveBeenCalled();
    });

    // Inactive/deleted (archived) product: addItem validates the
    // authoritative product state, not just its existence.
    it('rejects a product that has been archived/deactivated by its seller', async () => {
      cartRepository.findByBuyerId.mockResolvedValue({
        id: 'cart-1',
        buyerId: 'buyer-1',
        createdAt: NOW,
        updatedAt: NOW,
        items: [],
      });
      productsService.findById.mockResolvedValue(
        buildProduct({ status: ProductStatus.ARCHIVED }),
      );

      await expect(
        cartService.addItem('buyer-1', { productId: 'product-1', quantity: 1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(cartRepository.addItem).not.toHaveBeenCalled();
    });

    it('rejects a DRAFT (not yet listed) product', async () => {
      cartRepository.findByBuyerId.mockResolvedValue({
        id: 'cart-1',
        buyerId: 'buyer-1',
        createdAt: NOW,
        updatedAt: NOW,
        items: [],
      });
      productsService.findById.mockResolvedValue(
        buildProduct({ status: ProductStatus.DRAFT }),
      );

      await expect(
        cartService.addItem('buyer-1', { productId: 'product-1', quantity: 1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('updateItemQuantity', () => {
    it('sets the quantity for an item already in the cart', async () => {
      cartRepository.findByBuyerId.mockResolvedValue({
        id: 'cart-1',
        buyerId: 'buyer-1',
        createdAt: NOW,
        updatedAt: NOW,
        items: [],
      });
      cartRepository.findItem.mockResolvedValue({
        id: 'item-1',
        cartId: 'cart-1',
        productId: 'product-1',
        quantity: 1,
        addedAt: NOW,
      });
      cartRepository.setItemQuantity.mockResolvedValue({
        id: 'item-1',
        cartId: 'cart-1',
        productId: 'product-1',
        quantity: 5,
        addedAt: NOW,
      });

      const result = await cartService.updateItemQuantity(
        'buyer-1',
        'product-1',
        {
          quantity: 5,
        },
      );

      expect(cartRepository.setItemQuantity).toHaveBeenCalledWith(
        'cart-1',
        'product-1',
        5,
      );
      expect(result.quantity).toBe(5);
    });

    it('404s when updating the quantity of a product not in the cart', async () => {
      cartRepository.findByBuyerId.mockResolvedValue({
        id: 'cart-1',
        buyerId: 'buyer-1',
        createdAt: NOW,
        updatedAt: NOW,
        items: [],
      });
      cartRepository.findItem.mockResolvedValue(null);

      await expect(
        cartService.updateItemQuantity('buyer-1', 'product-1', { quantity: 3 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(cartRepository.setItemQuantity).not.toHaveBeenCalled();
    });
  });

  describe('removeItem', () => {
    it('removes an item present in the cart', async () => {
      cartRepository.findByBuyerId.mockResolvedValue({
        id: 'cart-1',
        buyerId: 'buyer-1',
        createdAt: NOW,
        updatedAt: NOW,
        items: [],
      });
      cartRepository.findItem.mockResolvedValue({
        id: 'item-1',
        cartId: 'cart-1',
        productId: 'product-1',
        quantity: 1,
        addedAt: NOW,
      });

      await cartService.removeItem('buyer-1', 'product-1');

      expect(cartRepository.removeItem).toHaveBeenCalledWith(
        'cart-1',
        'product-1',
      );
    });

    it('404s when removing a product not in the cart', async () => {
      cartRepository.findByBuyerId.mockResolvedValue({
        id: 'cart-1',
        buyerId: 'buyer-1',
        createdAt: NOW,
        updatedAt: NOW,
        items: [],
      });
      cartRepository.findItem.mockResolvedValue(null);

      await expect(
        cartService.removeItem('buyer-1', 'product-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(cartRepository.removeItem).not.toHaveBeenCalled();
    });
  });
});
