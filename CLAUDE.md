# Project: Multi-Vendor Marketplace + Real-Time Inventory

Monorepo: `backend/` (NestJS modular monolith) + `frontend/` (React/Vite).
Each app is fully independent — its own `package.json`, no root workspace
tooling.

Rules and skills live in `.claude/`:

- `.claude/rules/general.md` — always-on ground rules (don't
  over-engineer, no microservices, no bypassing architecture, no secrets
  in code, no commit without approval, explain decisions, test changed
  functionality).
- `.claude/rules/backend.md` / `frontend.md` — short, path-scoped rules
  that load only when Claude touches matching files.
- `.claude/rules/testing.md` — path-scoped to test files; what always
  needs a test.
- `.claude/skills/` — deeper reference material (`backend-architecture`,
  `frontend-architecture`, `database`, `testing`, `observability`,
  `code-review-checklist`), loaded on demand rather than every session.

See `README.md` for repository structure, infrastructure, environment
variables, and current project status.
