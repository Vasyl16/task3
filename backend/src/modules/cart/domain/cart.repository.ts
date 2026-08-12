import type { Cart, CartItem } from '@prisma/client';

export type CartWithItems = Cart & { items: CartItem[] };

export abstract class CartRepository {
  abstract findByBuyerId(buyerId: string): Promise<CartWithItems | null>;
  abstract createForBuyer(buyerId: string): Promise<Cart>;
  abstract upsertItem(
    cartId: string,
    productId: string,
    quantity: number,
  ): Promise<CartItem>;
  abstract removeItem(cartId: string, productId: string): Promise<void>;
}
