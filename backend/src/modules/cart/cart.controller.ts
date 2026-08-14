import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { ApiTags } from '@nestjs/swagger';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiAuth } from '../../core/openapi/api-auth.decorator';

// buyerId always comes from @CurrentUser() (the verified JWT), never
// from a request param — every route here is scoped to the caller's own
// cart by construction, so there's no ownership check to write (there is
// nothing else it could operate on).
@ApiTags('cart')
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiAuth()
  @ApiOperation({
    summary: 'Get the caller\u2019s cart',
    description:
      'Creates an empty cart on first access. A cart may hold products ' +
      'from any number of sellers \u2014 the split into per-seller orders ' +
      'happens at checkout, not here.',
  })
  getCart(@CurrentUser() user: AuthenticatedUser) {
    return this.cartService.getOrCreateForBuyer(user.id);
  }

  @Post('items')
  @ApiAuth()
  @ApiOperation({
    summary: 'Add an item to the cart',
    description:
      'Increments the line if the product is already present. Validates ' +
      'that the product exists and is ACTIVE, but deliberately NOT that ' +
      'stock is sufficient \u2014 that is only answerable at checkout, inside ' +
      'its transaction, since everyone else is shopping concurrently.',
  })
  @ApiResponse({
    status: 400,
    description: 'Product is archived, or is auction-only \u2014 bid instead.',
  })
  @ApiResponse({
    status: 403,
    description: 'You cannot add your own product to your cart.',
  })
  addItem(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddCartItemDto) {
    return this.cartService.addItem(user.id, dto);
  }

  @Patch('items/:productId')
  @ApiAuth()
  @ApiOperation({
    summary: 'Set a line to an explicit quantity',
    description: 'Sets, rather than increments \u2014 unlike POST /cart/items.',
  })
  updateItemQuantity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId') productId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItemQuantity(user.id, productId, dto);
  }

  @Delete('items/:productId')
  @ApiAuth()
  @ApiOperation({ summary: 'Remove a line from the cart' })
  removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId') productId: string,
  ) {
    return this.cartService.removeItem(user.id, productId);
  }
}
