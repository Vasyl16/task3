---
name: code-review-checklist
description: Repo-specific correctness checklist for this marketplace codebase — checks the architectural rules in .claude/rules/ and the skills actually got followed (layering, DTO validation, ownership/IDOR, transaction+outbox+idempotency, FSD import direction, no secrets). Use alongside or after a diff review (e.g. the bundled /code-review) to check this repo's specific conventions, or when asked to review a PR/diff against project standards.
---

# Code review checklist (this repo)

Not a substitute for `/code-review` (which does deep multi-agent
correctness/simplification analysis) — this is a fast, repo-specific
pass for the conventions in `.claude/rules/` and the architecture skills.
Check the diff against each relevant section:

## Backend (if `backend/**` changed)

- [ ] No business logic in a controller — it only parses/validates and
      calls a service method.
- [ ] No controller or service reaches into another module's repository
      or Prisma models directly — only into its exported service.
- [ ] Every controller input is a typed, `class-validator`-decorated DTO.
- [ ] Any operation touching `Inventory`/`Auction`/checkout uses an
      explicit `prisma.$transaction` and the `version`-column optimistic
      lock — not a naive read-then-write.
- [ ] A write that other systems need to react to goes through
      `OutboxService.record()` in the same transaction — not a direct
      call to Meilisearch/WebSocket.
- [ ] A new event consumer checks/inserts `ProcessedEvent` before acting
      (idempotent).
- [ ] `Order.status` changes are recomputed synchronously alongside the
      triggering `SellerOrder` change, same transaction.
- [ ] New/changed endpoints that mutate data have (or have a `TODO(auth)`
      marking the gap for) an ownership/IDOR check — a valid token isn't
      enough, the resource must belong to the requester.
- [ ] Money fields are `Decimal`, never `Float`.
- [ ] No destructive Prisma command was run against the real
      `DATABASE_URL` without explicit approval.

## Frontend (if `frontend/**` changed)

- [ ] New code respects FSD import direction (`shared` → `entities` →
      `features` → `widgets` → `pages` → `app`, downward only).
- [ ] Server data goes through TanStack Query, not ad-hoc
      `useEffect`/`fetch`/`useState`.
- [ ] No business logic (pricing, validation, authorization) duplicated
      from the backend.
- [ ] No secret or credential in a `VITE_`-prefixed env var.

## Both

- [ ] No secrets committed (check `.env`, hardcoded keys/tokens).
- [ ] No unapproved new dependency, no unapproved architecture change.
- [ ] Critical logic touched (see `.claude/rules/testing.md`'s list) has
      a test.
- [ ] lint + typecheck (+ build, for anything beyond a trivial change)
      pass.
