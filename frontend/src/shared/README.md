# shared/

Reusable, business-agnostic code — not aware of any specific
feature/entity. Segments:

- `api/` — the HTTP client (auth headers, token refresh, error
  normalisation) and the `ApiError` type. Every request in the app goes
  through it.
- `ui/` — generic UI kit: buttons, fields, spinner, alerts, and the
  error/empty states, plus the design tokens in `ui.css`.
- `lib/` — generic helpers: token storage, JWT decoding.
- `config/` — env var access, validated at import time.

Import direction is one-way: `shared` → `entities` → `features` →
`widgets` → `pages` → `app`. A layer may only import from layers below it,
never sideways within the same layer or from above.

**`shared/` may not import auth.** The HTTP client needs an access token
on every request, but `features/auth` sits above it. The dependency is
inverted instead: the client exposes `configureHttpClient(...)` and the
auth feature injects its implementations at bootstrap. Token storage
lives in `lib/` (it holds two strings and knows nothing about sessions),
which is what lets the client read tokens without reaching upward.
