---
name: database
description: Prisma/PostgreSQL conventions and safety rules for this repo — schema location, migration workflow, destructive-command safety, the Neon pooler + Prisma 7 driver-adapter gotchas, money/concurrency/outbox schema patterns. Use when writing or reviewing a Prisma schema change, creating or applying a migration, or debugging a database connection issue.
---

# Database (Prisma + remote PostgreSQL)

## Safety — read this first

- **Never run a destructive/reset command** (`migrate reset`,
  `db push --force-reset`, raw `DROP`) **against the real `DATABASE_URL`
  without explicit user approval first.** It's a remote, shared database,
  not a disposable local container.
- Prefer `prisma migrate dev`/`deploy` (additive, tracked in
  `backend/prisma/migrations/`) over `db push` for anything beyond quick
  local prototyping — `db push` doesn't produce a migration history.
- To generate migration SQL without touching the live database, use
  `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`
  (fully offline) rather than `migrate dev`, when you want to review SQL
  before applying it.
- Read-only checks that are always safe: `prisma migrate status`,
  `prisma validate`, `prisma generate`, `prisma format`.

## Configuration

- Schema lives in `backend/prisma/schema.prisma`. PostgreSQL is remote —
  never add a local Postgres to docker-compose, never default
  `DATABASE_URL` to a local address.
- **Prisma 7 removed `datasource.url` from `schema.prisma`.** The
  connection URL for the CLI (migrate/generate/studio) lives in
  `backend/prisma.config.ts`. The running app does NOT read this file —
  it loads `DATABASE_URL` itself via `src/config/`, independently.
- **Prisma 7's runtime `PrismaClient` also requires an explicit driver
  adapter** — it no longer reads `DATABASE_URL` on its own at runtime.
  `PrismaService` passes `@prisma/adapter-pg` (`pg`, node-postgres),
  which is the right choice for a long-lived server process;
  `@prisma/adapter-neon` exists for edge/serverless instead. If
  `PrismaClient` throws "was instantiated without any options" at
  runtime, this is why.
- **Neon pooler caveat**: if `DATABASE_URL` points at a pooled endpoint
  (hostname contains `-pooler`), `prisma migrate`/`db push` may need a
  direct (non-pooled) connection instead — PgBouncer in
  transaction-pooling mode doesn't support the advisory locks Migrate
  uses. In practice `migrate deploy` has worked fine against the pooled
  Neon endpoint in this repo so far; if a migrate command hangs or
  errors mysteriously, this is the first thing to check.

## Schema conventions

- Money fields are `Decimal` (`@db.Decimal(12, 2)`), never `Float`.
- A table with a field genuinely mutated under concurrent access
  (`Inventory`, `Auction`) has a `version` column — optimistic-lock
  writes with `WHERE id = ? AND version = ?`, never a blind `UPDATE`.
- `OutboxEvent` is deliberately NOT foreign-keyed to domain tables
  (generic `aggregateType`/`aggregateId` strings) so it stays decoupled
  from whatever schema changes happen to specific entities later. Written
  in the SAME transaction as the domain change it describes.
  `status`/`attempts`/`lastError`/`availableAt` are the retry/backoff
  state the Outbox Publisher (`infrastructure/outbox/
  outbox-publisher.service.ts`) uses to claim, publish-to-BullMQ, and
  retry rows — see the `backend-architecture` skill for the full
  pipeline.
- `ProcessedEvent`'s unique `(eventId, consumerName)` is the idempotency
  guard for consumers — insert it before acting, treat a
  unique-violation as "already handled, skip." Use
  `EventIdempotencyService`, don't reimplement this per consumer.
- `IdempotencyKey`'s unique `(key, userId)` is a *different* guard — API
  idempotency for a client-retried command (checkout/refund/bid), not an
  event-consumer concern. `userId` is required (not nullable) precisely
  because Postgres treats `NULL <> NULL` in a unique index, which would
  silently defeat the guard for an unauthenticated key. Use
  `IdempotencyKeyService`.
- Every FK has an explicit `onDelete`: `Restrict` for anything that would
  corrupt financial/historical records, `Cascade` only for genuinely
  owned child rows (`CartItem`, `OrderItem`, `SellerOrder`), `SetNull`
  for optional references.

## Analytics & reporting tables

**There are no rollup/aggregation tables, and adding one needs a real
argument.** Every reported figure is summed live from the transactional
rows at request time (see `modules/analytics/`). The reason is not
purity: a pre-aggregated total can drift from the rows it claims to
describe — after a cancellation reverses a sale, after a backfill, after
a consumer misses a message — and a financial figure that disagrees with
the ledger is worse than a slow one. `LedgerEntry` already *is* the
financial read model; it's append-only, written inside the business
transaction, and indexed for period queries (`type, createdAt` and
`sellerId, createdAt`).

The one reporting-shaped table is **`CartSession`**, and only because
checkout DELETES the cart's items (`CartRepository.clearCart`). Measuring
cart→order conversion from `CartItem.addedAt` afterwards would count only
the carts that DIDN'T convert — the converted ones leave no trace. So the
funnel is recorded on the way in:

- `CartService.addItem` opens a session if the cart has none open.
- `CartService.completeCheckout` closes them against the order id, and
  empties the cart, as one operation — splitting those two would let a
  future caller empty a cart without recording the conversion, and there
  is no way to reconstruct it after the fact.

It is still **transactional truth, not an eventually-consistent
projection**: both writes happen inside the caller's transaction, nothing
derives it asynchronously, and no financial figure is read from it. Two
genuinely concurrent add-to-cart calls can open two sessions for one
cart; both are closed together at checkout so the ratio stays consistent.
That imprecision is accepted deliberately — it's a funnel counter, not
money.

Money in aggregate queries: sum in Postgres `numeric`, cast to `::text`
so it arrives as an exact decimal string, and fold it with `Decimal`
(`modules/analytics/domain/revenue.ts`). Never let a currency sum pass
through a JS float — and never label a period-bounded query without an
index for it.
