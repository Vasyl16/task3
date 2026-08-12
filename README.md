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

This repository currently contains only the **foundation**: scaffolded
backend/frontend apps, tooling (lint/format/test/build), and local infra
config. No business logic, database schema, or API endpoints exist yet.
