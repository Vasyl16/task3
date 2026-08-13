import type { Prisma, Cart, CartItem } from '@prisma/client';

export type CartWithItems = Cart & { items: CartItem[] };

export abstract class CartRepository {
  abstract findByBuyerId(buyerId: string): Promise<CartWithItems | null>;
  abstract createForBuyer(buyerId: string): Promise<Cart>;
  // Adds to the existing quantity if the product is already in the cart
  // ("add to cart" semantics) — see CartService.addItem. Distinct from
  // setItemQuantity, which sets an explicit value. Takes the caller's
  // transaction client so the item write and the funnel record
  // (ensureOpenSession) commit together.
  abstract addItem(
    tx: Prisma.TransactionClient,
    cartId: string,
    productId: string,
    quantity: number,
  ): Promise<CartItem>;
  // Throws if the item isn't already in the cart — CartService checks
  // existence first for a clean 404 rather than surfacing a raw Prisma
  // "record not found" error.
  abstract setItemQuantity(
    cartId: string,
    productId: string,
    quantity: number,
  ): Promise<CartItem>;
  abstract findItem(
    cartId: string,
    productId: string,
  ): Promise<CartItem | null>;
  abstract removeItem(cartId: string, productId: string): Promise<void>;
  // Takes the caller's transaction client — checkout clears the cart in
  // the SAME transaction as order creation + stock decrement, so a
  // failure anywhere rolls the cart-clear back too. See
  // OrdersService.checkout.
  abstract clearCart(
    tx: Prisma.TransactionClient,
    cartId: string,
  ): Promise<void>;

  // ===================== Conversion funnel =====================
  // See the CartSession model in schema.prisma for why this exists at
  // all: checkout deletes CartItem rows, so a converted cart leaves no
  // evidence behind to count.

  // Opens a session if this cart has none open. Idempotent per cart, so
  // it can be called on every add-to-cart without a prior emptiness check.
  abstract ensureOpenSession(
    tx: Prisma.TransactionClient,
    cartId: string,
    buyerId: string,
  ): Promise<void>;

  abstract markSessionsConverted(
    tx: Prisma.TransactionClient,
    cartId: string,
    orderId: string,
  ): Promise<void>;
}
