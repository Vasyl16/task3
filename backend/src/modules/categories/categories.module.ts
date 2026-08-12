import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { CategoriesRepository } from './domain/categories.repository';
import { PrismaCategoriesRepository } from './infrastructure/prisma-categories.repository';

@Module({
  controllers: [CategoriesController],
  providers: [
    CategoriesService,
    { provide: CategoriesRepository, useClass: PrismaCategoriesRepository },
  ],
  exports: [CategoriesService],
})
export class CategoriesModule {}
