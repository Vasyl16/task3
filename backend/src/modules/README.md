# modules/

One NestJS module per domain boundary (auth, users, vendors, catalog,
inventory, auctions, orders, payments, search, notifications, outbox — see
root `README.md` / `../../CLAUDE.md` for the current boundary list).

Empty until the first domain module is implemented. See `../../CLAUDE.md`
for layering rules (controllers orchestrate only, no direct DB access from
controllers, business logic lives in services).
