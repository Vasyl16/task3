# entities/

Business entities — their data shape, API calls, and minimal display
components.

Entity slices deliberately mirror the backend's module boundaries, so a
domain concept has one name on both sides and there is never a question
of which slice owns a given endpoint:

| Slice | Backend module | Status |
| --- | --- | --- |
| `session/` | `auth` | implemented |
| `product/` | `products` + `search` | implemented |
| `category/` | `categories` | implemented |
| `cart/` | `cart` | implemented |
| `order/` | `orders` (incl. `GET /orders/seller-orders`) | implemented |
| `auction/` | `bidding` | implemented |
| `seller/` | `sellers` (+ admin seller-application routes) | implemented |
| `dispute/` | `disputes` (+ admin dispute routes) | implemented |
| `notification/` | `notifications` | implemented |
| `analytics/` | `analytics` (+ admin analytics/export routes) | implemented |

Each entity that has an admin-privileged counterpart route (product
moderation, seller-application review, dispute resolution, the platform-
wide analytics report) exposes it as a sibling function in the SAME
api/model files — e.g. `productApi.adminList`/`adminModerate` sit next to
`productApi.list`. They operate on the same domain object via a
different, more-privileged route; a parallel `entities/admin` slice
would just duplicate the type. The admin *screens* that call them still
live in `pages/admin/`, per the note below.

Two boundaries intentionally differ from a naive 1:1 mapping:

- **`product/` covers both `products` and `search`.** They are one
  concept to the UI — a catalog listing comes from the Meilisearch-backed
  search endpoint and a detail view comes from PostgreSQL, but both
  render a product. Splitting them would put two shapes of the same
  entity in two slices.
- **There is no `admin/` entity.** The backend's `AdminController` is an
  authorization surface, not a domain: its routes operate on products,
  sellers, disputes, and analytics. Admin *screens* belong in
  `pages/`/`widgets/`, reusing those entities.
