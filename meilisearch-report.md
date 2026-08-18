# How Meilisearch works in this project

Meilisearch is the **product search read-model**. It is never the source
of truth — PostgreSQL is — and no business logic ever depends on it being
up to date or even reachable. Its only job: fast full-text + faceted +
sorted queries over products for the "browse/search" experience.

## 1. The pieces involved

```
Postgres (source of truth)
   │  same transaction
   ▼
OutboxEvent row  ──(OutboxPublisherService polls)──▶  BullMQ "search-sync" queue
                                                              │
                                                              ▼
                                                     SearchSyncConsumer
                                                              │  re-reads Postgres,
                                                              │  builds denormalized doc
                                                              ▼
                                                        Meilisearch "products" index
                                                              │
                                                              ▼
                                            SearchController → SearchService (GET /search)
                                                              │
                                                              ▼
                                                   Frontend: useSearch() / searchApi
```

Files:
- `backend/src/infrastructure/meilisearch/meilisearch.service.ts` — the only file that imports the `meilisearch` client package.
- `backend/src/modules/search/consumers/search-sync.consumer.ts` — the **write** side (indexes documents).
- `backend/src/modules/search/search.service.ts` + `search.controller.ts` — the **read** side (`GET /search`).
- `backend/src/infrastructure/outbox/*` — the relay that gets product events from Postgres to the queue.
- `frontend/src/entities/product/api/search-api.ts` + `model/use-search.ts` — frontend consumer.

## 2. Indexing (write path) — never called from a business request

Products are **never** written to Meilisearch synchronously. When a
seller creates/updates/archives a product, `ProductsService` does this
inside one Postgres transaction (see `products.service.ts:238-260`):

1. Write/update the `Product` (+ `Inventory`) row.
2. Record an `OutboxEvent` row (`PRODUCT_CREATED` / `PRODUCT_UPDATED` /
   `PRODUCT_ARCHIVED`) in the **same transaction**.

Both commit atomically, or neither does — there's no window where a
product exists in Postgres but the fact that it changed is lost.

Separately, `OutboxPublisherService` polls Postgres for `PENDING` outbox
rows, and — per `event-queue-map.ts` — routes all three product events to
the `SEARCH_SYNC` BullMQ queue. A row is only marked `PUBLISHED` once the
BullMQ enqueue actually succeeds; if Redis is briefly down the row just
retries with backoff.

`SearchSyncConsumer` (a BullMQ worker) picks the job up and:

- **`PRODUCT_ARCHIVED`** → `index.deleteDocument(productId)` — archived
  products must never be discoverable.
- **`PRODUCT_CREATED` / `PRODUCT_UPDATED`** → `syncProduct()`:
  1. Re-reads the product **fresh from Postgres** (never trusts the
     event payload beyond the id) along with its category, seller,
     inventory, average review rating, and whether it has an active
     auction.
  2. Builds a **denormalized** `ProductSearchDocument` (category name and
     seller name inlined, so a search query never needs a join).
  3. `index.addDocuments([doc], { primaryKey: 'id' })` — an **upsert**,
     safe to call repeatedly.

Idempotency is handled two ways: `EventIdempotencyService` dedupes by
`(eventId, 'search-sync')` so a redelivered BullMQ job is a no-op, and
even without that, `addDocuments`/`deleteDocument` are naturally
idempotent — replaying the same event twice leaves Meilisearch in the
same end state either way.

**Eventual consistency**: a product change becomes visible in search
typically within low single-digit seconds (outbox poll interval + queue
processing), with no hard upper bound if Meilisearch is temporarily
down — the event just keeps retrying rather than being dropped.

## 3. The index itself

`MeilisearchService` lazily creates one client (dynamic `import()`,
because the `meilisearch` package is ESM-only and this backend is
CommonJS) and configures a single index, `products`:

```ts
searchableAttributes: ['name', 'description', 'categoryName', 'sellerName']
filterableAttributes: ['categoryId', 'sellerId', 'basePrice', 'productRating', 'inStock', 'type']
sortableAttributes: ['basePrice', 'createdAt', 'productRating']
```

