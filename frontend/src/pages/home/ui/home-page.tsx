import { useSearchParams } from 'react-router-dom';
import { useSearch } from '../../../entities/product';
import type { ProductType, SearchQuery } from '../../../entities/product';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageSpinner,
} from '../../../shared/ui';
import { ProductCard } from '../../../widgets/product-card';
import { SearchFiltersBar } from '../../../widgets/search-filters';

const PAGE_SIZE = 20;

function readQuery(params: URLSearchParams): SearchQuery {
  return {
    q: params.get('q') ?? undefined,
    categoryId: params.get('categoryId') ?? undefined,
    sellerId: params.get('sellerId') ?? undefined,
    type: (params.get('type') as ProductType | null) ?? undefined,
    minPrice: params.get('minPrice')
      ? Number(params.get('minPrice'))
      : undefined,
    maxPrice: params.get('maxPrice')
      ? Number(params.get('maxPrice'))
      : undefined,
    minRating: params.get('minRating')
      ? Number(params.get('minRating'))
      : undefined,
    inStockOnly: params.get('inStockOnly') === 'true' || undefined,
    sortBy: (params.get('sortBy') as SearchQuery['sortBy']) ?? undefined,
    sortOrder:
      (params.get('sortOrder') as SearchQuery['sortOrder']) ?? undefined,
    page: params.get('page') ? Number(params.get('page')) : 1,
    limit: PAGE_SIZE,
  };
}

// Catalog + search landing — replaces the foundation-era placeholder
// (see the comment that used to live here). Filters live in the URL so
// a search is shareable and survives the back button, rather than in
// component state.
export function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = readQuery(searchParams);
  const { data, isPending, error, refetch } = useSearch(query);

  const updateQuery = (patch: Partial<SearchQuery>) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      // Any real filter change starts back at page 1 — staying on page 4
      // of a now-different result set would just show an empty page.
      if (!('page' in patch)) next.delete('page');
      return next;
    });
  };

  return (
    <div>
      <PageHeader
        title="Marketplace"
        subtitle="Browse listings from every seller on the platform."
      />

      <SearchFiltersBar query={query} onChange={updateQuery} />

      {isPending && <PageSpinner label="Searching" />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.items.length === 0 && (
        <EmptyState
          title="No products match those filters"
          description="Try widening your search or clearing a filter."
        />
      )}
      {data && data.items.length > 0 && (
        <>
          <div className="ui-grid">
            {data.items.map((item) => (
              <ProductCard key={item.productId} item={item} />
            ))}
          </div>
          <PaginationControls
            page={data.page}
            limit={data.limit}
            total={data.total}
            onPageChange={(page) => updateQuery({ page })}
          />
        </>
      )}
    </div>
  );
}

function PaginationControls({
  page,
  limit,
  total,
  onPageChange,
}: {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label="Search results pages"
      style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 'var(--space-3)',
        marginTop: 'var(--space-5)',
      }}
    >
      <button
        type="button"
        className="ui-button ui-button--secondary"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </button>
      <span style={{ alignSelf: 'center' }}>
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        className="ui-button ui-button--secondary"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
