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

### Database

PostgreSQL is **remote** — it is never run via docker-compose and never
hardcoded. Configure it via `DATABASE_URL` in `backend/.env` (see
`backend/.env.example`). `docker-compose.yml` only provisions infrastructure
that's appropriate to run locally: Redis (BullMQ) and Meilisearch (search
index).

## Getting Started

### 1. Backend env (also used by docker-compose for Meilisearch's key)

```bash
cd backend
cp .env.example .env   # fill in DATABASE_URL (remote Postgres) and other secrets
npm install
```

### 2. Start local infrastructure (Redis + Meilisearch)

From the repo root (reads `backend/.env` for `MEILI_MASTER_KEY`):

```bash
docker compose up -d
```

### 3. Run the backend

```bash
cd backend
npm run start:dev
```

### 4. Frontend

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
