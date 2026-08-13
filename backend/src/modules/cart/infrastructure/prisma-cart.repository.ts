import { Injectable } from '@nestjs/common';
import type { Prisma, Cart, CartItem } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CartRepository, CartWithItems } from '../domain/cart.repository';

@Injectable()
export class PrismaCartRepository implements CartRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByBuyerId(buyerId: string): Promise<CartWithItems | null> {
    return this.prisma.cart.findUnique({
      where: { buyerId },
      include: { items: true },
    });
  }

  createForBuyer(buyerId: string): Promise<Cart> {
    return this.prisma.cart.create({ data: { buyerId } });
  }

  addItem(
    tx: Prisma.TransactionClient,
    cartId: string,
    productId: string,
    quantity: number,
  ): Promise<CartItem> {
    return tx.cartItem.upsert({
      where: { cartId_productId: { cartId, productId } },
      create: { cartId, productId, quantity },
      update: { quantity: { increment: quantity } },
    });
  }

  setItemQuantity(
    cartId: string,
    productId: string,
    quantity: number,
  ): Promise<CartItem> {
    return this.prisma.cartItem.update({
      where: { cartId_productId: { cartId, productId } },
      data: { quantity },
    });
  }

  findItem(cartId: string, productId: string): Promise<CartItem | null> {
    return this.prisma.cartItem.findUnique({
      where: { cartId_productId: { cartId, productId } },
    });
  }

  async removeItem(cartId: string, productId: string): Promise<void> {
    await this.prisma.cartItem.delete({
      where: { cartId_productId: { cartId, productId } },
    });
  }

  async clearCart(tx: Prisma.TransactionClient, cartId: string): Promise<void> {
    await tx.cartItem.deleteMany({ where: { cartId } });
  }

  async ensureOpenSession(
    tx: Prisma.TransactionClient,
    cartId: string,
    buyerId: string,
  ): Promise<void> {
    const open = await tx.cartSession.findFirst({
      where: { cartId, convertedAt: null },
      select: { id: true },
    });
    if (!open) {
      await tx.cartSession.create({ data: { cartId, buyerId } });
    }
  }

  // updateMany, not update: two concurrent add-to-cart calls can leave
  // this cart with more than one open session (see the CartSession model
  // comment). Closing all of them keeps the funnel's numerator and
  // denominator consistent with each other.
  async markSessionsConverted(
    tx: Prisma.TransactionClient,
    cartId: string,
    orderId: string,
  ): Promise<void> {
    await tx.cartSession.updateMany({
      where: { cartId, convertedAt: null },
      data: { convertedAt: new Date(), orderId },
    });
  }
}
