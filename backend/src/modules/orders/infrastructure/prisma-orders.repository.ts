import { Injectable } from '@nestjs/common';
import {
  LedgerEntryType,
  type Order,
  type OrderItem,
  type OrderStatus,
  type Prisma,
  type SellerOrder,
  type SellerOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  CreateFromCheckoutInput,
  CreateFromCheckoutResult,
  OrdersRepository,
  OrderWithSellerOrderItems,
  SellerOrderWithOrderContext,
} from '../domain/orders.repository';

// The only product fields an order line needs: enough to render it and
// link to the product page. Deliberately not the whole row — order
// history has no business exposing a product's moderation trail.
const PRODUCT_CARD = {
  select: {
    id: true,
    name: true,
    slug: true,
    imageUrl: true,
    status: true,
  },
} as const;

@Injectable()
export class PrismaOrdersRepository implements OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByBuyerId(buyerId: string): Promise<OrderWithSellerOrderItems[]> {
    return this.prisma.order.findMany({
      where: { buyerId },
      include: {
        sellerOrders: {
          include: { items: { include: { product: PRODUCT_CARD } } },
        },
      },
      orderBy: { placedAt: 'desc' },
    });
  }

  findById(id: string): Promise<OrderWithSellerOrderItems | null> {
    return this.prisma.order.findUnique({
      where: { id },
      include: {
        sellerOrders: {
          include: { items: { include: { product: PRODUCT_CARD } } },
        },
      },
    });
  }

  // Search spans the three things an admin actually has to hand: the
  // order id (from a dispute or a support ticket), the buyer, and the
  // product that went wrong. Applied in SQL alongside the page — never
  // to an already-selected page, which would search only the rows that
  // happened to land on it.
  async findAllForAdmin(filter: {
    status?: OrderStatus;
    buyerId?: string;
    search?: string;
    skip?: number;
    take?: number;
  }): Promise<{ items: OrderWithSellerOrderItems[]; total: number }> {
    const search = filter.search?.trim();
    const where: Prisma.OrderWhereInput = {
      status: filter.status,
      buyerId: filter.buyerId,
      ...(search
        ? {
            OR: [
              { id: { contains: search, mode: 'insensitive' } },
              { buyer: { email: { contains: search, mode: 'insensitive' } } },
              { buyer: { name: { contains: search, mode: 'insensitive' } } },
              {
                sellerOrders: {
                  some: {
                    items: {
                      some: {
                        product: {
                          name: { contains: search, mode: 'insensitive' },
                        },
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          sellerOrders: {
            include: { items: { include: { product: PRODUCT_CARD } } },
          },
        },
        orderBy: { placedAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total };
  }

  findSellerOrderById(id: string): Promise<SellerOrder | null> {
    return this.prisma.sellerOrder.findUnique({ where: { id } });
  }

  findBySellerId(sellerId: string): Promise<SellerOrderWithOrderContext[]> {
    return this.prisma.sellerOrder.findMany({
      where: { sellerId },
      include: {
        order: { select: { id: true, status: true, placedAt: true } },
        items: { include: { product: PRODUCT_CARD } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createFromCheckout(
    tx: Prisma.TransactionClient,
    input: CreateFromCheckoutInput,
  ): Promise<CreateFromCheckoutResult> {
    const order = await tx.order.create({
      data: { buyerId: input.buyerId, totalAmount: input.totalAmount },
    });

    const sellerOrders: SellerOrder[] = [];
    for (const line of input.sellerLines) {
      const sellerOrder = await tx.sellerOrder.create({
        data: {
          orderId: order.id,
          sellerId: line.sellerId,
          subtotal: line.subtotal,
        },
      });
      await tx.orderItem.createMany({
        data: line.items.map((item) => ({
          sellerOrderId: sellerOrder.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      });
      await tx.ledgerEntry.createMany({
        data: [
          {
            sellerId: line.sellerId,
            sellerOrderId: sellerOrder.id,
            type: LedgerEntryType.SALE,
            amount: line.subtotal,
          },
          {
            sellerId: line.sellerId,
            sellerOrderId: sellerOrder.id,
            type: LedgerEntryType.COMMISSION,
            amount: -line.commission,
          },
        ],
      });
      sellerOrders.push(sellerOrder);
    }

    return { order, sellerOrders };
  }

  async createLedgerEntries(
    tx: Prisma.TransactionClient,
    entries: Array<{
      sellerId: string;
      sellerOrderId: string;
      type: LedgerEntryType;
      amount: number;
    }>,
  ): Promise<void> {
    await tx.ledgerEntry.createMany({ data: entries });
  }

  updateSellerOrderStatus(
    tx: Prisma.TransactionClient,
    id: string,
    status: SellerOrderStatus,
  ): Promise<SellerOrder> {
    return tx.sellerOrder.update({ where: { id }, data: { status } });
  }

  async updateSellerOrderStatusIfCurrent(
    tx: Prisma.TransactionClient,
    id: string,
    expectedCurrent: SellerOrderStatus,
    next: SellerOrderStatus,
  ): Promise<SellerOrder | null> {
    const result = await tx.sellerOrder.updateMany({
      where: { id, status: expectedCurrent },
      data: { status: next },
    });
    if (result.count === 0) {
      return null;
    }
    return tx.sellerOrder.findUniqueOrThrow({ where: { id } });
  }

  updateOrderStatus(
    tx: Prisma.TransactionClient,
    orderId: string,
    status: OrderStatus,
  ): Promise<Order> {
    return tx.order.update({ where: { id: orderId }, data: { status } });
  }

  findOrderItemsForSellerOrder(
    tx: Prisma.TransactionClient,
    sellerOrderId: string,
  ): Promise<OrderItem[]> {
    return tx.orderItem.findMany({ where: { sellerOrderId } });
  }

  async findSellerOrderStatusesForOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<SellerOrderStatus[]> {
    const rows = await tx.sellerOrder.findMany({
      where: { orderId },
      select: { status: true },
    });
    return rows.map((r) => r.status);
  }
}
