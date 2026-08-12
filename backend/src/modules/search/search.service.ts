import { Injectable, NotImplementedException } from '@nestjs/common';
import type { SearchQueryDto } from './dto/search-query.dto';
import type { SearchResult } from './domain/search-result.interface';

// Deliberately has NO dependency on ProductsModule (or any other module):
// the search index is synced asynchronously from Postgres via
// OutboxEvent -> BullMQ -> Meilisearch, never by a direct call from
// Products. That decoupling is the entire point of the outbox pattern —
// see ../../../CLAUDE.md ("Meilisearch is a read/search model only").
// The Meilisearch client isn't wired up yet, so this is a stub.
@Injectable()
export class SearchService {
  search(_query: SearchQueryDto): Promise<SearchResult[]> {
    throw new NotImplementedException('SearchService.search');
  }
}
