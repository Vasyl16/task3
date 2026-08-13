import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { MeilisearchService } from '../../infrastructure/meilisearch/meilisearch.service';
import {
  SearchQueryDto,
  SearchSortBy,
  SearchSortOrder,
} from './dto/search-query.dto';
import type { SearchResult } from './domain/search-result.interface';
import type { ProductSearchDocument } from './domain/product-search-document.interface';

// Deliberately has NO dependency on ProductsModule (or any other business
// module): the search index is synced asynchronously from Postgres via
// OutboxEvent -> BullMQ -> SearchSyncConsumer -> Meilisearch, never by a
// direct call from Products. That decoupling is the entire point of the
// outbox pattern — see ../../../CLAUDE.md ("Meilisearch is a read/search
// model only").
//
// Eventual consistency: a product created/updated/archived in Postgres
// becomes visible here only after its outbox event has been published
// and processed — typically low-single-digit seconds, bounded by the
// Outbox Publisher's poll interval plus queue processing time, but with
// no hard upper bound if Meilisearch is degraded (the event just keeps
// retrying).
//
// Catalog browsing/search vs. product detail — deliberately different
// data sources:
//   - Listing/searching/filtering (this service) reads Meilisearch. It's
//     fine here: the cost of a few seconds of staleness on a search
//     results page is low, and Meilisearch is what makes full-text +
//     faceted + sorted queries fast.
//   - A single product's detail page is `GET /products/:id`
//     (ProductsController -> ProductsService, unrelated to this module)
//     — that reads PostgreSQL directly, because by the time a shopper is
//     looking at one specific product, business-critical fields (current
//     price, in-stock-ness) matter and staleness is no longer an
//     acceptable tradeoff.
//   - Checkout (OrdersService) re-reads PostgreSQL again, independently,
//     inside its own transaction — it never trusts even the product
//     detail read that preceded it, let alone anything from here.
// Never add a code path where correctness depends on reading from
// Meilisearch — see backend.md.
@Injectable()
export class SearchService {
  constructor(private readonly meilisearch: MeilisearchService) {}

  async search(query: SearchQueryDto): Promise<SearchResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    try {
      const index = await this.meilisearch.productsIndex();
      const result = await index.search<ProductSearchDocument>(query.q ?? '', {
        filter: this.buildFilter(query),
        sort: this.buildSort(query),
        offset: (page - 1) * limit,
        limit,
        facets: ['categoryId', 'sellerId', 'type'],
      });

      return {
        items: result.hits.map((hit) => ({
          productId: hit.id,
          name: hit.name,
          description: hit.description,
          basePrice: hit.basePrice,
          categoryId: hit.categoryId,
          categoryName: hit.categoryName,
          sellerId: hit.sellerId,
          sellerName: hit.sellerName,
          sellerRating: hit.sellerRating,
          inStock: hit.inStock,
        })),
        total: result.estimatedTotalHits ?? result.hits.length,
        page,
        limit,
        facets: result.facetDistribution,
      };
    } catch (err) {
      // Read-path failure — Meilisearch being temporarily down must not
      // look like a 500; it's a known, named condition ("search is
      // unavailable right now"), distinct from the write-path retry
      // handled by BullMQ for indexing.
      throw new ServiceUnavailableException(
        `Search is temporarily unavailable: ${(err as Error).message}`,
      );
    }
  }

  private buildFilter(query: SearchQueryDto): string[] {
    const clauses: string[] = [];
    if (query.categoryId) clauses.push(`categoryId = "${query.categoryId}"`);
    if (query.sellerId) clauses.push(`sellerId = "${query.sellerId}"`);
    if (query.minPrice !== undefined)
      clauses.push(`basePrice >= ${query.minPrice}`);
    if (query.maxPrice !== undefined)
      clauses.push(`basePrice <= ${query.maxPrice}`);
    if (query.minRating !== undefined)
      clauses.push(`sellerRating >= ${query.minRating}`);
    if (query.inStockOnly) clauses.push('inStock = true');
    return clauses;
  }

  // Maps the public sortBy vocabulary to the underlying (denormalized)
  // Meilisearch document attribute — see MeilisearchService's
  // sortableAttributes for what's actually indexed sortable.
  // Undefined/RELEVANCE means "let Meilisearch's own relevance ranking
  // decide", same as passing no sort at all.
  private buildSort(query: SearchQueryDto): string[] | undefined {
    if (!query.sortBy || query.sortBy === SearchSortBy.RELEVANCE) {
      return undefined;
    }
    const attribute: Record<
      Exclude<SearchSortBy, SearchSortBy.RELEVANCE>,
      string
    > = {
      [SearchSortBy.PRICE]: 'basePrice',
      [SearchSortBy.NEWEST]: 'createdAt',
      [SearchSortBy.RATING]: 'sellerRating',
    };
    const defaultOrder: Record<
      Exclude<SearchSortBy, SearchSortBy.RELEVANCE>,
      SearchSortOrder
    > = {
      [SearchSortBy.PRICE]: SearchSortOrder.ASC,
      [SearchSortBy.NEWEST]: SearchSortOrder.DESC,
      [SearchSortBy.RATING]: SearchSortOrder.DESC,
    };
    const key = query.sortBy;
    const order = query.sortOrder ?? defaultOrder[key];
    return [`${attribute[key]}:${order}`];
  }
}
