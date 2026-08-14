# Multi-Vendor Marketplace + Real-Time Inventory

## Repository Structure

This is a monorepo containing two fully independent applications — each has
its own `package.json`, dependencies, and lockfile. There is no root-level
package manager or workspace tooling; `backend/` and `frontend/` are managed
separately.

```
.
├── backend/            # NestJS + TypeScript API (modular monolith)
│   ├── Dockerfile       # full-mode image (compiled app; + a migrate stage)
│   ├── prisma/
│   │   ├── schema.prisma # domain model (PostgreSQL, remote — see "Database" below)
│   │   └── migrations/    # tracked migration history
│   └── src/
│       ├── config/         # env var loading (@nestjs/config)
│       ├── core/           # cross-cutting providers (correlation IDs,
│       │                    # structured logger, HTTP observability)
│       ├── infrastructure/ # shared plumbing: Prisma, outbox, queue,
│       │                    # realtime, metrics, health
│       └── modules/        # one NestJS module per domain boundary — see
│                            # the backend-architecture skill for the
│                            # layout and dependency-direction rules
├── frontend/           # React + TypeScript app (Vite), Feature-Sliced Design
│   ├── Dockerfile       # full-mode image (static build served by nginx)
│   ├── nginx.conf       # SPA fallback + asset caching for that image
│   └── src/
│       ├── app/          # root component, providers, global styles, routing
│       ├── pages/        # route-level compositions
│       ├── widgets/       # composite UI blocks
│       ├── features/      # user-facing interactions (add-to-cart, place-bid, ...)
│       ├── entities/      # business entities (data shape, API, minimal display)
│       └── shared/        # business-agnostic reusable code (UI kit, API client, assets)
├── observability/      # Configs for the local metrics/logs stack
│   ├── prometheus/      # scrape config (targets the host's /metrics)
│   ├── loki/            # single-binary Loki config
│   ├── promtail/        # tails backend/logs/*.log -> Loki
│   └── grafana/         # provisioned datasources + overview dashboard
├── docker-compose.yml  # Infra: Redis, Meilisearch, Prometheus, Loki,
│                        # Promtail, Grafana — plus backend/frontend
│                        # behind the `full` profile (see "Running the app")
└── .claude/
    ├── rules/            # always-on / path-scoped rules (general, backend,
    │                      # frontend, testing) — see CLAUDE.md
    └── skills/           # on-demand reference (backend-architecture,
                           # frontend-architecture, database, testing,
                           # observability, code-review-checklist)
```

Backend layering, dependency direction, and FSD import-direction rules
are enforced via `.claude/rules/` (short, path-scoped) and the
`.claude/skills/backend-architecture` / `frontend-architecture` skills
(detailed reference) — read those before adding code to either app.

### Why no root `package.json`?

By design. Backend and frontend are decoupled applications with independent
dependency trees, build tooling, and release lifecycles. A shared package
will only be introduced under `shared/` if genuine duplication (e.g. common
API/WebSocket event contract types) emerges — not preemptively.

## Infrastructure

`docker-compose.yml` provisions the infra that's appropriate to run
locally, and — behind the opt-in `full` profile — the backend and
frontend themselves (see "Running the app"). Each infra service exists
for a specific reason:

- **Redis** — the backing store for **BullMQ**, the async job queue used
  for anything that doesn't need to block the originating request:
  Meilisearch index sync and WebSocket notification dispatch, both
  triggered via the transactional outbox pattern (domain write + outbox
  row commit together in Postgres; a relay then enqueues BullMQ jobs from
  outbox rows). It also backs a small **read-through cache** for the
  product catalogue and product-detail pages (`infrastructure/cache/`).
  Redis holds no business-critical state either way — if it's flushed,
  in-flight async jobs are lost but Postgres remains fully correct
  (jobs would need to be re-triggered by re-running the outbox relay,
  not by any manual data recovery), and the cache just goes cold, with
  every read falling straight through to Postgres until it warms back up.
- **Meilisearch** — the search/read index for products. It is **not** a
  source of truth: nothing in the application may depend on Meilisearch
  being up-to-date, or even up, for anything other than the search feature
  itself. It's rebuilt asynchronously from Postgres via the same
  outbox → BullMQ pipeline.
