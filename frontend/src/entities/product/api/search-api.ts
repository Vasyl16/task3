import { api } from '../../../shared/api';
import type { QueryParams } from '../../../shared/api';
import type { SearchQuery, SearchResult } from '../model/search';

export const searchApi = {
  search: (query: SearchQuery) =>
    api.get<SearchResult>('/search', { params: query as QueryParams }),
};

export const searchKeys = {
  all: ['search'] as const,
  results: (query: SearchQuery) => [...searchKeys.all, query] as const,
};
