import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CheckoutDto } from './dto/checkout.dto';
import { UpdateSellerOrderStatusDto } from './dto/update-seller-order-status.dto';

// TODO(auth): buyerId should come from the authenticated caller; seller-
// order status updates must be restricted to the owning seller (or ADMIN).
// TODO: rate limit POST /checkout (checkout is a plausible abuse target).
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findByBuyerId(@Query('buyerId') buyerId: string) {
    return this.ordersService.findByBuyerId(buyerId);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.ordersService.findById(id);
  }

  @Post('checkout')
  checkout(@Body() dto: CheckoutDto) {
    return this.ordersService.checkout(dto);
  }

  @Patch('seller-orders/:id/status')
  updateSellerOrderStatus(
    @Param('id') id: string,
    @Body() dto: UpdateSellerOrderStatusDto,
  ) {
    return this.ordersService.updateSellerOrderStatus(id, dto);
  }
}
