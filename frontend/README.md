# Frontend

React 19 + TypeScript on Vite, organised as Feature-Sliced Design. See
`../.claude/skills/frontend-architecture` for the layer rules and
`../README.md` for how to run it (two launch modes).

## Stack

| Concern | Choice |
| --- | --- |
| Server state | TanStack Query |
| Routing | React Router (`createBrowserRouter`) |
| Forms | React Hook Form + Zod (via `@hookform/resolvers`) |
| Realtime | Socket.IO client (`shared/realtime/`), one connection for the app |
| Local/UI state | plain React state and context |
| Styling | plain CSS with design tokens in `shared/ui/ui.css` |
| Tests | Vitest + Testing Library (jsdom) |

There is deliberately **no global state library**. Nearly everything on
screen is server state, which belongs in TanStack Query's cache; putting
it in a store as well would create a second copy to keep in sync. The
only genuinely global client state is the session, which is a context.

## Layers

`shared/` → `entities/` → `features/` → `widgets/` → `pages/` → `app/`.
Imports only ever point downward. Each layer's `README.md` says what
belongs in it, and `entities/README.md` maps entity slices onto the
backend's modules.

## What exists today

The full app:

- **Foundation** — app bootstrap and providers, routing with a role-
  aware route guard, the HTTP client, session handling, the UI kit.
- **Customer marketplace** — catalog + search (filters/sort/pagination
  live in the URL), product and auction detail, cart with optimistic
  updates (rollback on failure), checkout, order history and detail.
- **Realtime** — `shared/realtime/` wraps the backend's Socket.IO
  gateway; product stock, auction bids, and order status update live on
  screen. A dropped connection re-subscribes from scratch on reconnect
  rather than trusting whatever arrived before the drop — see
  `frontend-architecture`'s realtime notes.
- **Seller dashboard** (`/seller/*`, role `SELLER`) — overview/analytics
  with a 30-day sales chart, product management, auction creation,
  SellerOrder status management.
- **Admin dashboard** (`/admin/*`, role `ADMIN`) — seller-application
  review, product moderation, dispute resolution, platform analytics
  with period comparison and CSV/JSON export.

Every mutation trusts the backend as the actual authority — ownership,
valid status transitions, and business rules are re-checked server-side
regardless of what the UI shows or greys out; see each feature's own
comments for the specific rule being mirrored and why.

## Two rules worth knowing before adding code

**The frontend never owns a business rule.** Pricing, stock,
authorization, and state transitions are decided by the backend. Zod
schemas here exist to spare the user a round trip, and they mirror the
backend's DTO constraints rather than replacing them — where the two
disagree, the backend's answer is the one that counts and its message is
what gets shown.

**Route guards are navigation, not security.** `ProtectedRoute` reads a
role from an unverified client-side decode of the access token, so it
can only decide what to *show*. Anyone can edit localStorage; nothing is
actually protected until the backend checks the token's signature.
