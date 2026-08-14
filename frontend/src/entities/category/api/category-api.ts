import { api } from '../../../shared/api';
import type { Category } from '../model/category';

export const categoryApi = {
  list: () => api.get<Category[]>('/categories'),
};

export const categoryKeys = {
  all: ['categories'] as const,
  list: () => [...categoryKeys.all, 'list'] as const,
};
