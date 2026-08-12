import { Injectable } from '@nestjs/common';
import type { Category } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CategoriesRepository } from '../domain/categories.repository';

@Injectable()
export class PrismaCategoriesRepository implements CategoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<Category[]> {
    return this.prisma.category.findMany({ orderBy: { name: 'asc' } });
  }

  findById(id: string): Promise<Category | null> {
    return this.prisma.category.findUnique({ where: { id } });
  }

  create(data: {
    name: string;
    slug: string;
    parentId?: string;
  }): Promise<Category> {
    return this.prisma.category.create({ data });
  }

  update(
    id: string,
    data: Partial<{ name: string; slug: string; parentId: string | null }>,
  ): Promise<Category> {
    return this.prisma.category.update({ where: { id }, data });
  }
}
