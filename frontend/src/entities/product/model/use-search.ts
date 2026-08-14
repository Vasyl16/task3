import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { searchApi, searchKeys } from '../api/search-api';
import type { SearchQuery } from './search';

export function useSearch(query: SearchQuery) {
  return useQuery({
    queryKey: searchKeys.results(query),
    queryFn: () => searchApi.search(query),
    // Meilisearch is a read model, not the source of truth for a single
    // product — but for a paginated results LIST, keeping the previous
    // page's data visible while the next page loads (rather than
    // flashing a spinner) is worth the minor staleness.
    placeholderData: keepPreviousData,
  });
}
