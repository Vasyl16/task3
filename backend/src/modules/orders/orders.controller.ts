import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import { Roles } from '../../core/auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { IdempotencyInterceptor } from '../../infrastructure/idempotency/idempotency.interceptor';
import { OrdersService } from './orders.service';
import { UpdateSellerOrderStatusDto } from './dto/update-seller-order-status.dto';

// TODO: rate limit POST /checkout (checkout is a plausible abuse target
// — see .claude/rules/backend.md).
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findMyOrders(@CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.findByBuyerId(user.id);
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.findById(id, user);
  }

  // Idempotent when the client sends an Idempotency-Key header — a
  // retried checkout request (e.g. after a client-side timeout that
  // never saw the response) with the same key returns the SAME order
  // rather than placing a second one. See IdempotencyInterceptor; this
  // is opt-in, not a substitute for the transaction's own correctness.
  @UseInterceptors(IdempotencyInterceptor)
  @Post('checkout')
  checkout(@CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.checkout(user.id);
  }

  // The auction-winner counterpart to cart checkout — see
  // OrdersService.checkoutAuctionWin. Ownership (only the auction's
  // actual winner) and the checkout-window deadline are enforced inside
  // the service.
  @UseInterceptors(IdempotencyInterceptor)
  @Post('checkout/auctions/:auctionId')
  checkoutAuctionWin(
    @Param('auctionId') auctionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.checkoutAuctionWin(auctionId, user.id);
  }

  // Ownership (SELLER may only act on their own SellerOrder; ADMIN is an
  // explicit override) is enforced inside the service.
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @Patch('seller-orders/:id/status')
  updateSellerOrderStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSellerOrderStatusDto,
  ) {
    return this.ordersService.updateSellerOrderStatus(id, user, dto);
  }
}
