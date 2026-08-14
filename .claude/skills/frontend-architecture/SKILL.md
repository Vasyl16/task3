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
- **Entity slices mirror backend module boundaries** — see
  `frontend/src/entities/README.md` for the mapping and the two places
  it deliberately differs (`product/` spans `products` + `search`; there
  is no `admin/` entity, because `AdminController` is an authorization
  surface rather than a domain). Where a domain has an admin-privileged
  counterpart route (product moderation, seller-application review,
  dispute resolution), it's a sibling function in that SAME entity's
  `api/`/`model/` files (`productApi.adminList` next to
  `productApi.list`) — not a parallel `entities/admin` slice, which
  would just duplicate the type.

## When a lower layer needs something from a higher one

Invert the dependency; never import upward. The worked example is the
HTTP client: it needs an access token on every request, but auth lives in
`features/`. So `shared/api` exposes `configureHttpClient({
getAccessToken, refresh, onAuthFailure })`, `features/auth` supplies the
implementations, and `app/` wires them at bootstrap before any component
can issue a request. Anything genuinely business-agnostic that both sides
need — the token strings themselves — drops down into `shared/lib`.

## Auth specifics

- **Route guards are navigation, not security.** `ProtectedRoute` reads
  the role from an unverified client-side JWT decode, so it may only
  decide what to *show*. Every actual permission is enforced by the
  backend against the signature it verifies.
- **Concurrent 401s must share one refresh.** The backend rotates refresh
  tokens and treats reuse of a spent one as theft, revoking the whole
  family — so parallel refreshes log the user out. `shared/api` keeps a
  single in-flight refresh promise; anything that needs to refresh
  (including eager session restore at bootstrap) goes through that same
  gate.
- **Clear the query cache when the identity changes.** Otherwise one
  user's cached orders are served instantly to the next user who signs in
  on the same browser.

## Server state & realtime

- Server state (anything from the API) goes through TanStack Query — no
  ad-hoc `useEffect` + `fetch` + `useState` for data that belongs to the
  server. Local/UI-only state uses plain React state.
- **The realtime layer is split the same way the HTTP client is.**
  `shared/realtime/` owns the wire protocol only — one Socket.IO
  connection (`realtime-client.ts`), auth injected the same way as
  `configureHttpClient` (`configureRealtimeAuth`, wired at bootstrap
  next to it), and a generic `useRealtimeRoom(room, { events,
  onSnapshot, onEvent })` hook that handles subscribe/unsubscribe and
  knows nothing about products, auctions, or orders. Each entity that
  has a live room (`product`, `auction`, `order`) wraps that generic
  hook in its own `use-<entity>-realtime.ts`, which is the only place
  that knows the room's snapshot/event shapes and how to patch them into
  that entity's TanStack Query cache via `setQueryData`.
- **A dropped connection re-subscribes, it doesn't merely resync.**
  Socket.IO drops server-side room membership on disconnect — there is
  no persisted subscription to resume — so `useRealtimeRoom` calls
  `subscribe` again (which re-joins AND returns a fresh snapshot) on
  every reconnect, not `resync` (which assumes the room is still
  joined). Never assume a broadcast was delivered while disconnected;
  the resubscribe's snapshot is what re-establishes truth.
- WebSocket messages update the TanStack Query cache (invalidate or
  patch the relevant query) — they are not treated as a separate source
  of truth from what the REST API returns. A realtime snapshot's fields
  only ever get merged into an ALREADY-fetched query result; if nothing
  is cached yet for that entity, the snapshot is dropped rather than
  used to fabricate a query result the REST shape wouldn't produce.

## A recurring Zod + React Hook Form gotcha

`z.coerce.number()`'s input type is `unknown`, which breaks
`zodResolver`'s generic inference against `useForm<T>()` when `T` is the
schema's OUTPUT type (the mismatch shows up as a confusing "Types of
parameters 'options' and 'options' are incompatible" error). Use plain
`z.number()` and do the string→number conversion in the input instead,
via `register('field', { valueAsNumber: true })` — see
`features/bidding/model/bid-schema.ts` for the pattern.

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
