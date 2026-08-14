import { useCategories } from '../../../entities/category';
import type {
  ProductType,
  SearchQuery,
  SearchSortBy,
} from '../../../entities/product';
import { Checkbox, Select, TextField } from '../../../shared/ui';
import { SearchTextField } from './search-text-field';

import './search-filters-bar.css';

const SORT_OPTIONS: { value: SearchSortBy; label: string }[] = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'newest', label: 'Newest' },
  { value: 'price', label: 'Price' },
  { value: 'rating', label: 'Seller rating' },
];

export function SearchFiltersBar({
  query,
  onChange,
}: {
  query: SearchQuery;
  onChange: (patch: Partial<SearchQuery>) => void;
}) {
  const { data: categories } = useCategories();

  return (
    <div className="search-filters">
      <SearchTextField
        value={query.q ?? ''}
        onDebouncedChange={(q) => onChange({ q })}
      />

      <Select
        label="Category"
        value={query.categoryId ?? ''}
        onChange={(event) =>
          onChange({ categoryId: event.target.value || undefined })
        }
      >
        <option value="">All categories</option>
        {categories?.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </Select>

      <Select
        label="Listing type"
        value={query.type ?? ''}
        onChange={(event) =>
          onChange({
            type: (event.target.value || undefined) as ProductType | undefined,
          })
        }
      >
        <option value="">Fixed price &amp; auction</option>
        <option value="FIXED_PRICE">Fixed price</option>
        <option value="AUCTION">Auction</option>
      </Select>

      <TextField
        label="Min price"
        type="number"
        min={0}
        step="0.01"
        value={query.minPrice ?? ''}
        onChange={(event) =>
          onChange({
            minPrice: event.target.value
              ? Number(event.target.value)
              : undefined,
          })
        }
      />
      <TextField
        label="Max price"
        type="number"
        min={0}
        step="0.01"
        value={query.maxPrice ?? ''}
        onChange={(event) =>
          onChange({
            maxPrice: event.target.value
              ? Number(event.target.value)
              : undefined,
          })
        }
      />

      <Select
        label="Minimum rating"
        value={query.minRating ?? ''}
        onChange={(event) =>
          onChange({
            minRating: event.target.value
              ? Number(event.target.value)
              : undefined,
          })
        }
      >
        <option value="">Any rating</option>
        {[4, 3, 2, 1].map((rating) => (
          <option key={rating} value={rating}>
            {rating}+ stars
          </option>
        ))}
      </Select>

      <Select
        label="Sort by"
        value={query.sortBy ?? 'relevance'}
        onChange={(event) =>
          onChange({ sortBy: event.target.value as SearchSortBy })
        }
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <div className="search-filters__checkbox">
        <Checkbox
          label="In stock only"
          checked={query.inStockOnly ?? false}
          onChange={(event) =>
            onChange({ inStockOnly: event.target.checked || undefined })
          }
        />
      </div>
    </div>
  );
}
