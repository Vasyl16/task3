---
name: frontend-architecture
description: Frontend architecture reference for this repo — Feature-Sliced Design layer breakdown, import-direction rules, TanStack Query and WebSocket cache patterns, and the public env-var convention. Use when designing or reviewing frontend structure, adding a new feature/entity/widget, or explaining why the frontend is organized the way it is.
---

# Frontend architecture

See `.claude/rules/frontend.md` for the short always-on rules; this is
the detailed reference.

## Feature-Sliced Design (FSD)

`frontend/src/` is layered, bottom to top: `shared/` → `entities/` →
`features/` → `widgets/` → `pages/` → `app/`. Each layer's own `README.md`
documents its purpose.

- **Import direction is one-way, downward only.** A slice may import from
  layers below it, never sideways (another slice in the same layer) or
  upward. E.g. `features/` may import from `entities/` + `shared/`, never
  from `widgets/` + `pages/`, never from another `features/*` slice
  directly.
- `shared/` — business-agnostic reusable code: UI kit, API client,
  WebSocket client, generic hooks/helpers. No feature/entity awareness.
- `entities/` — business entities (data shape, API calls, minimal
  display).
- `features/` — user-facing interactions with business meaning
  (add-to-cart, place-bid, checkout).
- `widgets/` — composite UI blocks assembled from features/entities.
- `pages/` — route-level compositions; layout only, no business logic.
- `app/` — app-wide concerns: root component, providers (QueryClient,
  Auth, Socket), global styles, routing setup.
- Within a non-`shared`/`app` slice, segment by `ui/`, `model/`, `api/`
  when the slice grows beyond a single file — don't pre-create empty
  segment folders for a slice that doesn't need them yet.

## Server state & WebSocket

- Server state (anything from the API) goes through TanStack Query — no
  ad-hoc `useEffect` + `fetch` + `useState` for data that belongs to the
  server. Local/UI-only state uses plain React state.
- WebSocket messages update the TanStack Query cache (invalidate or patch
  the relevant query) — they are not treated as a separate source of
  truth from what the REST API returns.
- On WebSocket reconnect, resync by refetching the relevant queries
  rather than assuming no messages were missed while disconnected.

## Environment variables

- Only `VITE_`-prefixed vars are exposed to the browser bundle (Vite's
  build-time inlining) — never put a secret in one, it's readable in
  devtools by anyone. Add new public config to `src/shared/config/env.ts`
  (validated at import time) and type it in `src/vite-env.d.ts`.

## Validation & types

- Trust the backend's DTO validation for correctness, but keep
  request/response shapes typed on the frontend too — don't use `any`
  for API data. Define API response types in the owning
  `entities/<entity>/` slice (or `shared/api/` if genuinely cross-entity),
  not inline per call site.

## General

- Don't add a new dependency (state library, UI kit, etc.) without
  checking it's genuinely needed — TanStack Query + React Hook Form +
  Zod + plain React state/context covers most needs here.
