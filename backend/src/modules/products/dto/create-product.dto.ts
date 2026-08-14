import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';
import { ProductType } from '@prisma/client';

// No sellerId field — the owning seller is always derived from the
// authenticated caller's own (approved) SellerProfile, never a
// client-supplied value. See ProductsController.create.
export class CreateProductDto {
  @IsUUID()
  categoryId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  slug!: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Alternative to the separate POST /products/:id/image upload route —
  // a seller can point at an image they already host elsewhere instead
  // of uploading a file. Whichever the client used, this is the only
  // field that ever reaches Product.imageUrl at creation time; the
  // upload route (see products.controller.ts) is the only other writer,
  // and either one simply overwrites whatever was there before.
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  // > 0, not >= 0 — a marketplace listing at $0 isn't meaningful for a
  // fixed-price product (an AUCTION's startingPrice may legitimately be 0).
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  basePrice!: number;

  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @IsInt()
  @Min(0)
  initialQuantity!: number;
}
