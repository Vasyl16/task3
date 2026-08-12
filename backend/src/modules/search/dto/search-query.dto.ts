import { IsOptional, IsString } from 'class-validator';

export class SearchQueryDto {
  @IsString()
  q!: string;

  @IsOptional()
  @IsString()
  categoryId?: string;
}
