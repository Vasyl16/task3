import { IsInt, Min } from 'class-validator';

// Sets the line's quantity to an explicit value (distinct from
// AddCartItemDto, which increments) — see CartService.updateItemQuantity.
export class UpdateCartItemDto {
  @IsInt()
  @Min(1)
  quantity!: number;
}
