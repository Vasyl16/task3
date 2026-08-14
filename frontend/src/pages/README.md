# pages/

Route-level compositions. A page assembles widgets/features/entities for a
given route; it holds layout, not business logic.

| Page slice | Routes |
| --- | --- |
| `home/` | `/` — catalog + search (Meilisearch-backed, filters live in the URL) |
| `product-detail/` | `/products/:id` |
| `auction-detail/` | `/auctions/:id` |
| `cart/` | `/cart` |
| `checkout/` | `/checkout` |
| `orders/` | `/orders` — order history |
| `order-detail/` | `/orders/:id` |
| `login/`, `register/`, `account/` | auth + profile |
| `forbidden/`, `not-found/` | route-guard fallbacks |
| `seller/` | `/seller/*` — overview, products, product create/edit, auctions, seller-orders (role: SELLER) |
| `admin/` | `/admin/*` — overview/analytics, seller applications, product moderation, disputes (role: ADMIN) |

`seller/` and `admin/` are each one page slice with several screens under
`ui/`, sharing a layout (`SellerLayout`/`AdminLayout`) that renders the
section's tab nav plus an `<Outlet/>` — see `app/routes/router.tsx` for
how they're nested under `ProtectedRoute roles={[...]}`.
