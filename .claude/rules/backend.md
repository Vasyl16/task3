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
- **Critical inventory/order/bid operations require an explicit
  consistency strategy**: an explicit `prisma.$transaction`, and
  optimistic locking (`version` column) for anything mutated under
  concurrent access. Never a naive read-then-write.
- **Events require Outbox + idempotent handlers**: domain write + outbox
  row commit in the same transaction; consumers must tolerate at-least-
  once delivery (dedupe via `ProcessedEvent`). See the `database` skill.
- Every controller input is a typed, `class-validator`-decorated DTO —
  no exceptions.
- **Authentication ≠ authorization.** Every route requires a valid JWT by
  default (global `JwtAuthGuard`) unless `@Public()`; `@Roles(...)` gates
  by role only. Neither checks resource ownership — that's each
  service's job. **Never trust a client-supplied `userId`/`sellerId`** —
  identity comes only from `@CurrentUser()` (derived from the verified
  JWT), and a seller's own resources are resolved via
  `SellersService.getOwnApprovedSellerProfileOrThrow(userId)`, never a
  request param. See the `backend-architecture` skill for the full
  pattern and diagram.
