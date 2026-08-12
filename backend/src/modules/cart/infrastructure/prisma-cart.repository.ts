import { Injectable } from '@nestjs/common';
import type { Cart, CartItem } from '@prisma/client';
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

  upsertItem(
    cartId: string,
    productId: string,
    quantity: number,
  ): Promise<CartItem> {
    return this.prisma.cartItem.upsert({
      where: { cartId_productId: { cartId, productId } },
      create: { cartId, productId, quantity },
      update: { quantity },
    });
  }

  async removeItem(cartId: string, productId: string): Promise<void> {
    await this.prisma.cartItem.delete({
      where: { cartId_productId: { cartId, productId } },
    });
  }
}
