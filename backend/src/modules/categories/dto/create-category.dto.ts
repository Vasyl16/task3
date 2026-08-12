import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  slug!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}
