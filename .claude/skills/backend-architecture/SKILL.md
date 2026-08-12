---
name: backend-architecture
description: Backend layered architecture reference for this repo — NestJS module folder layout, dependency-direction rules between modules, transaction/consistency conventions, and the outbox/Meilisearch event pattern. Use when designing or reviewing NestJS module boundaries, adding a new module, wiring cross-module dependencies, or explaining why the backend is structured the way it is.
---

# Backend architecture

See `.claude/rules/backend.md` for the short always-on rules; this is the
detailed reference.

## Module folder layout

`backend/src/` is organized as:

- `config/` — env var loading (`@nestjs/config`, `configuration.ts`) and
  validation (`env.validation.ts`, a Joi schema). Add new config keys to
  both files, typed — never read `process.env` directly outside this
  folder. A var with no safe default (secrets, `DATABASE_URL`) must be
  `.required()` so the app fails fast at startup; only give a var a Joi
  `.default()` when running without it locally is genuinely fine.
- `core/` — cross-cutting, app-wide providers (correlation IDs, structured
  logging, global exception filters/guards), `@Global()`, imported once
  into `AppModule`. Not a place for domain logic. `core/auth/` holds the
  `@Public()`/`@Roles()`/`@CurrentUser()` decorators, `AuthenticatedUser`,
  and the two global guards (`JwtAuthGuard`, `RolesGuard`) — deliberately
  separate from `modules/auth/` (see "Authentication & authorization"
  below) so `infrastructure/` and every module can use them without
  depending on the auth module's actual credential business logic.
- `infrastructure/` — shared technical plumbing used across modules:
  `prisma/` (the `PrismaService` DB client, `@Global()`), `outbox/` (the
  `OutboxService` used to record events inside a transaction), `health/`
  (`GET /health`). Not a place for domain logic — if it needs a business
  rule, it belongs in a module.
- `modules/` — one NestJS module per domain boundary (see root `README.md`
  for the current module list). Don't create a new module for something
  that fits inside an existing one; don't cram unrelated domains into one
  module either — ask if it's unclear which module something belongs in.

Each module follows this internal layout:

```
modules/<name>/
  <name>.module.ts / .controller.ts / .service.ts
  domain/<name>.repository.ts   — abstract class, the persistence port
  domain/events/*.event.ts      — typed outbox payload shapes
  infrastructure/prisma-<name>.repository.ts — concrete Prisma adapter
  dto/*.dto.ts                  — one per input shape, class-validator
```

The service depends on the abstract repository (a DI token), never on
Prisma directly — except for opening a `$transaction` boundary, which is
the one place a service may inject `PrismaService` itself (see
`ProductsService.create` for the reference implementation).

## Dependency direction between modules

A module may import another module and inject its exported *service*
(never reach into its repository or Prisma models directly).

```
infrastructure (Prisma, Outbox) ← core (correlation IDs)
        ↑
    users ← auth
      ↑  ↑
  sellers
      ↑
  categories
      ↑
  products ←── (sellers, categories)
      ↑
  cart ←── (users, products)
      ↑
  bidding ←── (products, sellers, users)
      ↑
  orders ←── (cart, products, sellers, users)
      ↑
  payments-ledger ←── (orders, sellers)

search / analytics / notifications — standalone, import no other
business module. This is deliberate: it's what keeps the outbox pattern
actually decoupled (Products never imports Search — they connect only
via OutboxEvent rows).
```

A module must never import something that (directly or transitively)
imports it back. If you find yourself needing that, the module boundary
is probably wrong — ask before adding the import.

## Transactions & consistency

- Any operation that must be atomic (checkout: inventory + order
  creation; bid placement: version check + update) runs inside an
  explicit `prisma.$transaction`. Don't rely on multiple sequential calls
  "usually" succeeding together.
- Auction bids and inventory reservation use explicit concurrency control
  (optimistic locking via a `version` column) — never a naive
  read-then-write without a guard against concurrent writers.
- Parent `Order.status` is derived from its `SellerOrder`s. Recompute it
  synchronously, in the same transaction as the `SellerOrder` status
  change that triggers it — don't let it drift into an
  eventually-consistent background job.

## Events & Meilisearch

- Writes that need to reach Meilisearch or trigger a WebSocket
  notification go through the outbox table, in the same transaction as
  the domain write. Never call the Meilisearch client or emit a WS event
  directly from inside a business transaction.
- Meilisearch sync consumers must be idempotent (upsert by entity id, not
  "insert").
- Never add a code path where correctness depends on reading from
  Meilisearch. It's a search index, not a queryable source of truth.

## Validation

- Validate at the boundary (controller/DTO). Don't re-validate the same
  shape deeper in the call stack — trust internal code once past the DTO.

## Authentication & authorization

Authentication (who are you) and authorization (what can you do) are
deliberately separate mechanisms — see `.claude/rules/backend.md`.

- **Authentication**: `JwtAuthGuard` (global, in `CoreModule`) requires a
  valid access token on every route unless `@Public()`. It populates
  `req.user: AuthenticatedUser` (`{ id, email, role }`) from the verified
  token payload — never from anything client-supplied.
- **Role authorization**: `@Roles(UserRole.SELLER, UserRole.ADMIN)` +
  `RolesGuard` (also global) checks `req.user.role` against the
  decorator's list. No `@Roles()` = any authenticated user. This is
  necessary but never sufficient for a resource-scoped action.
- **Ownership authorization (IDOR prevention)**: role alone doesn't prove
  a seller owns the specific resource being acted on. Every
  mutating/resource-scoped endpoint does this in the *service*, not the
  controller:
  1. Take the actor from `@CurrentUser()`, never from the request body or
     a route param.
  2. Resolve their own resource via
     `SellersService.getOwnApprovedSellerProfileOrThrow(callerId)` (throws
     `ForbiddenException` if there's no approved profile).
  3. Compare that resolved id against the target resource's owning id
     (`product.sellerId`, `sellerOrder.sellerId`, ...); mismatch → 403.
  4. `ADMIN` bypasses step 2–3 entirely (explicit override, checked first)
     — see `ProductsService.assertOwnsProductOrIsAdmin` and
     `OrdersService.assertOwnsSellerOrderOrIsAdmin` for the reference
     pattern (same shape in both, copy it for new owned resources).
  - A caller who owns nothing should generally get 404 rather than 403
    when looking up someone else's specific resource by id (don't
    confirm to a stranger that the id exists) — see `OrdersService.findById`.
- **Refresh tokens**: rotated on every use (`AuthService.refresh`), and
  only a SHA-256 hash is ever stored (`RefreshToken.tokenHash`) — a DB
  read can't be turned into a usable token. Presenting an already-revoked
  token revokes every active token for that user (reuse ⇒ assume theft).
- **Role sync**: `User.role` is a real column, not derived on every read,
  for `RolesGuard` to check without a DB hit — but it only ever changes
  in `SellersService.review`'s transaction, atomically with the
  `SellerProfile.status` change that causes it (`APPROVED` → `SELLER`,
  anything else → `CUSTOMER`). Never set `role` from anywhere else.
