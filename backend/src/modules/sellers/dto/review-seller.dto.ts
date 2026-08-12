import { IsEnum, IsUUID } from 'class-validator';
import { SellerProfileStatus } from '@prisma/client';

export class ReviewSellerDto {
  @IsEnum(SellerProfileStatus)
  status!: SellerProfileStatus;

  // TODO(auth): once guards exist, take this from req.user.id (ADMIN
  // role) instead of trusting the request body.
  @IsUUID()
  reviewedByUserId!: string;
}
