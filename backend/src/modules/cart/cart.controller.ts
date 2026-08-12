import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';

// TODO(auth): buyerId should come from the authenticated caller, not a
// path param — every route here is an IDOR risk until then.
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get(':buyerId')
  getCart(@Param('buyerId') buyerId: string) {
    return this.cartService.getOrCreateForBuyer(buyerId);
  }

  @Post(':buyerId/items')
  addItem(@Param('buyerId') buyerId: string, @Body() dto: AddCartItemDto) {
    return this.cartService.addItem(buyerId, dto);
  }

  @Delete(':buyerId/items/:productId')
  removeItem(
    @Param('buyerId') buyerId: string,
    @Param('productId') productId: string,
  ) {
    return this.cartService.removeItem(buyerId, productId);
  }
}
