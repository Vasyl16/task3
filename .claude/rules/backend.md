---
paths:
  - "backend/**"
---

# Backend rules (NestJS)

- **Layering is one-way**: Controller → Service/Use Case → Repository →
  Prisma. No business logic in controllers, no direct DB/Prisma access
  from a controller — see the `backend-architecture` skill for the full
  module layout.
- **PostgreSQL is the source of truth** for every business-critical
  entity. Every write path that matters for correctness goes through it.
- **Meilisearch is a search read model only** — never authoritative,
  never a dependency of correct application behavior.
- **WebSocket is a notification mechanism, not a source of truth.** Same
  rule as Meilisearch. Business services never emit — they record an
  outbox event, and `infrastructure/realtime/` broadcasts it off the
  queue; `RealtimeGateway` is the only file allowed to import Socket.IO.
  No server-side decision may depend on a broadcast having been
  delivered, and a client that missed one must always be able to recover
  via `subscribe`/`resync`, which re-read Postgres. See the
  `backend-architecture` skill's "Real-time layer" section.
- **Critical inventory/order/bid operations require an explicit
  consistency strategy**: an explicit `prisma.$transaction`, and
  optimistic locking (`version` column) for anything mutated under
  concurrent access. Never a naive read-then-write.
- **Events require Outbox + idempotent handlers**: domain write + outbox
  row commit in the same transaction; consumers must tolerate at-least-
  once delivery (dedupe via `ProcessedEvent`, through
  `EventIdempotencyService`). See the `database` skill and
  `backend-architecture`'s "Events & Meilisearch" section for the full
  Outbox → Publisher → BullMQ → Worker pipeline. Client-retried commands
  (checkout/refund/bid) use a *different* mechanism — an
  `Idempotency-Key` header via `IdempotencyKeyService` — never conflate
  the two.
- Every controller input is a typed, `class-validator`-decorated DTO —
  no exceptions.
- **Log structured objects, never interpolated strings**, and never pass
  `correlationId` yourself — `AppLogger` reads it from the ambient
  AsyncLocalStorage context. Every line needs a stable dot-namespaced
  `event`; add `userId`/`entityId` where they apply, and pass errors raw
  (`error: err`). **Never mint a new correlation id inside a request or
  a queued job** — inherit it (`getId() ?? randomUUID()` at most). Only
  genuinely self-initiated work (a deadline job, a periodic sweep) mints
  one, once, at its boundary. See the `observability` skill.
- **Metric labels must be low-cardinality** (route *patterns*, never
  ids), and **business metrics are recorded after the transaction
  commits**, never inside it — a rolled-back checkout must not count.
- **Analytics aggregates live rows; it does not maintain rollup tables.**
  A reported figure must be recomputable from the transactional data it
  describes, so it can't drift from it. Money is summed in Postgres
  `numeric`, cast to `::text`, and folded with `Decimal` — never a JS
  float. Adding a reporting table needs a reason the live query genuinely
  can't cover (see `CartSession` in the `database` skill for the one that
  does), and it still gets written inside the business transaction.
- **Every admin-only route belongs on `AdminController`**, under its
  single class-level `@Roles(ADMIN)` — not scattered across the domain
  controllers. It delegates; it never reimplements a rule.
- **Concurrency/transaction claims need a real-database proof, not just a
  mocked-Prisma unit test.** Rollback-on-failure, atomic stock decrement
  under contention, and "no lost update" under genuinely concurrent
  requests can't be meaningfully asserted against a mock — see
  `test/checkout.e2e-spec.ts` and `test/bidding-concurrency.e2e-spec.ts`
  (real HTTP requests, real `DATABASE_URL`, `Promise.all` for actual
  concurrency) for the pattern. Keep unit tests for business-rule
  coverage (validation, ownership, event payloads) and add this kind of
  test specifically for the atomicity/concurrency claim itself.
- **Authentication ≠ authorization.** Every route requires a valid JWT by
  default (global `JwtAuthGuard`) unless `@Public()`; `@Roles(...)` gates
  by role only. Neither checks resource ownership — that's each
  service's job. **Never trust a client-supplied `userId`/`sellerId`** —
  identity comes only from `@CurrentUser()` (derived from the verified
  JWT), and a seller's own resources are resolved via
  `SellersService.getOwnApprovedSellerProfileOrThrow(userId)`, never a
  request param. See the `backend-architecture` skill for the full
  pattern and diagram.
