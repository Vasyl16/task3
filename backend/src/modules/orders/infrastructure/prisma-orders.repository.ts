import { Injectable } from '@nestjs/common';
import type { SellerOrder } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  OrdersRepository,
  OrderWithSellerOrders,
} from '../domain/orders.repository';

@Injectable()
export class PrismaOrdersRepository implements OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByBuyerId(buyerId: string): Promise<OrderWithSellerOrders[]> {
    return this.prisma.order.findMany({
      where: { buyerId },
      include: { sellerOrders: true },
      orderBy: { placedAt: 'desc' },
    });
  }

  findById(id: string): Promise<OrderWithSellerOrders | null> {
    return this.prisma.order.findUnique({
      where: { id },
      include: { sellerOrders: true },
    });
  }

  findSellerOrderById(id: string): Promise<SellerOrder | null> {
    return this.prisma.sellerOrder.findUnique({ where: { id } });
  }
}
