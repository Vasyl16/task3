import { SellerProfileStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class ListSellerApplicationsQuery {
  // Omit for every application; PENDING is the queue awaiting review.
  @IsOptional()
  @IsEnum(SellerProfileStatus)
  status?: SellerProfileStatus;
}
