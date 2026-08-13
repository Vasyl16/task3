import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ProductStatus,
  ProductType,
  type Cart,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { CartRepository, CartWithItems } from './domain/cart.repository';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@Injectable()
export class CartService {
  constructor(
    private readonly cartRepository: CartRepository,
    private readonly productsService: ProductsService,
    // Used only to open the transaction boundary in addItem — the item
    // write and its funnel record must commit together.
    private readonly prisma: PrismaService,
  ) {}

  async getOrCreateForBuyer(buyerId: string): Promise<CartWithItems> {
    const existing = await this.cartRepository.findByBuyerId(buyerId);
    if (existing) {
      return existing;
    }
    const cart = await this.cartRepository.createForBuyer(buyerId);
    return { ...cart, items: [] };
  }

  // A cart may hold products from any number of different sellers — cart
  // items are keyed only by (cartId, productId), never grouped or
  // restricted by seller. Multi-vendor splitting happens later, at
  // checkout (see OrdersService.checkout).
  async addItem(buyerId: string, dto: AddCartItemDto) {
    const product = await this.productsService.findById(dto.productId); // 404s if missing
    this.assertPurchasableViaCart(product);
    const cart = await this.getOrCreateCartId(buyerId);
    // NOTE: no STOCK validation here by design — quantity sufficiency is
    // only authoritative at checkout time, inside its own transaction
    // (see OrdersService.checkout step 5). Product EXISTENCE + ACTIVE
    // status, however, is checked right now — the two are different
    // things: a customer should get immediate feedback that they're
    // adding a real, currently-listed product, but "is there enough
    // stock for the quantity they'll eventually check out with" can only
    // ever be answered authoritatively at the moment of checkout, since
    // it changes with everyone else's concurrent activity too.
    return this.prisma.$transaction(async (tx) => {
      const item = await this.cartRepository.addItem(
        tx,
        cart.id,
        dto.productId,
        dto.quantity,
      );
      // Opens a conversion-funnel session if this cart doesn't already
      // have one — the denominator of the cart→order conversion rate.
      // Same transaction as the item itself, so the two can't disagree.
      await this.cartRepository.ensureOpenSession(tx, cart.id, buyerId);
      return item;
    });
  }

  // Sets the line to an explicit quantity (distinct from addItem, which
  // increments) — e.g. a quantity stepper on the cart page.
  async updateItemQuantity(
    buyerId: string,
    productId: string,
    dto: UpdateCartItemDto,
  ) {
    const cart = await this.getOrCreateCartId(buyerId);
    const existing = await this.cartRepository.findItem(cart.id, productId);
    if (!existing) {
      throw new NotFoundException(`Product ${productId} is not in this cart`);
    }
    return this.cartRepository.setItemQuantity(
      cart.id,
      productId,
      dto.quantity,
    );
  }

  async removeItem(buyerId: string, productId: string): Promise<void> {
    const cart = await this.getOrCreateCartId(buyerId);
    const existing = await this.cartRepository.findItem(cart.id, productId);
    if (!existing) {
      throw new NotFoundException(`Product ${productId} is not in this cart`);
    }
    await this.cartRepository.removeItem(cart.id, productId);
  }

  // Used only by OrdersService.checkout, inside its own transaction —
  // see CartRepository.clearCart. Closing the funnel session and emptying
  // the cart are one operation deliberately: emptying it without
  // recording the conversion would silently turn a converted cart into an
  // abandoned one, and there is no way to reconstruct it afterwards.
  async completeCheckout(
    tx: Prisma.TransactionClient,
    cartId: string,
    orderId: string,
  ): Promise<void> {
    await this.cartRepository.markSessionsConverted(tx, cartId, orderId);
    await this.cartRepository.clearCart(tx, cartId);
  }

  private assertPurchasableViaCart(product: {
    type: ProductType;
    status: ProductStatus;
  }): void {
    if (product.type === ProductType.AUCTION) {
      throw new BadRequestException(
        'Auction products cannot be added to a cart — place a bid instead',
      );
    }
    if (product.status !== ProductStatus.ACTIVE) {
      throw new BadRequestException(
        'This product is no longer available for purchase',
      );
    }
  }

  private async getOrCreateCartId(buyerId: string): Promise<Cart> {
    const existing = await this.cartRepository.findByBuyerId(buyerId);
    return existing ?? this.cartRepository.createForBuyer(buyerId);
  }
}
