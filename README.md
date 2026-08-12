# Multi-Vendor Marketplace + Real-Time Inventory

## Repository Structure

This is a monorepo containing two fully independent applications — each has
its own `package.json`, dependencies, and lockfile. There is no root-level
package manager or workspace tooling; `backend/` and `frontend/` are managed
separately.

```
.
├── backend/            # NestJS + TypeScript API (modular monolith)
│   ├── prisma/
│   │   ├── schema.prisma # domain model (PostgreSQL, remote — see "Database" below)
│   │   └── migrations/    # tracked migration history
│   └── src/
│       ├── config/         # env var loading (@nestjs/config)
│       ├── core/           # cross-cutting app-wide providers (correlation IDs)
│       ├── infrastructure/ # shared plumbing: Prisma client, outbox, health
│       └── modules/        # one NestJS module per domain boundary — see
│                            # the backend-architecture skill for the
│                            # layout and dependency-direction rules
├── frontend/           # React + TypeScript app (Vite), Feature-Sliced Design
│   └── src/
│       ├── app/          # root component, providers, global styles, routing
│       ├── pages/        # route-level compositions
│       ├── widgets/       # composite UI blocks
│       ├── features/      # user-facing interactions (add-to-cart, place-bid, ...)
│       ├── entities/      # business entities (data shape, API, minimal display)
│       └── shared/        # business-agnostic reusable code (UI kit, API client, assets)
├── docker-compose.yml  # Local infra: Redis + Meilisearch only
└── .claude/
    ├── rules/            # always-on / path-scoped rules (general, backend,
    │                      # frontend, testing) — see CLAUDE.md
    └── skills/           # on-demand reference (backend-architecture,
                           # frontend-architecture, database, testing,
                           # code-review-checklist)
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

`docker-compose.yml` provisions **only** the infra that's appropriate to
run locally. Each service exists for a specific reason:

- **Redis** — the backing store for **BullMQ**, the async job queue used
  for anything that doesn't need to block the originating request:
  Meilisearch index sync and WebSocket notification dispatch, both
  triggered via the transactional outbox pattern (domain write + outbox
  row commit together in Postgres; a relay then enqueues BullMQ jobs from
  outbox rows). Redis holds no business-critical state — if it's flushed,
  in-flight async jobs are lost but Postgres remains fully correct;
  jobs would need to be re-triggered by re-running the outbox relay, not
  by any manual data recovery.
- **Meilisearch** — the search/read index for products. It is **not** a
  source of truth: nothing in the application may depend on Meilisearch
  being up-to-date, or even up, for anything other than the search feature
  itself. It's rebuilt asynchronously from Postgres via the same
  outbox → BullMQ pipeline.
- **PostgreSQL is deliberately excluded and remote.** It is the single
  source of truth for all business-critical state (users, vendors,
  products, inventory, orders, auctions, bids, payments) and is never
  containerized here, never defaulted to a local address, and never
  hardcoded — only configured via `DATABASE_URL` in `backend/.env`
  (provision a real remote/hosted Postgres instance yourself).

Every value in `docker-compose.yml` (ports, Meilisearch's master key) has
a working local-dev default via `${VAR:-default}` substitution, so
`docker compose up -d` works immediately with no `.env` file required.
Override any of them with a root-level `.env` file or exported shell env
vars if you need non-default ports or a real master key locally.

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
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | Optional | Token lifetimes |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` | Optional (placeholders) | Not wired up yet |

**Frontend** (`frontend/.env`, see `frontend/.env.example`) — public only:

| Variable | Required? | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | Required | Backend REST base URL |
| `VITE_WS_URL` | Required | Backend WebSocket base URL |

## Getting Started

### 1. Start local infrastructure (Redis + Meilisearch)

```bash
docker compose up -d
```

### 2. Backend

```bash
cd backend
cp .env.example .env   # fill in DATABASE_URL (remote Postgres); MEILI_MASTER_KEY
                        # must match whatever docker-compose used (default:
                        # changeme_dev_master_key) if you didn't override it
npm install
npm run start:dev
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

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

## Architecture Notes

See `CLAUDE.md` for the pointer to `.claude/rules/` (always-on / path-
scoped rules) and `.claude/skills/` (module boundaries, transaction
rules, DTO validation, idempotent event handlers, migration safety,
etc.). A full architecture write-up (consistency model, outbox/event
flow, domain events) will be added to this README as those pieces are
implemented.

## Status

This repository currently contains the **foundation**: scaffolded
backend/frontend apps with layered structure (backend
`config/core/infrastructure/modules`, frontend FSD), tooling
(lint/format/test/build), local infra config, validated app configuration
(env vars, required vs. optional, server-only vs. public), the initial
Prisma domain model applied to the remote database, and the backend's
NestJS module boundaries (controller/service/repository/DTO per module,
see the `backend-architecture` skill) with basic CRUD wired end-to-end. Genuinely
complex business logic (checkout, bid placement, order-status aggregation,
refund resolution) is intentionally stubbed (`NotImplementedException`)
pending its own task, and there's no authentication yet (no guards, no
password hashing, no JWT issuance).
