import { IsOptional, IsString, MinLength } from 'class-validator';

// No userId field — the applicant is always the authenticated caller
// (see SellersController.apply / @CurrentUser()), never a client-supplied
// value.
export class ApplySellerDto {
  @IsString()
  @MinLength(1)
  businessName!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
