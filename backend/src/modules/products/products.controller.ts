import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ProductStatus, UserRole } from '@prisma/client';
import { ApiAuth } from '../../core/openapi/api-auth.decorator';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import { Public } from '../../core/auth/decorators/public.decorator';
import { Roles } from '../../core/auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { productImageMulterOptions } from './infrastructure/product-image.multer-config';
import { ListCatalogQuery } from './dto/list-catalog.query';
import { ListOwnProductsQuery } from './dto/list-own-products.query';
import { PRODUCT_SORTS, ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

// Ownership (SELLER may only act on their own product; ADMIN is an
// explicit override) is enforced inside the service, not just by role.
@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // Both @Public(), so both return the catalog projection — never the
  // moderation audit trail (see ProductsService.findAllForCatalog).
  @Public()
  @Get()
  @ApiOperation({
    summary: 'Browse the catalogue (public)',
    description:
      'Reads PostgreSQL directly, so prices and stock are current. ' +
      'Archived products never appear. For full-text and faceted queries ' +
      'use GET /search, which reads the Meilisearch index instead.',
  })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'sellerId', required: false })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: PRODUCT_SORTS,
    description:
      "'rating' orders by average review score, ties broken by review " +
      "count then recency. Defaults to 'newest'.",
  })
  findAll(@Query() query: ListCatalogQuery) {
    return this.productsService.findAllForCatalog(query);
  }

  // Registered before ':id' so "mine" is not matched as a product id.
  @Roles(UserRole.SELLER)
  @Get('mine')
  @ApiAuth(UserRole.SELLER)
  @ApiOperation({
    summary: 'Your own products, INCLUDING archived ones',
    description:
      'The public catalogue hides archived products, which left a seller ' +
      'unable to find one they had taken down. This lists the caller’s ' +
      'own listings in every state so they can be restored. Scoped to ' +
      'your own approved seller profile — there is no sellerId parameter.',
  })
  @ApiQuery({ name: 'status', required: false, enum: ProductStatus })
  listOwn(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOwnProductsQuery,
  ) {
    return this.productsService.listOwnProducts(user.id, query);
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Get one product (public)',
    description:
      'Authoritative read from PostgreSQL. The moderation audit trail ' +
      '(who took a listing down and why) is deliberately excluded from ' +
      'this projection.',
  })
  @ApiResponse({ status: 404, description: 'No such product.' })
  findById(@Param('id') id: string) {
    return this.productsService.findByIdForCatalog(id);
  }

  @Roles(UserRole.SELLER)
  @Post()
  @ApiAuth(UserRole.SELLER)
  @ApiOperation({
    summary: 'Create a product',
    description:
      'The owning seller is derived from the caller’s own approved ' +
      'SellerProfile — CreateProductDto has no sellerId field, and sending ' +
      'one is rejected outright. Creates the Inventory row in the same ' +
      'transaction.',
  })
  @ApiResponse({
    status: 403,
    description: 'The caller has no APPROVED seller profile.',
  })
  @ApiResponse({
    status: 409,
    description:
      'The slug is already taken. Slugs are globally unique because they ' +
      'are the public URL, so it can collide with a product you cannot see.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProductDto,
  ) {
    return this.productsService.create(user.id, dto);
  }

  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @Patch(':id')
  @ApiAuth(UserRole.SELLER, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Update a product (owning seller, or ADMIN)',
    description:
      'quantityAvailable sets stock to an ABSOLUTE value, not a delta, and ' +
      'is guarded by an optimistic-locking version check — a concurrent ' +
      'change returns 409 rather than silently losing one of the edits.',
  })
  @ApiResponse({ status: 403, description: 'You do not own this product.' })
  @ApiResponse({
    status: 409,
    description: 'Stock changed concurrently — re-read and retry.',
  })
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(id, user, dto);
  }

  // Soft delete (archive) only — see ProductsService.archive. Not a
  // physical DELETE: existing carts/orders may still reference this
  // product.
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Delete(':id')
  @ApiAuth(UserRole.SELLER, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Archive a product (soft delete)',
    description:
      'Sets status to ARCHIVED and drops it from search. Never a physical ' +
      'delete: existing carts, order history and auctions still reference ' +
      'it. An archived product is rejected at checkout.',
  })
  @ApiOkResponse({ description: 'Archived.' })
  @ApiResponse({ status: 403, description: 'You do not own this product.' })
  archive(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.productsService.archive(id, user);
  }

  // Ownership is checked inside ProductsService.updateImage — the same
  // "SELLER on their own product, or ADMIN" rule as update()/archive().
  // multipart/form-data, field name "image"; validated by
  // productImageMulterOptions (type + 5MB size) before this handler ever
  // runs.
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @Post(':id/restore')
  @ApiAuth(UserRole.SELLER, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Put an archived listing back on sale',
    description:
      'The inverse of archiving. Re-indexes the product for search, ' +
      'which dropped it when it was archived. A listing removed by a ' +
      'MODERATOR cannot be restored this way — that stays an admin ' +
      'decision, or takedowns would mean nothing.',
  })
  @ApiResponse({ status: 403, description: 'Not yours, or an admin takedown.' })
  @ApiResponse({ status: 409, description: 'The product is not archived.' })
  restore(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.productsService.restore(id, user);
  }

  @Roles(UserRole.SELLER, UserRole.ADMIN)
  @Post(':id/image')
  @ApiAuth(UserRole.SELLER, UserRole.ADMIN)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { image: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Upload a product image',
    description:
      'JPEG, PNG or WebP, max 5 MB. Stored under a generated random ' +
      'filename — the client-supplied name is never used — and served back ' +
      'at /uploads/products/<uuid>.<ext>.',
  })
  @ApiResponse({
    status: 400,
    description: 'No file, or not an accepted image type.',
  })
  @ApiResponse({ status: 403, description: 'You do not own this product.' })
  @UseInterceptors(FileInterceptor('image', productImageMulterOptions))
  async uploadImage(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No image file was provided');
    }
    return this.productsService.updateImage(
      id,
      user,
      `/uploads/products/${file.filename}`,
    );
  }
}