- **Prometheus + Loki + Promtail + Grafana** — the observability stack.
  Prometheus scrapes the backend's `/metrics`; Promtail tails the JSON
  log file the backend writes and ships it to Loki; Grafana queries both
  and comes up pre-provisioned with an overview dashboard (no UI setup).
  Like the backend itself, none of this holds business-critical state —
  it is observation only. See the `.claude/skills/observability` skill.
- **PostgreSQL is deliberately excluded and remote.** It is the single
  source of truth for all business-critical state (users, vendors,
  products, inventory, orders, auctions, bids, payments) and is never
  containerized here, never defaulted to a local address, and never
  hardcoded — only configured via `DATABASE_URL` in `backend/.env`
  (provision a real remote/hosted Postgres instance yourself).

Every **infra** value in `docker-compose.yml` (ports, Meilisearch's
master key) has a working local-dev default via `${VAR:-default}`
substitution, so `docker compose up -d` works immediately with no `.env`
file required. Override any of them with a root-level `.env` file or
exported shell env vars if you need non-default ports or a real master
key locally. The `full` profile is the exception: the backend service
reads `backend/.env`, which must exist and supply `DATABASE_URL` and the
JWT secrets. Those are secrets, so they stay in that gitignored file and
are never inlined into `docker-compose.yml`.

## Database (Prisma)

`backend/prisma/schema.prisma` is the domain model; `backend/prisma/migrations/`
is the tracked, additive migration history. See the `.claude/skills/database`
skill for the full entity/relationship rundown, constraint rationale, and
migration safety rules.

- **Prisma 7** moved the connection URL out of `schema.prisma` into
  `backend/prisma.config.ts` (CLI-only — the running app still reads
  `DATABASE_URL` itself via `src/config/`, independently).
- Never run a destructive/reset command (`migrate reset`,
  `db push --force-reset`) against the real `DATABASE_URL` without
  explicit approval — it's a remote, shared database, not a disposable
  local container.
