# shared/

Reusable, business-agnostic code — not aware of any specific
feature/entity. Segments added as they're needed:

- `assets/` — static assets (images, icons) — already in use.
- `ui/` — generic UI kit components.
- `api/` — base API client (fetch wrapper, TanStack Query setup).
- `lib/` — generic helper functions/hooks.
- `config/` — env var access, constants.

Import direction is one-way: `shared` → `entities` → `features` →
`widgets` → `pages` → `app`. A layer may only import from layers below it,
never sideways within the same layer or from above.
