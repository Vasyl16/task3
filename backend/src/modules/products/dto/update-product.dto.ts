import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  basePrice?: number;

  // Sets Inventory.quantityAvailable to this absolute value (not a
  // relative adjustment) — see ProductsService.update and
  // ProductsRepository.setStock for the optimistic-locking guard.
  @IsOptional()
  @IsInt()
  @Min(0)
  quantityAvailable?: number;
}
