# Backend rules (NestJS)

Also read the root `../CLAUDE.md` — these rules add to, not replace, it.

## Layering

- **Controllers only orchestrate**: parse/validate the request (via DTOs),
  call a service method, shape the response. No business logic, no direct
  Prisma/DB calls in a controller.
- **No direct DB access from controllers.** All persistence goes through a
  service (and that service's injected Prisma client/repository).
- Business logic lives in services. Keep services focused on one module's
  domain — cross-module orchestration happens by injecting the other
  module's service through its public interface, not by reaching into its
  internals or its Prisma models directly.

## Validation

- Every controller input (body, query, params) is a typed DTO with
  `class-validator` decorators. No `any`, no untyped `req.body` access.
- Validate at the boundary (controller/DTO). Don't re-validate the same
  shape deeper in the call stack — trust internal code once past the DTO.

## Transactions & consistency

- Any operation that must be atomic (checkout: inventory + order creation;
  bid placement: version check + update) runs inside an **explicit Prisma
  transaction** (`prisma.$transaction`). Don't rely on multiple sequential
  calls "usually" succeeding together.
- Auction bids use explicit concurrency control (optimistic locking via a
  version column, or row-level locking) — never a naive read-then-write
  without a guard against concurrent bids.
- Parent `Order.status` is derived from its `SellerOrder`s. Recompute it
  synchronously, in the same transaction as the `SellerOrder` status change
  that triggers it — don't let it drift into an eventually-consistent
  background job.

## Events & Meilisearch

- Writes that need to reach Meilisearch or trigger a WebSocket
  notification go through the **outbox table**, in the same transaction as
  the domain write. Never call the Meilisearch client or emit a WS event
  directly from inside a business transaction.
- Meilisearch sync consumers must be idempotent (upsert by entity id, not
  "insert").
- Never add a code path where correctness depends on reading from
  Meilisearch. It's a search index, not a queryable source of truth.

## Module structure

`src/` is organized as:

- `config/` — env var loading (`@nestjs/config`, `configuration.ts`) and
  validation (`env.validation.ts`, a Joi schema). Add new config keys to
  both files, typed — never read `process.env` directly outside this
  folder. A var with no safe default (secrets, `DATABASE_URL`) must be
  `.required()` in the schema so the app fails fast at startup instead of
  booting misconfigured; only give a var a Joi `.default()` when running
  without it locally is genuinely fine.
- `core/` — cross-cutting, app-wide providers (correlation IDs, structured
  logging, global exception filters/guards) imported once into
  `AppModule`. Not a place for domain logic.
- `modules/` — one NestJS module per domain boundary (see root CLAUDE.md /
  README for the current module list), e.g. `modules/auth/`,
  `modules/inventory/`. Don't create a new module for something that fits
  inside an existing one; don't cram unrelated domains into one module
  either — ask if it's unclear which module something belongs in.
- `app.module.ts` / `app.controller.ts` / `app.service.ts` / `main.ts` —
  root bootstrap only, not a domain module. Don't add business logic here.

## Testing

- Unit test services, especially anything with concurrency control or
  transactional logic — mock Prisma only where the test's purpose is pure
  business-rule logic; use a real test DB for anything verifying actual
  transaction/locking behavior.
- e2e tests (`test/*.e2e-spec.ts`) hit real HTTP endpoints via supertest.
- Run `npm run lint`, `npm run typecheck`, and `npm run test` before
  considering a change done.
