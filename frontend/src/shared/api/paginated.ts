// Mirrors the backend's Paginated<T> — every list endpoint returns this
// shape, so one pager component works everywhere.
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