- **Pooled connections (e.g. Neon's `-pooler` endpoint):** `prisma
  migrate`/`db push` need a direct (non-pooled) connection — PgBouncer in
  transaction-pooling mode doesn't support the advisory locks Migrate
  uses. If `DATABASE_URL` points at a pooled endpoint and migrate
  commands fail or hang, point `prisma.config.ts` at a direct connection
  string instead for that command.
- Commands: `npm run prisma:generate` (regenerate client, offline),
  `npm run prisma:validate` (schema-only check, offline),
  `npm run prisma:migrate:status` (read-only remote check),
  `npm run prisma:migrate:dev` / `prisma:migrate:deploy` (apply — treat as
  a deliberate, reviewed action, not a routine one).

## Environment Variables

Each app has its own `.env` (gitignored) copied from its own
`.env.example`. **Backend `.env` is server-only and never sent to the
browser.** Frontend `.env` is different: Vite inlines every
`VITE_`-prefixed var into the built JS bundle, so anything there is
public — visible to anyone via devtools. Never put a secret in a
`VITE_*` var.

Both apps validate their env at startup and fail fast with a clear error
if something required is missing or malformed — see
`backend/src/config/env.validation.ts` (Joi schema) and
`frontend/src/shared/config/env.ts`.

**Backend** (`backend/.env`, see `backend/.env.example` for the full list):

| Variable | Required? | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | **Required, no default** | Remote PostgreSQL connection string |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | **Required, no default** (min 16 chars) | Token signing secrets |
| `PORT`, `CORS_ORIGIN`, `NODE_ENV` | Optional | App-level defaults |
| `REDIS_URL` | Optional | Defaults to the local docker-compose Redis |
| `MEILISEARCH_HOST`, `MEILI_MASTER_KEY` | Optional | Defaults to the local docker-compose Meilisearch |
| `LOG_LEVEL`, `LOG_FILE` | Optional | Structured-log level, and the file Promtail tails (`LOG_FILE=` disables the file sink) |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | Optional | Token lifetimes |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` | Optional (placeholders) | Not wired up yet |

**Frontend** (`frontend/.env`, see `frontend/.env.example`) — public only:

| Variable | Required? | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | Required | Backend REST base URL |
| `VITE_WS_URL` | Required | Backend WebSocket base URL — the gateway lives on the `/realtime` Socket.IO namespace |

## Running the app

Two supported variants, one `docker-compose.yml`. Both need
`backend/.env` in place first — see "First-time setup" below.

**Variant 1 — everything in Docker.** One command, no local Node needed.
Use it to run the system: demos, review, checking it works on a clean
machine.

```bash
docker compose --profile full up -d
# frontend :5173 · backend :3000 · grafana :3001
```

**Variant 2 — infra in Docker, apps on the host.** Use it to develop:
the containers hold the things you don't edit, the host runs the things
you do, with hot reload on both.

```bash
docker compose up -d                              # redis, meilisearch, observability
cd backend  && npm install && npm run start:dev   # :3000, watch mode
cd frontend && npm install && npm run dev         # :5173, Vite HMR
```

The two app services carry `profiles: ['full']`, and Compose skips a
profiled service unless its profile is named. That single mechanism is
what lets the same file serve both variants: naming the profile adds the
apps, omitting it leaves infra alone. It is also why variant 1 keeps the
`--profile full` flag rather than being a bare `docker compose up` — a
plain `up` already means variant 2, and one command cannot mean both.

Details and trade-offs:

| | **Variant 1 — everything in Docker** | **Variant 2 — infra in Docker, apps on the host** |
| --- | --- | --- |
| Command | `docker compose --profile full up -d` | `docker compose up -d`, then `npm run start:dev` / `npm run dev` |
| Local Node needed | no | yes (24+) |
| Backend | container (compiled, `node dist/main`) | host, watch mode |
| Frontend | container (static build behind nginx) | host, Vite dev server + HMR |
| Redis, Meilisearch, observability | containers | containers |
| PostgreSQL | **remote, never containerised** | **remote, never containerised** |
| Hot reload | no — code changes need a rebuild | yes |
| Best for | running the whole system, demos, checking it works from a clean machine | actually developing |

Both variants need `backend/.env` first (see below): `DATABASE_URL` and the
two JWT secrets are required and have no defaults, so the app fails fast
without them. PostgreSQL is remote in **both** variants — nothing here ever
brings up a database container.

### Prerequisites

- Docker (with Compose v2)
- A reachable PostgreSQL instance and its connection string
- Node.js 24+ — **variant 2 only**; variant 1 needs no local Node

### First-time setup (both variants)

```bash
cp backend/.env.example backend/.env    # fill in DATABASE_URL + JWT secrets
cp frontend/.env.example frontend/.env  # defaults work as-is
```

Then apply the schema to your database — with a local toolchain:

```bash
cd backend && npm install && npm run prisma:migrate:deploy
```

…or through Docker, so full mode needs no local Node at all:

```bash
docker compose --profile migrate run --rm migrate
```

Migrations are **never** applied automatically on container start.
Applying one to a remote database is a deliberate, reviewed action, not a
side effect of `docker compose up` — see "Database (Prisma)" above. That
is why `migrate` is a one-off service on its own profile, and why the
Prisma CLI is pruned out of the image the backend actually serves from:
a running container cannot migrate anything.

### Variant 1 — everything in Docker

```bash
docker compose --profile full up -d
```

Brings up Redis, Meilisearch, the observability stack, **and** the
backend and frontend as containers. The `full` profile is what gates the
two app services: Compose skips a profiled service unless its profile is
named, which is why the plain `up -d` below still starts infra only.

- Frontend — **http://localhost:5173**
- Backend — **http://localhost:3000** (`/health`, `/metrics`)
- Grafana — **http://localhost:3001**

Both images are production-style: the backend is compiled and run as
`node dist/main`, the frontend is a static Vite build served by nginx.
Neither mounts your source tree, so **code changes require a rebuild**:

```bash
docker compose --profile full up -d --build backend   # or: frontend
```

One consequence worth knowing: Vite inlines `VITE_*` vars at *build*
time, so `VITE_API_URL` / `VITE_WS_URL` are baked into the frontend image
and changing them means rebuilding it, not restarting it. They are
passed as build args (see `docker-compose.yml`) and are public by
definition — never put a secret in one.

Shut down with `docker compose --profile full down` (add `-v` to also
drop the Redis/Meilisearch/Grafana volumes).

### Variant 2 — infra in Docker, apps on the host

The better setup for development: containers for the things you don't
edit, hot reload for the things you do.

```bash
docker compose up -d          # Redis, Meilisearch, observability only
```

Then, in two terminals:

```bash
cd backend && npm install && npm run start:dev   # http://localhost:3000
```

```bash
cd frontend && npm install && npm run dev        # http://localhost:5173
```

`backend/.env`'s defaults already point `REDIS_URL` and
`MEILISEARCH_HOST` at the compose services on localhost. Keep
`MEILI_MASTER_KEY` matching whatever the meilisearch container was
started with (default `changeme_dev_master_key`) — in full mode compose
pins the two together for you, but here they are yours to keep in sync.

### Ports

Every port is overridable from a root `.env` file or the shell.

| Service | URL | Override |
| --- | --- | --- |
| Frontend | http://localhost:5173 | `FRONTEND_PORT` (full mode) |
| Backend (REST + WebSocket) | http://localhost:3000 | `BACKEND_PORT` (full), `PORT` (hybrid) |
| Grafana | http://localhost:3001 | `GRAFANA_PORT` |
| Prometheus | http://localhost:9090 | `PROMETHEUS_PORT` |
| Meilisearch | http://localhost:7700 | `MEILISEARCH_PORT` |
| Redis | localhost:6379 | `REDIS_PORT` |
| Loki | http://localhost:3100 | `LOKI_PORT` |

Grafana comes up with the "Marketplace Overview" dashboard already
provisioned — request rates, latency, checkout/bid/queue/outbox metrics,
and a log panel that traces a single operation by correlation ID. It
works identically in both modes, because Prometheus always scrapes
`host.docker.internal:3000` (the backend is on the host's port 3000
either way) and Promtail always tails `backend/logs/` (which the backend
container bind-mounts).

## Available Scripts (per app)

Run these from inside `backend/` or `frontend/` respectively:

| Script            | Purpose                              |
| ------------------ | ------------------------------------- |
| `npm run start:dev` (backend) / `npm run dev` (frontend) | Start the app in watch mode |
| `npm run build`    | Production build / type-checked build |
| `npm run lint`     | ESLint (with Prettier integration), auto-fix |
| `npm run typecheck`| TypeScript type-checking only         |
| `npm run test`     | Unit tests (Jest for backend, Vitest for frontend) |
| `npm run test:e2e` | Backend end-to-end tests (NestJS + supertest) |

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull
request, as four parallel jobs:

| Job | What it does |
| --- | --- |
| **backend** | lint (`--max-warnings=0`), typecheck, unit tests, build |
| **backend-e2e** | the same, against **ephemeral** PostgreSQL + Redis + Meilisearch service containers |
| **frontend** | lint, typecheck, Vitest, build |
| **config-lint** | hadolint on both Dockerfiles, `docker compose config` for both profiles, actionlint on the workflows |

**CI never touches the development database.** PostgreSQL is remote in
development, but a pull-request run must not be allowed near a personal
or shared instance — these tests write and delete real rows. The e2e job
brings up a throwaway `postgres:16-alpine` container that exists only for
the length of that job, and **no `DATABASE_URL` secret is referenced
anywhere in the workflow**, so there is nothing to leak and nothing to
accidentally point at the wrong instance. JWT secrets in CI are literal
throwaway strings for a throwaway database. `RESEND_API_KEY` is left
unset on purpose, so `EmailService` logs and skips instead of emailing a
real address.

**Known gap:** the e2e job builds its schema with `prisma db push`, not
`prisma migrate deploy`, because the squashed init migration is missing
its `CREATE TYPE` statements and cannot replay against an empty database.
The live database is unaffected (the types exist there). The consequence
is that CI does **not** prove the migrations can rebuild the schema from
scratch — restoring that coverage means repairing the init migration
first, which rewrites already-applied history and so is a deliberate
decision rather than something to do silently.

## API documentation

With the backend running, interactive OpenAPI docs are at
**<http://localhost:3000/docs>** (raw spec at `/docs-json`).

Driving the API by hand from there:

1. `POST /auth/login` with a seeded account — they all use the password
   `SeedPass123!` (see `backend/prisma/seed.ts`, which prints the list).
2. Click **Authorize**, paste the `accessToken` (no `Bearer ` prefix). It
   persists across page reloads.
3. Endpoints are grouped by tag; each documents its role requirement and
   the error responses that carry business meaning — why a checkout 400s
   versus 409s, why a bid 400 under contention is the optimistic lock
   working rather than a failure, and why probing someone else's record
   returns 404 rather than 403.

Request schemas are generated from the DTOs themselves via the
`@nestjs/swagger` CLI plugin (wired in `nest-cli.json`), so the documented
constraints — required fields, UUID formats, minimums — are the ones
`class-validator` actually enforces at runtime and cannot drift from them.

## Load testing

One scenario, in `load/bidding.k6.js`: **many concurrent bidders on a
single auction**. It was chosen over concurrent checkout because it puts
every virtual user in contention for the *same database row*. Checkout
under limited inventory contends too, but it spreads across several
products and sellers; here the contention is total, which is what
actually exercises the optimistic-locking strategy in
`BiddingService.placeBid`.

The script measures throughput and latency, and — in `teardown()`, against
the live API after the load stops — asserts the **business invariants**.
That second half matters: a system that silently dropped bids would look
*faster* here, not slower.

### Running it

Needs [k6](https://k6.io/) and the app running.

```bash
# Rate limiting is raised for the run — we're measuring the concurrency
# strategy, not the throttle (see THROTTLE_LIMIT in backend/.env.example).
cd backend
THROTTLE_LIMIT=1000000 THROTTLE_AUTH_LIMIT=1000000 npm run start:dev

# In another shell, from the repo root:
VUS=10 DURATION=30s k6 run load/bidding.k6.js

node load/cleanup.mjs   # removes the bidder accounts / product / auction it created
```

### Results

Measured on 2026-08-14, macOS arm64, single backend process, against the
project's **remote** PostgreSQL. Real numbers from the runs below — not
projections.

| Run | VUs | `DATABASE_POOL_MAX` | RPS | p95 latency | Bids accepted | Unexpected 5xx | Invariants |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | 10 | 10 | 3.07/s | 4.42 s | 26 | **0** | ✅ all held |
| B | 50 | 10 | 4.39/s | 8.74 s | 17 | 18 | ✅ all held |
| C | 50 | 50 | 4.34/s | 10.91 s | 9 | 207 | ✅ all held |

Invariants asserted after every run, all of which held in all three:

- `auction.version` equals the number of accepted `Bid` rows — no update
  was lost, and none applied twice.
- `currentHighestBid` equals the highest accepted bid.
- `currentHighestBidderId` is the account that actually placed it.
- Accepted bids, in chronological order, are **strictly ascending** — no
  accepted bid is ever lower than one accepted before it. That is the
  definition of "no lost update" for this domain.

### What this demonstrates about the concurrency strategy

**The optimistic locking is correct, and that is the headline.** Across
all three runs — including the two that were failing badly — the auction
never lost a bid, never double-counted one, and always settled on the
genuine highest. Under contention the conditional
`UPDATE ... WHERE version = ?` either applies or matches zero rows;
Postgres serializes the two writers, so the loser re-reads and retries
rather than overwriting the winner. Contention shows up as **rejections,
never as corruption**: in run A, 26 bids were accepted and 70 were
rejected with `400` because the floor had already moved above them. A
`400` there is the system working.

**The cost is the transaction envelope, not the locking.** A single DB
round trip to the remote database measures **~122 ms** (`GET /health`,
which is one `SELECT 1`), against ~1 ms for a route that touches no
database. One bid costs roughly six round trips — read the auction,
resolve the bidder's seller profile, begin, conditional update, insert
the bid, record the outbox event, commit — and the retry loop multiplies
that by up to `MAX_BID_ATTEMPTS`. That arithmetic, not lock contention,
is what produces a ~1.3 s successful bid and a p95 of 4.42 s. Against a
co-located database the same code would be roughly an order of magnitude
faster; **these numbers characterise a remote-database deployment, and
should not be read as the algorithm's cost.**

**Concurrency is capped by the connection pool, and enlarging it makes
things worse.** Every interactive `$transaction` holds a connection for
its whole duration, so the pool — not CPU — is the ceiling on concurrent
writes. Run B exceeded it and failed with *"Unable to start a transaction
in the given time"*. The intuitive fix was run C, which was **worse**:
with 50 connections, 50 transactions all start, all queue on the same hot
row, and exceed Prisma's 5 s interactive-transaction timeout mid-flight
(*"a query cannot be executed on an expired transaction"*). For a single
contended row, a bigger pool converts fast rejections into slow timeouts.
The real fixes would be to shrink the transaction (move the outbox write
and the bid insert into one statement round trip) or to shed load ahead
of the pool — not to add connections. `DATABASE_POOL_MAX` is now
configurable (default 10, node-postgres' own default) so this ceiling is
explicit rather than invisible.

**Known limitation:** the failures in runs B and C surface as `500`s. They
are honest failures — no data was corrupted — but pool exhaustion and
transaction timeout are both *capacity* conditions and would be better
returned as `503` with a `Retry-After`. That is not fixed here.

## Architecture Notes

See `CLAUDE.md` for the pointer to `.claude/rules/` (always-on / path-
scoped rules) and `.claude/skills/` (module boundaries, transaction
rules, DTO validation, idempotent event handlers, migration safety,
etc.). A full architecture write-up (consistency model, outbox/event
flow, domain events) will be added to this README as those pieces are
implemented.

## Status

This repository contains: scaffolded backend/frontend apps with layered
structure (backend `config/core/infrastructure/modules`, frontend FSD),
tooling (lint/format/test/build), local infra config, validated app
configuration, the Prisma domain model applied to the remote database,
and the backend's NestJS module boundaries with basic CRUD wired
end-to-end.

**Authentication & authorization are implemented**: JWT access/refresh
tokens (rotation + reuse detection), roles (`CUSTOMER`/`SELLER`/`ADMIN`),
global guards (`@Public()`/`@Roles()`), and ownership checks (IDOR
prevention) on products, seller applications, and SellerOrders — see the
`backend-architecture` skill's "Authentication & authorization" section.
Google OAuth is wired (conditionally, only when configured) but untested
against a real Google app.

**The customer → seller → catalog workflow is implemented**: applying to
become a seller, admin approve/reject (which grants/revokes the `SELLER`
role atomically), and seller-owned product CRUD (create/update/archive)
with `FIXED_PRICE`/`AUCTION` product types, server-side ownership
enforcement, and soft-delete (archive, never physical delete) to avoid
breaking existing carts/orders.

**The async event infrastructure is implemented**: a Transactional
Outbox (`OutboxEvent`, written in the same transaction as the domain
change it describes) relayed by a claim-and-publish `OutboxPublisherService`
onto BullMQ queues (`infrastructure/queue/`), with reusable idempotency
for both event consumers (`EventIdempotencyService` / `ProcessedEvent`)
and client-retried commands (`IdempotencyKeyService` / `IdempotencyKey`
via an `Idempotency-Key` header — wired on checkout and bid placement).
Meilisearch product search is implemented end-to-end on top of this:
`Product` create/update/archive → outbox → BullMQ → `SearchSyncConsumer`
→ Meilisearch, fully decoupled and eventually consistent. Four consumers
are wired: search sync, order processing (auto-advances a new
`SellerOrder` to `PROCESSING`), notifications (tells the seller about a
new order), and auction deadlines (ends auctions / expires unclaimed
wins, backstopped by a periodic Postgres reconciliation sweep since a
scheduled job isn't outbox-backed). Analytics has a reserved queue but
no consumer yet. See the `backend-architecture` skill's "Events &
Meilisearch" section for the full pipeline and delivery-guarantee notes
(at-least-once, not exactly-once).

**Catalog search, cart, multi-vendor checkout, SellerOrder lifecycle,
and auctions are implemented.** Search/browsing (`GET /search`) reads
Meilisearch — full-text, filters, facets, pagination, sorting; a single
product's detail (`GET /products/:id`) and checkout always re-read
PostgreSQL, never Meilisearch. The cart (multi-seller, add/update-
quantity/remove) validates a product's authoritative state at add-time
but never trusts it at checkout, which re-validates availability/price/
stock inside its own transaction and atomically decrements stock,
splitting a multi-vendor cart into one `SellerOrder` per seller with
commission/ledger entries — see the `backend-architecture` skill's
"Checkout" section for the exact transaction steps. `SellerOrder`
transitions through an explicit state machine (`NEW → PROCESSING →
SHIPPED → COMPLETED`, or cancellation), with the parent `Order.status`
derived from the set of its `SellerOrder`s (see "SellerOrder lifecycle &
Order status aggregation"); cancelling one seller's `SellerOrder`
restores only that seller's stock and never touches another seller's
part of the same order. Auction bidding uses optimistic concurrency
control (`Auction.version`) with a bounded retry loop — proven safe
under genuine concurrent requests, not just mocked ones, by
`test/bidding-concurrency.e2e-spec.ts` — and a full deadline lifecycle
(`SCHEDULED → ACTIVE → ENDED/EXPIRED`, winner checkout window,
auto-expiry).

**The real-time layer is implemented** (`backend/src/infrastructure/
realtime/`): a NestJS WebSocket gateway on Socket.IO at the `/realtime`
namespace, broadcasting three kinds of change — inventory updates
(`product:{id}`), auction bid/end updates (`auction:{id}`), and
SellerOrder status updates (`order:{id}` and `seller-order:{id}`).
It is wired the same way everything else async is: a business
transaction records an outbox event, and `RealtimeConsumer` broadcasts
it off the `realtime` BullMQ queue — no business service imports
Socket.IO, and `RealtimeModule` imports no business module.

**WebSocket is a notification mechanism, not a source of truth.**
PostgreSQL remains authoritative for every value a broadcast mentions.
That is enforced by the reconnect design rather than by convention:
`subscribe` both joins a room and returns a snapshot read from Postgres
in a single round trip, `resync` returns that snapshot again on demand,
and every broadcast carries the REST endpoint that is authoritative for
its room — so a client that missed messages (or doubts what it holds)
converges by asking, and a missed event can never leave the UI
permanently stale. Connections may be anonymous for public
product/auction rooms; order rooms require a verified JWT from the
handshake plus an ownership check, and an invalid token disconnects the
socket rather than silently downgrading it. See the
`backend-architecture` skill's "Real-time layer" section for the room
scheme, the authorization matrix, and the single-process caveat.

**Observability is implemented**: every log line is newline-delimited
JSON carrying `timestamp`, `level`, a stable `event` name,
`correlationId`, and `userId`/`entityId`/error details where they apply.
A correlation ID is taken from an incoming `X-Correlation-ID` header (or
generated), echoed back on the response, held in `AsyncLocalStorage`, and
carried through the OutboxEvent row into the BullMQ job and back out
inside the worker — so one operation is traceable across
HTTP → service → outbox → queue → worker → event handler **without any
hop minting a new id**. Prometheus metrics are exposed at `/metrics`
(HTTP rate/latency/errors, checkout outcomes and duration, bids and
optimistic-locking conflicts, queue jobs, outbox relay, inventory
movement, WebSocket connections and broadcasts). See the
`observability` skill for the conventions and the reasoning behind the
two rules that matter most — low-cardinality labels, and recording
business metrics only after the transaction commits.

**Admin moderation and marketplace analytics are implemented.** Every
admin-only route lives on a single `AdminController` under `/admin`,
behind one class-level `@Roles(ADMIN)` — the module holds no business
logic and no service of its own, so "admin can do X" is never a second
implementation of X with its own subtly different rules, and the
complete admin surface can be audited by reading one file. It covers
seller-application moderation (queue + approve/reject), product
moderation (takedown/reinstatement with a
`moderatedBy`/`moderatedAt`/`moderationNote` audit trail, emitting the
same outbox events that add or remove the Meilisearch document),
disputes, and platform analytics.

Disputes are their own module: a buyer raises one against a `SellerOrder`
they actually bought (verified through `OrdersService`, 404 rather than
403 so the endpoint can't be used to probe ids), only one may be awaiting
a decision per order at a time, and an admin ruling is final and must
carry written reasoning. The seller whose shipment it concerns can also
read the dispute, see the purchase it's about, and reply — the same
three-way access check (buyer who raised it, the owning seller, or any
admin) covers reads, the comment thread, and posting.

**Resolving a dispute and acting on the order are two separate, deliberate
admin actions, not one atomic operation.** `DisputesService.resolve()`
only ever changes the `Dispute` row (status, resolution text, who
decided). If the ruling calls for it, the admin separately cancels the
`SellerOrder` from the orders queue — including one already `SHIPPED` or
`COMPLETED`, an override only ADMIN has (`canAdminForceCancel` in
`orders/domain/order-status-transitions.ts`), which is what actually
triggers a refund (see below). This mirrors how the ruling is meant to
happen: read the dispute, look at the order, decide what to do with the
order, then close the case — not a single button that guesses the right
order action from a status enum. The trade-off: nothing enforces the
correspondence between the two, so a dispute can be marked `RESOLVED` in
the buyer's favor without an admin having actually cancelled anything.
Acceptable for this project's scope; a production version would want an
audit link between a resolved dispute and whatever order action (if any)
accompanied it.

`GET /admin/analytics` returns the whole dashboard in one response —
commission revenue, seller revenue, order counts, cart→order conversion,
top 5 products, top 5 sellers, a daily sales chart (30 days by default),
and a comparison against the equal-length window immediately before.
`GET /admin/analytics/export` returns any of those datasets as CSV or
JSON. A seller reads their own figures at `GET /analytics/me/seller`,
resolved from their authenticated identity — there is deliberately no
`sellerId` path parameter to swap.

**No rollup tables, no CQRS.** Every figure is summed live from the
transactional rows (`LedgerEntry`, `OrderItem`, `Order`), so a reported
number cannot drift from the data it describes; the ledger already *is*
the financial read model, and indexes were added for the period queries
instead. Money is summed in Postgres `numeric` and folded in `Decimal`,
never a JS float, and returned as fixed-2 strings. The one
reporting-shaped table is `CartSession`, and only because checkout
DELETES cart items — measuring conversion from `CartItem` afterwards
would count only the carts that *didn't* convert. It is still written
inside the same transaction as the cart mutation and the checkout it
records, so it is transactional truth rather than an eventually-
consistent projection.

**The frontend is fully implemented** (`frontend/`): app bootstrap and
providers, React Router with role-aware route guards, TanStack Query for
server state, the shared HTTP client, session handling, a UI kit with
loading/error/empty states, and every screen — auth, the customer
catalog/search/cart/checkout/order flow, a realtime layer over the
backend's Socket.IO gateway (live stock, bids, order status; resyncs
from scratch on reconnect rather than trusting anything that arrived
before the drop), a seller dashboard, and an admin dashboard with
analytics + CSV/JSON export. See `frontend/README.md` for the full
breakdown.

Building the seller dashboard surfaced one real backend gap: there was
no way for a seller to list their own `SellerOrder`s (`GET /orders/:id`
is buyer/admin-only, by design). Added `GET /orders/seller-orders`
(`OrdersController`, `SELLER`-only), which resolves `sellerId` from the
caller's own approved profile exactly like product/auction creation
does — never a request param — so it closes the gap without opening a
new one.

Two decisions there are worth repeating outside the frontend docs. The
HTTP client **coalesces concurrent 401s into a single token refresh**:
the backend rotates refresh tokens and treats reuse of a spent one as
theft, so several queries refreshing in parallel would revoke the token
family and log the user out — the one case where a naive client breaks a
correct backend. And `shared/` may not import auth, since it sits below
`features/` in the layer order; the client therefore exposes
`configureHttpClient(...)` and the auth feature injects its
implementation at bootstrap, with the tokens themselves in
`shared/lib/token-storage` because they are two strings that know nothing
about sessions.

**There is no client-facing "request a refund" endpoint.** An earlier
version had `POST /refunds` and `PATCH /refunds/:id/resolve`, but the
latter unconditionally returned 501 — a customer could open a refund
request that then had no way to ever resolve, even for an admin. Both
were removed rather than left as a dead end. A `Refund` now only ever
exists because `PaymentsLedgerService`'s cancellation saga opened one:
getting money back means getting the underlying `SellerOrder` cancelled
— by the seller pre-shipment, or by an admin acting on a dispute ruling
afterwards (see above) — which is what the saga listens for. `GET
/refunds/:id` still exists, to let the buyer, the fulfilling seller, or
an admin check a refund's status once the saga has opened one.

Analytics is the one BullMQ queue with no consumer yet — nothing in the
reporting path is async.

**Redis caches the product catalogue and individual product pages**
(`infrastructure/cache/`), read-through with a 30s TTL. Same posture as
Meilisearch and the realtime layer: never authoritative — checkout,
bidding, and stock reservation always read Postgres directly inside
their own transaction, never through this cache — and every cache
method fails open (a Redis error is logged and treated as a miss/no-op),
so an outage degrades browsing to "slower", never "wrong" or "down".
Catalogue listings are invalidated by a versioned namespace key (bumped
on every product write), which orphans every previously cached filter/
sort combination in one INCR instead of a Redis KEYS/SCAN sweep; a
product's detail page is invalidated directly by id on the same writes.
The trade-off this accepts: `quantityAvailable` on a cached read can be
briefly stale (up to the TTL) — acceptable because checkout re-validates
stock authoritatively regardless of what any cache says, and an active
viewer's figure is corrected independently by the WebSocket layer.
