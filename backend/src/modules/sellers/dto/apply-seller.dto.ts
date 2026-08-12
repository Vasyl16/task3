import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class ApplySellerDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @MinLength(1)
  businessName!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
