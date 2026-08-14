import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import { Roles } from '../../core/auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { ApiAuth, ApiOwnership } from '../../core/openapi/api-auth.decorator';
import { IdempotencyInterceptor } from '../../infrastructure/idempotency/idempotency.interceptor';
import { OrdersService } from './orders.service';
import { UpdateSellerOrderStatusDto } from './dto/update-seller-order-status.dto';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: false,
  description:
    'Optional. Any unique string (a UUID is typical). Retrying with the ' +
    'same key returns the ORIGINAL response instead of acting a second ' +
    'time. Reusing a key with a different body is rejected with 409.',
};

// Checkout is covered by the app-wide default rate limit (see
// CoreModule). What actually makes a duplicate checkout harmless is the
// Idempotency-Key guard plus the transaction's own stock check, not a
// request-rate cap.
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @ApiAuth()
  @ApiOperation({
    summary: 'List the caller’s own orders',
    description:
      'Scoped to the authenticated buyer — there is no buyerId parameter ' +
      'to point at someone else.',
  })
  @ApiOkResponse({ description: 'Orders, each with its SellerOrders.' })
  findMyOrders(@CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.findByBuyerId(user.id);
  }

  // Declared before ':id' so the literal path isn't shadowed by the
  // dynamic segment (GET /orders/:id would otherwise treat
  // "seller-orders" as an order id).
  @Roles(UserRole.SELLER)
  @Get('seller-orders')
  @ApiAuth(UserRole.SELLER)
  @ApiOperation({
    summary: 'List the calling seller’s own SellerOrders',
    description:
      'The seller is resolved from the caller’s own approved profile, ' +
      'never from a parameter — so there is no id to swap for another ' +
      'seller’s.',
  })
  findMySellerOrders(@CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.findMySellerOrders(user.id);
  }

  @Get(':id')
  @ApiAuth()
  @ApiOperation({ summary: 'Get one order (buyer, or ADMIN)' })
  @ApiOwnership('Order')
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
  @ApiAuth()
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({
    summary: 'Check out the caller’s cart',
    description:
      'THE multi-vendor transaction. In one database transaction it ' +
      're-reads every product from PostgreSQL (never the cart’s cached ' +
      'price, never the search index), validates availability and stock, ' +
      'decrements inventory, splits the cart into one SellerOrder per ' +
      'seller, computes the 10% platform commission, writes the ledger ' +
      'entries and outbox events, and clears the cart. Any failure rolls ' +
      'back all of it — there is no partial order.',
  })
  @ApiCreatedResponse({
    description: 'Order placed, with one SellerOrder per seller.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Cart empty, a product is no longer purchasable (archived, or ' +
      'auction-only), or insufficient stock. Nothing was decremented.',
  })
  @ApiResponse({
    status: 409,
    description:
      'A concurrent checkout took the last units, or this ' +
      'Idempotency-Key is still in flight.',
  })
  checkout(@CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.checkout(user.id);
  }

  // The auction-winner counterpart to cart checkout — see
  // OrdersService.checkoutAuctionWin. Ownership (only the auction's
  // actual winner) and the checkout-window deadline are enforced inside
  // the service.
  @UseInterceptors(IdempotencyInterceptor)
  @Post('checkout/auctions/:auctionId')
  @ApiAuth()
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiParam({ name: 'auctionId', description: 'An auction the caller won.' })
  @ApiOperation({
    summary: 'Claim an auction win',
    description:
      'Converts a won auction into an order at the winning bid price ' +
      '(re-read from the database, not taken from the client). The lot ' +
      'has been HELD since the auction was created — stock was never ' +
      'consumed — so this releases the hold and decrements in the same ' +
      'transaction. Winners have a 48-hour window.',
  })
  @ApiResponse({
    status: 400,
    description:
      'The auction has no completed win awaiting checkout, the window has ' +
      'expired, or the product is no longer available.',
  })
  @ApiResponse({
    status: 403,
    description: 'The caller did not win this auction.',
  })
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
  @ApiAuth(UserRole.SELLER, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Advance or cancel one SellerOrder',
    description:
      'Valid transitions only: NEW → PROCESSING → SHIPPED → COMPLETED, or ' +
      'NEW/PROCESSING → CANCELLED. Cancelling restores that seller’s ' +
      'stock, reverses its ledger entries, and starts the refund saga — ' +
      'and touches no other seller’s part of the same order. The parent ' +
      'Order’s status is recomputed from all its SellerOrders.',
  })
  @ApiOkResponse({ description: 'Transition applied.' })
  @ApiResponse({
    status: 400,
    description: 'Not a legal transition from the current status.',
  })
  @ApiResponse({
    status: 403,
    description: 'A seller may only act on their own SellerOrders.',
  })
  updateSellerOrderStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSellerOrderStatusDto,
  ) {
    return this.ordersService.updateSellerOrderStatus(id, user, dto);
  }
}
