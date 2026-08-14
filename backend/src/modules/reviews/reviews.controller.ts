import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import { Public } from '../../core/auth/decorators/public.decorator';
import { ApiAuth } from '../../core/openapi/api-auth.decorator';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';

@ApiTags('reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post('reviews')
  @ApiAuth()
  @ApiOperation({
    summary: 'Review a product you bought',
    description:
      'Only the buyer of a COMPLETED order may review, and only once per ' +
      'purchased line item. The author is the authenticated caller — never ' +
      'a body field. Buying the same product twice earns two reviews, one ' +
      'per purchase.',
  })
  @ApiCreatedResponse({ description: 'Review recorded.' })
  @ApiResponse({
    status: 403,
    description: 'The order has not been completed yet.',
  })
  @ApiResponse({
    status: 404,
    description: 'No such line item, or it belongs to someone else.',
  })
  @ApiResponse({
    status: 409,
    description: 'This purchase has already been reviewed.',
  })
  create(
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviewsService.create(caller, dto);
  }

  @Public()
  @Get('products/:id/reviews')
  @ApiOperation({
    summary: 'Reviews for a product',
    description:
      'Public: ratings are only useful if a shopper can read them before ' +
      'buying. Every row here is a verified purchase by construction.',
  })
  @ApiOkResponse({ description: 'Reviews, newest first.' })
  listForProduct(@Param('id') productId: string) {
    return this.reviewsService.listForProduct(productId);
  }

  @Public()
  @Get('products/:id/rating')
  @ApiOperation({
    summary: "A product's current rating",
    description:
      'Average and count, aggregated live from the review rows. A product ' +
      'with no reviews returns average 0 and count 0 rather than 404.',
  })
  @ApiOkResponse({ description: 'Rating summary.' })
  getRating(@Param('id') productId: string) {
    return this.reviewsService.getRatingFor(productId);
  }

  @Get('reviews/pending')
  @ApiAuth()
  @ApiOperation({
    summary: 'Purchases you can still review',
    description:
      'Completed line items you have not reviewed yet. Exists because a ' +
      'client cannot derive this: the orders endpoints do not return line ' +
      'items, and whether a review already exists is not visible from an ' +
      'order at all.',
  })
  @ApiOkResponse({ description: 'Reviewable purchases, newest first.' })
  listReviewable(@CurrentUser() caller: AuthenticatedUser) {
    return this.reviewsService.listReviewablePurchases(caller);
  }

  @Get('reviews/mine')
  @ApiAuth()
  @ApiOperation({ summary: 'Reviews you have written' })
  @ApiOkResponse({ description: 'Your reviews, newest first.' })
  listOwn(@CurrentUser() caller: AuthenticatedUser) {
    return this.reviewsService.listOwn(caller);
  }
}
