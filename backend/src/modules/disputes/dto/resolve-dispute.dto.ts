import { DisputeStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class ResolveDisputeDto {
  @IsEnum(DisputeStatus)
  status!: DisputeStatus;

  // Required for RESOLVED/REJECTED, optional for UNDER_REVIEW — enforced
  // in DisputesService, since the rule depends on `status` and
  // class-validator can't express "required only when" cleanly.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolution?: string;
}
