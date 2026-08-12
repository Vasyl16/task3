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
- `ProcessedEvent`'s unique `(eventId, consumerName)` is the idempotency
  guard for consumers — insert it before acting, treat a
  unique-violation as "already handled, skip."
- Every FK has an explicit `onDelete`: `Restrict` for anything that would
  corrupt financial/historical records, `Cascade` only for genuinely
  owned child rows (`CartItem`, `OrderItem`, `SellerOrder`), `SetNull`
  for optional references.
