import { BadRequestException, Injectable } from '@nestjs/common';
import { ProductType, type Cart } from '@prisma/client';
import { ProductsService } from '../products/products.service';
import { CartRepository, CartWithItems } from './domain/cart.repository';
import { AddCartItemDto } from './dto/add-cart-item.dto';

@Injectable()
export class CartService {
  constructor(
    private readonly cartRepository: CartRepository,
    private readonly productsService: ProductsService,
  ) {}

  async getOrCreateForBuyer(buyerId: string): Promise<CartWithItems> {
    const existing = await this.cartRepository.findByBuyerId(buyerId);
    if (existing) {
      return existing;
    }
    const cart = await this.cartRepository.createForBuyer(buyerId);
    return { ...cart, items: [] };
  }

  async addItem(buyerId: string, dto: AddCartItemDto) {
    const product = await this.productsService.findById(dto.productId); // 404s if missing
    if (product.type === ProductType.AUCTION) {
      throw new BadRequestException(
        'Auction products cannot be added to a cart — place a bid instead',
      );
    }
    const cart = await this.getOrCreateCartId(buyerId);
    // NOTE: no stock validation here by design — availability is only
    // authoritative at checkout time, inside its own transaction. A
    // product may also be archived/deactivated by its seller after being
    // added here; checkout must re-check product.status === ACTIVE too.
    return this.cartRepository.upsertItem(cart.id, dto.productId, dto.quantity);
  }

  async removeItem(buyerId: string, productId: string): Promise<void> {
    const cart = await this.getOrCreateCartId(buyerId);
    await this.cartRepository.removeItem(cart.id, productId);
  }

  private async getOrCreateCartId(buyerId: string): Promise<Cart> {
    const existing = await this.cartRepository.findByBuyerId(buyerId);
    return existing ?? this.cartRepository.createForBuyer(buyerId);
  }
}
