import {
  BadRequestException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import type { SellerOrder } from '@prisma/client';
import { CartService } from '../cart/cart.service';
import { UsersService } from '../users/users.service';
import {
  OrdersRepository,
  OrderWithSellerOrders,
} from './domain/orders.repository';
import { CheckoutDto } from './dto/checkout.dto';
import { UpdateSellerOrderStatusDto } from './dto/update-seller-order-status.dto';

@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly cartService: CartService,
    private readonly usersService: UsersService,
  ) {}

  findByBuyerId(buyerId: string): Promise<OrderWithSellerOrders[]> {
    return this.ordersRepository.findByBuyerId(buyerId);
  }

  async findById(id: string): Promise<OrderWithSellerOrders> {
    const order = await this.ordersRepository.findById(id);
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }

  // THE multi-vendor checkout transaction: per ../../CLAUDE.md this must
  // run as ONE DB transaction that (a) reserves/decrements Inventory per
  // line item via its optimistic `version` guard, (b) groups cart items by
  // seller into one SellerOrder + OrderItems each, (c) creates the parent
  // Order, (d) clears the Cart, (e) records an OrderPlaced outbox event —
  // or none of that happens. Deliberately not implemented here.
  async checkout(dto: CheckoutDto) {
    await this.usersService.findById(dto.buyerId); // 404s if missing
    const cart = await this.cartService.getOrCreateForBuyer(dto.buyerId);
    if (cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }
    throw new NotImplementedException('OrdersService.checkout');
  }

  async findSellerOrderById(id: string): Promise<SellerOrder> {
    const sellerOrder = await this.ordersRepository.findSellerOrderById(id);
    if (!sellerOrder) {
      throw new NotFoundException(`SellerOrder ${id} not found`);
    }
    return sellerOrder;
  }

  // Must recompute the parent Order.status synchronously, in the SAME
  // transaction as this status write (see ../../CLAUDE.md) — never let the
  // aggregate drift into an eventually-consistent background job.
  async updateSellerOrderStatus(
    id: string,
    _dto: UpdateSellerOrderStatusDto,
  ): Promise<SellerOrder> {
    await this.findSellerOrderById(id); // 404s if missing
    throw new NotImplementedException('OrdersService.updateSellerOrderStatus');
  }
}
