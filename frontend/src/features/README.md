# features/

User-facing interactions with real business meaning. Each feature slice
typically has `ui/` and `model/` segments (no `api/` — every feature
calls straight into its entity's existing `api/`, it doesn't define its
own).

| Slice | What it does |
| --- | --- |
| `auth/` | login, register, session |
| `cart/` | add/update/remove cart items, optimistic with rollback |
| `checkout/` | cart checkout and auction-win checkout (not optimistic — see the comment in `use-checkout.ts`) |
| `bidding/` | place a bid on an active auction |
| `seller-products/` | create/edit/archive a seller's own product |
| `seller-auctions/` | create an auction listing for a seller's own auction-type product |
| `seller-orders/` | advance a seller's own SellerOrder through its status transitions |
| `become-seller/` | apply for a seller account |
| `admin-moderation/` | take down/reinstate a product |
| `admin-disputes/` | move a dispute through review to resolved/rejected |
| `admin-sellers/` | approve/reject/suspend a seller application |

Every mutation here trusts the backend as the actual authority — see
each slice's own comments for where a rule (a valid status transition,
an ownership check) is mirrored client-side for UX and where the
backend's re-check is what actually matters.
