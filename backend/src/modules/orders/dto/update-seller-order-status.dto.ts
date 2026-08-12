import { IsEnum } from 'class-validator';
import { SellerOrderStatus } from '@prisma/client';

export class UpdateSellerOrderStatusDto {
  @IsEnum(SellerOrderStatus)
  status!: SellerOrderStatus;
}
