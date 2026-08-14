import { ServiceUnavailableException } from '@nestjs/common';
import { ProductType } from '@prisma/client';
import type { MeilisearchService } from '../../infrastructure/meilisearch/meilisearch.service';
import {
  SearchQueryDto,
  SearchSortBy,
  SearchSortOrder,
} from './dto/search-query.dto';
import { SearchService } from './search.service';

const EMPTY_RESULT = {
  hits: [],
  estimatedTotalHits: 0,
  facetDistribution: undefined,
};

describe('SearchService', () => {
  let searchService: SearchService;
  let search: jest.Mock;

  beforeEach(() => {
    search = jest.fn().mockResolvedValue(EMPTY_RESULT);
    const meilisearch = {
      productsIndex: () => Promise.resolve({ search }),
    } as unknown as MeilisearchService;
    searchService = new SearchService(meilisearch);
  });

  function query(overrides: Partial<SearchQueryDto> = {}): SearchQueryDto {
    return Object.assign(new SearchQueryDto(), {
      page: 1,
      limit: 20,
      ...overrides,
    });
  }

  it('passes the full-text query through to Meilisearch', async () => {
    await searchService.search(query({ q: 'wireless mouse' }));

    expect(search).toHaveBeenCalledWith(
      'wireless mouse',
      expect.objectContaining({ limit: 20, offset: 0 }),
    );
  });

  it('defaults to an empty query string (browse-all) when q is omitted', async () => {
    await searchService.search(query());

    expect(search).toHaveBeenCalledWith('', expect.anything());
  });

  describe('filters', () => {
    it('builds a categoryId filter clause', async () => {
      await searchService.search(
        query({ categoryId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' }),
      );
      const [, opts] = search.mock.calls[0];
      expect(opts.filter).toContain(
        'categoryId = "f47ac10b-58cc-4372-a567-0e02b2c3d479"',
      );
    });

    it('builds a sellerId filter clause', async () => {
      await searchService.search(
        query({ sellerId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' }),
      );
      const [, opts] = search.mock.calls[0];
      expect(opts.filter).toContain(
        'sellerId = "f47ac10b-58cc-4372-a567-0e02b2c3d479"',
      );
    });

    it('builds price range filter clauses', async () => {
      await searchService.search(query({ minPrice: 10, maxPrice: 50 }));
      const [, opts] = search.mock.calls[0];
      expect(opts.filter).toEqual(
        expect.arrayContaining(['basePrice >= 10', 'basePrice <= 50']),
      );
    });

    it('builds a type filter clause', async () => {
      await searchService.search(query({ type: ProductType.AUCTION }));
      const [, opts] = search.mock.calls[0];
      expect(opts.filter).toContain('type = "AUCTION"');
    });

    it('builds a minRating filter clause', async () => {
      await searchService.search(query({ minRating: 4 }));
      const [, opts] = search.mock.calls[0];
      expect(opts.filter).toContain('sellerRating >= 4');
    });

    it('builds an inStock filter clause only when inStockOnly is true', async () => {
      await searchService.search(query({ inStockOnly: true }));
      expect(search.mock.calls[0][1].filter).toContain('inStock = true');

      await searchService.search(query({ inStockOnly: false }));
      expect(search.mock.calls[1][1].filter).not.toContain('inStock = true');
    });

    it('applies no filters when none are given', async () => {
      await searchService.search(query());
      expect(search.mock.calls[0][1].filter).toEqual([]);
    });

    it('requests category/seller/type facets on every search', async () => {
      await searchService.search(query());
      expect(search.mock.calls[0][1].facets).toEqual([
        'categoryId',
        'sellerId',
        'type',
      ]);
    });
  });

  describe('pagination', () => {
    it('computes offset from page and limit', async () => {
      await searchService.search(query({ page: 3, limit: 10 }));
      const [, opts] = search.mock.calls[0];
      expect(opts.offset).toBe(20);
      expect(opts.limit).toBe(10);
    });

    it('defaults to page 1 / limit 20 when omitted', async () => {
      await searchService.search(Object.assign(new SearchQueryDto(), {}));
      const [, opts] = search.mock.calls[0];
      expect(opts.offset).toBe(0);
      expect(opts.limit).toBe(20);
    });

    it('returns page/limit/total alongside the mapped items', async () => {
      search.mockResolvedValue({
        hits: [
          {
            id: 'p1',
            name: 'Widget',
            description: null,
            basePrice: 9.99,
            categoryId: 'c1',
            categoryName: 'Gadgets',
            sellerId: 's1',
            sellerName: 'Acme',
            sellerRating: 4.2,
            type: 'FIXED_PRICE',
            inStock: true,
            hasActiveAuction: false,
          },
        ],
        estimatedTotalHits: 42,
        facetDistribution: { categoryId: { c1: 1 } },
      });

      const result = await searchService.search(query({ page: 2, limit: 10 }));

      expect(result).toEqual({
        items: [
          {
            productId: 'p1',
            name: 'Widget',
            description: null,
            basePrice: 9.99,
            categoryId: 'c1',
            categoryName: 'Gadgets',
            sellerId: 's1',
            sellerName: 'Acme',
            sellerRating: 4.2,
            type: 'FIXED_PRICE',
            inStock: true,
            hasActiveAuction: false,
          },
        ],
        total: 42,
        page: 2,
        limit: 10,
        facets: { categoryId: { c1: 1 } },
      });
    });

    // A document indexed before hasActiveAuction existed (not yet
    // re-synced by any subsequent product/auction event) has it
    // genuinely absent — never surface `undefined` on a boolean field.
    it('defaults hasActiveAuction to false for a not-yet-resynced document', async () => {
      search.mockResolvedValue({
        hits: [
          {
            id: 'p1',
            name: 'Widget',
            description: null,
            basePrice: 9.99,
            categoryId: 'c1',
            categoryName: 'Gadgets',
            sellerId: 's1',
            sellerName: 'Acme',
            sellerRating: 4.2,
            type: 'AUCTION',
            inStock: true,
            // hasActiveAuction deliberately omitted
          },
        ],
        estimatedTotalHits: 1,
        facetDistribution: {},
      });

      const result = await searchService.search(query());

      expect(result.items[0]?.hasActiveAuction).toBe(false);
    });
  });

  describe('sorting', () => {
    it('omits sort when sortBy is unset (Meilisearch relevance ranking)', async () => {
      await searchService.search(query());
      expect(search.mock.calls[0][1].sort).toBeUndefined();
    });

    it('omits sort when sortBy is RELEVANCE', async () => {
      await searchService.search(query({ sortBy: SearchSortBy.RELEVANCE }));
      expect(search.mock.calls[0][1].sort).toBeUndefined();
    });

    it('defaults price sort to ascending (cheapest first)', async () => {
      await searchService.search(query({ sortBy: SearchSortBy.PRICE }));
      expect(search.mock.calls[0][1].sort).toEqual(['basePrice:asc']);
    });

    it('defaults newest sort to descending', async () => {
      await searchService.search(query({ sortBy: SearchSortBy.NEWEST }));
      expect(search.mock.calls[0][1].sort).toEqual(['createdAt:desc']);
    });

    it('defaults rating sort to descending', async () => {
      await searchService.search(query({ sortBy: SearchSortBy.RATING }));
      expect(search.mock.calls[0][1].sort).toEqual(['sellerRating:desc']);
    });

    it('honors an explicit sortOrder override', async () => {
      await searchService.search(
        query({ sortBy: SearchSortBy.PRICE, sortOrder: SearchSortOrder.DESC }),
      );
      expect(search.mock.calls[0][1].sort).toEqual(['basePrice:desc']);
    });
  });

  it('wraps a Meilisearch failure as ServiceUnavailableException, not a raw 500', async () => {
    search.mockRejectedValue(new Error('connection refused'));

    await expect(searchService.search(query())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