This settings call runs on first use and is idempotent (`updateSettings`
is a full replace). If Meilisearch isn't reachable yet, it just logs a
warning — the app still boots, search just stays degraded until
Meilisearch comes up (matching the `meilisearch` healthcheck dependency
in `docker-compose.yml`).

Locally, Meilisearch runs as its own container (`getmeili/meilisearch:v1.11`),
reachable at `MEILISEARCH_HOST` (`http://localhost:7700` outside Docker,
`http://meilisearch:7700` inside the compose network), secured with
`MEILI_MASTER_KEY`.

## 4. Querying (read path) — `GET /search`

`SearchController` is `@Public()` and delegates straight to
`SearchService.search()`, which is deliberately **not** wired to
`ProductsModule` at all — its only dependency is `MeilisearchService`.
That's the point of the outbox pattern: Search never reaches into
Products' internals; it only ever reads what was already synced.

`SearchQueryDto` validates the query string (`q`, `categoryId`,
`sellerId`, `type`, `minPrice`/`maxPrice`, `minRating`, `inStockOnly`,
`sortBy`/`sortOrder`, `page`/`limit`). `SearchService` then:

- Builds a Meilisearch **filter** array from the typed fields, e.g.
  `categoryId = "..."`, `basePrice >= 10`, `inStock = true`.
  (`categoryId`/`sellerId` are validated as `@IsUUID`, not just
  `@IsString`, specifically so they can't break out of the
  `field = "value"` filter clause when interpolated.)
- Maps the public `sortBy` vocabulary (`relevance` / `price` / `newest`
  / `rating`) to the underlying document attribute and a sensible
  default order (price ascending, newest/rating descending).
- Calls `index.search(q, { filter, sort, offset, limit, facets: ['categoryId','sellerId','type'] })`.
- Shapes the Meilisearch hit back into the public `SearchResultItem`
  contract, defaulting `productRating` to `null` and `hasActiveAuction`
  to `false` for documents indexed before those fields existed (so the
  API never leaks `undefined` into JSON).
- On any Meilisearch error, throws `ServiceUnavailableException` rather
  than a generic 500 — "search is temporarily down" is a known, named
  condition, distinct from indexing failures (which BullMQ retries).

## 5. Why product *detail* and *checkout* deliberately don't use it

This is a conscious split, called out directly in `search.service.ts`:

| Read | Source | Why |
|---|---|---|
| Listing/searching/filtering products | **Meilisearch** | A few seconds of staleness on a results page is an acceptable cost for fast full-text + facets + sort. |
| `GET /products/:id` (product detail) | **PostgreSQL** (`ProductsService`) | Once a shopper is looking at one specific item, price/stock must be current. |
| Checkout | **PostgreSQL**, inside its own transaction (`OrdersService`) | Never trusts even the detail-page read that preceded it — re-verified independently. |

This mirrors the same rule the repo applies to WebSocket broadcasts:
Meilisearch (like the realtime layer) is a notification/read-model
mechanism, never a dependency of *correct* application behavior
(`.claude/rules/backend.md`).

## 6. Frontend usage

`frontend/src/entities/product/api/search-api.ts` calls `GET /search`
via the shared `api` client with the typed `SearchQuery`. The
`useSearch()` hook (`entities/product/model/use-search.ts`) wraps it in
TanStack Query with `placeholderData: keepPreviousData`, so paginating
through search results shows the previous page while the next loads
instead of flashing a spinner — deliberately leaning into the same
"minor staleness is fine here" tradeoff as the backend. `widgets/search-filters`
builds the actual filter/sort UI that feeds `SearchQuery`.

## Summary

Meilisearch never sits on a critical write or business-correctness path.
Every product mutation goes through Postgres + an outbox event first;
`SearchSyncConsumer` is the *only* thing that writes to Meilisearch, and
`SearchService` is the *only* thing that reads from it for the listing/
search endpoint. If Meilisearch goes down, indexing jobs retry via
BullMQ and search requests degrade to a clean `503`, but product
creation, checkout, and every other business flow keep working
unaffected.
