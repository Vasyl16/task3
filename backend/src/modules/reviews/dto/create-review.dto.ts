import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateReviewDto {
  // The purchased line item being reviewed. This — not a productId — is
  // what the client sends, because it is the thing that proves the
  // purchase. Accepting a bare productId would mean trusting the client
  // to tell us what it bought.
  @IsUUID()
  orderItemId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  // Optional: a star rating alone is a valid review. When present it must
  // say something, hence the minimum length.
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  comment?: string;
}
