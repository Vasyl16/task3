# Multi-Vendor Marketplace + Real-Time Inventory

## Repository Structure

This is a monorepo containing two fully independent applications — each has
its own `package.json`, dependencies, and lockfile. There is no root-level
package manager or workspace tooling; `backend/` and `frontend/` are managed
separately.

```
.
├── backend/            # NestJS + TypeScript API (modular monolith)
│   └── src/
│       ├── config/       # env var loading (@nestjs/config)
│       ├── core/         # cross-cutting app-wide providers (empty until needed)
│       └── modules/      # one NestJS module per domain boundary (empty until first module)
├── frontend/           # React + TypeScript app (Vite), Feature-Sliced Design
│   └── src/
│       ├── app/          # root component, providers, global styles, routing
│       ├── pages/        # route-level compositions
│       ├── widgets/       # composite UI blocks
│       ├── features/      # user-facing interactions (add-to-cart, place-bid, ...)
│       ├── entities/      # business entities (data shape, API, minimal display)
│       └── shared/        # business-agnostic reusable code (UI kit, API client, assets)
├── docker-compose.yml  # Local infra: Redis + Meilisearch only
└── .claude/             # Project-specific Claude Code instructions
```

Backend layering and FSD import-direction rules are enforced via
`backend/CLAUDE.md` and `frontend/CLAUDE.md` — read those before adding
code to either app.

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

See `.claude/CLAUDE.md`, `backend/CLAUDE.md`, and `frontend/CLAUDE.md` for
the enforced conventions (module boundaries, transaction rules, DTO
validation, idempotent event handlers, etc.). A full architecture write-up
(consistency model, outbox/event flow, domain events) will be added to this
README as those pieces are implemented.

## Status

This repository currently contains the **foundation**: scaffolded
backend/frontend apps with layered structure (backend `config/core/modules`,
frontend FSD), tooling (lint/format/test/build), local infra config, and
validated app configuration (env vars, required vs. optional, server-only
vs. public). No authentication, business logic, database schema, or API
endpoints exist yet.
