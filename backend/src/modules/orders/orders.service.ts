import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { UserRole, type SellerOrder } from '@prisma/client';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { CartService } from '../cart/cart.service';
import { SellersService } from '../sellers/sellers.service';
import {
  OrdersRepository,
  OrderWithSellerOrders,
} from './domain/orders.repository';
import { UpdateSellerOrderStatusDto } from './dto/update-seller-order-status.dto';

@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly cartService: CartService,
    private readonly sellersService: SellersService,
  ) {}

  findByBuyerId(buyerId: string): Promise<OrderWithSellerOrders[]> {
    return this.ordersRepository.findByBuyerId(buyerId);
  }

  async findById(
    id: string,
    caller: AuthenticatedUser,
  ): Promise<OrderWithSellerOrders> {
    const order = await this.ordersRepository.findById(id);
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    if (caller.role !== UserRole.ADMIN && order.buyerId !== caller.id) {
      // 404, not 403 — don't confirm to a stranger that this order ID
      // exists at all.
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }

  // THE multi-vendor checkout transaction: per the backend-architecture
  // skill this must run as ONE DB transaction that (a) reserves/decrements
  // Inventory per line item via its optimistic `version` guard — and
  // re-validates each product is still ACTIVE, since it may have been
  // archived/deactivated by its seller after being added to this cart —
  // (b) groups cart items by seller into one SellerOrder + OrderItems
  // each, (c) creates the parent Order, (d) clears the Cart, (e) records
  // an OrderPlaced outbox event — or none of that happens. Deliberately
  // not implemented here.
  async checkout(buyerId: string) {
    const cart = await this.cartService.getOrCreateForBuyer(buyerId);
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
  // transaction as this status write (see the backend-architecture
  // skill) — never let the aggregate drift into an eventually-consistent
  // background job.
  async updateSellerOrderStatus(
    id: string,
    caller: AuthenticatedUser,
    _dto: UpdateSellerOrderStatusDto,
  ): Promise<SellerOrder> {
    const sellerOrder = await this.findSellerOrderById(id); // 404s if missing
    await this.assertOwnsSellerOrderOrIsAdmin(sellerOrder, caller);
    throw new NotImplementedException('OrdersService.updateSellerOrderStatus');
  }

  // ADMIN bypasses ownership entirely (explicit admin override); a
  // SELLER may only act on their own SellerOrders.
  private async assertOwnsSellerOrderOrIsAdmin(
    sellerOrder: SellerOrder,
    caller: AuthenticatedUser,
  ): Promise<void> {
    if (caller.role === UserRole.ADMIN) {
      return;
    }
    const ownProfile =
      await this.sellersService.getOwnApprovedSellerProfileOrThrow(caller.id);
    if (ownProfile.id !== sellerOrder.sellerId) {
      throw new ForbiddenException('You do not own this SellerOrder');
    }
  }
}
