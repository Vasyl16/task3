import type { Category } from '@prisma/client';

export abstract class CategoriesRepository {
  abstract findAll(): Promise<Category[]>;
  abstract findById(id: string): Promise<Category | null>;
  abstract create(data: {
    name: string;
    slug: string;
    parentId?: string;
  }): Promise<Category>;
  abstract update(
    id: string,
    data: Partial<{ name: string; slug: string; parentId: string | null }>,
  ): Promise<Category>;
}
