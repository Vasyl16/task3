import { useQuery } from '@tanstack/react-query';
import { categoryApi, categoryKeys } from '../api/category-api';

// Categories change rarely — a longer staleTime than the client default
// avoids re-fetching the same short list on every filter-bar mount.
export function useCategories() {
  return useQuery({
    queryKey: categoryKeys.list(),
    queryFn: categoryApi.list,
    staleTime: 5 * 60_000,
  });
}
