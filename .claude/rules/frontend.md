---
paths:
  - "frontend/**"
---

# Frontend rules (React + TypeScript)

- React + TypeScript, organized as Feature-Sliced Design — see the
  `frontend-architecture` skill for the layer breakdown and import rules.
- **TanStack Query is server state.** No ad-hoc `useEffect` + `fetch` +
  `useState` for data that belongs to the server.
- **Don't duplicate backend business logic.** Validation, pricing,
  authorization, consistency rules live in the backend — the frontend
  trusts and reflects them, it doesn't recompute them.
- **Forms → React Hook Form + Zod.**
- **API access through the shared API layer** (`shared/api/`) — no
  ad-hoc `fetch` calls scattered across features/pages.
- **WebSocket is real-time notification delivery only, not the source of
  truth.** On reconnect, resync state from the REST API rather than
  assuming no messages were missed.
