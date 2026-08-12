# General rules

Apply to every change in this repo, backend or frontend.

- **Don't over-engineer.** Implement only what the current task asks for.
  No speculative abstractions, no new architecture/services/dependencies
  unless the task genuinely requires them — ask first if unsure.
- **Don't introduce microservices.** This is a modular monolith
  (NestJS modules in one backend process). A module boundary is not a
  service boundary.
- **Don't bypass architecture.** Respect existing layering (see
  `backend.md`/`frontend.md` and the `backend-architecture`/
  `frontend-architecture` skills) — no shortcuts around it because a task
  feels small.
- **Don't put secrets in code.** Real values live in gitignored `.env`
  files only; only `.env.example` (placeholders) is committed.
- **Don't commit without approval.** Implement, verify, explain what
  changed — then wait for explicit approval before `git commit`.
- **Explain significant decisions.** Architectural choices, trade-offs,
  and any deviation from an existing convention get called out in your
  response, not made silently.
- **Test changed functionality.** Critical business logic requires tests
  (see `testing.md`); for anything else, at minimum verify the change
  works (lint/typecheck/build, or exercising the actual behavior).
