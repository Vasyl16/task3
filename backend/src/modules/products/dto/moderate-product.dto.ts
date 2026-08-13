import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

// Moderation is reactive, not a pre-publication gate: an admin takes a
// live listing down, or puts a previously removed one back. See the
// Product model in schema.prisma for why there is no PENDING_REVIEW state.
export enum ProductModerationAction {
  TAKE_DOWN = 'TAKE_DOWN',
  REINSTATE = 'REINSTATE',
}

export class ModerateProductDto {
  @IsEnum(ProductModerationAction)
  action!: ProductModerationAction;

  // Required in both directions — "why was this removed" and "why was
  // this restored" are equally part of the audit trail.
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note!: string;
}
