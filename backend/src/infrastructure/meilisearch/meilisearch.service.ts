import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Meilisearch as MeilisearchClient, Index } from 'meilisearch';
import type { AppConfig } from '../../config/configuration';

export const PRODUCTS_INDEX = 'products';

// Thin wrapper around the Meilisearch client — the only place in the app
// that imports the `meilisearch` package. Postgres remains the source of
// truth (see backend.md); this is a read/search model only, and nothing
// here is ever called synchronously from a business write path — see
// SearchSyncConsumer for the async write side.
//
// The client is created lazily via a dynamic import(), not a static one:
// `meilisearch` ships ESM-only (`"type": "module"`), while this backend
// package is CommonJS (tsconfig `module: nodenext` resolves per-file
// against package.json, and this package has no `"type": "module"`) — a
// static `require()` of an ESM-only package fails at both build and test
// time. A dynamic `import()` is Node's supported interop path for
// loading an ESM dependency from CommonJS code.
@Injectable()
export class MeilisearchService {
  private readonly logger = new Logger(MeilisearchService.name);
  private clientPromise?: Promise<MeilisearchClient>;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async productsIndex(): Promise<Index> {
    const client = await this.getClient();
    return client.index(PRODUCTS_INDEX);
  }

  private getClient(): Promise<MeilisearchClient> {
    if (!this.clientPromise) {
      this.clientPromise = this.createClient();
    }
    return this.clientPromise;
  }

  private async createClient(): Promise<MeilisearchClient> {
    const { Meilisearch } = await import('meilisearch');
    const client = new Meilisearch({
      host: this.config.get('meilisearch.host', { infer: true }),
      apiKey: this.config.get('meilisearch.masterKey', { infer: true }),
    });

    // Idempotent (updateSettings is a full replace, safe to repeat).
    // Failure here (Meilisearch unreachable) is logged, not fatal — the
    // rest of the app must keep working; search just stays degraded
    // until Meilisearch is reachable again.
    try {
      await client.index(PRODUCTS_INDEX).updateSettings({
        searchableAttributes: [
          'name',
          'description',
          'categoryName',
          'sellerName',
        ],
        filterableAttributes: [
          'categoryId',
          'sellerId',
          'basePrice',
          'productRating',
          'inStock',
          'type',
        ],
        sortableAttributes: ['basePrice', 'createdAt', 'productRating'],
      });
    } catch (err) {
      this.logger.warn(
        `Could not configure Meilisearch index settings (search will still work once it's reachable): ${(err as Error).message}`,
      );
    }

    return client;
  }
}
