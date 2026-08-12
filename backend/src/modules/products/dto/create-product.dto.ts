import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
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
