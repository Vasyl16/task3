import { IsEnum } from 'class-validator';
import { SellerProfileStatus } from '@prisma/client';

// No reviewedByUserId field — the reviewer is always the authenticated
// ADMIN caller (see SellersController.review / @CurrentUser()), never a
// client-supplied value.
export class ReviewSellerDto {
  @IsEnum(SellerProfileStatus)
  status!: SellerProfileStatus;
}
