import { Injectable, NotFoundException } from '@nestjs/common';
import type { Category } from '@prisma/client';
import { CategoriesRepository } from './domain/categories.repository';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly categoriesRepository: CategoriesRepository) {}

  findAll(): Promise<Category[]> {
    return this.categoriesRepository.findAll();
  }

  async findById(id: string): Promise<Category> {
    const category = await this.categoriesRepository.findById(id);
    if (!category) {
      throw new NotFoundException(`Category ${id} not found`);
    }
    return category;
  }

  create(dto: CreateCategoryDto): Promise<Category> {
    return this.categoriesRepository.create(dto);
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<Category> {
    await this.findById(id); // 404s if missing
    return this.categoriesRepository.update(id, dto);
  }
}
