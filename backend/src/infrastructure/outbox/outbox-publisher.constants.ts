// How often the publisher polls for pending OutboxEvent rows.
export const POLL_INTERVAL_MS = 2000;
// Rows claimed per poll — bounded so one poll can't hold a huge SKIP
// LOCKED batch open.
export const CLAIM_BATCH_SIZE = 20;
// After this many failed publish attempts, an event is parked as FAILED
// instead of retried forever — it needs operator attention (e.g. Redis
// has been down for a long time), but the row itself is never lost.
export const MAX_ATTEMPTS = 10;
// A PROCESSING row whose updatedAt is older than this is assumed to
// belong to a publisher that crashed after claiming but before
// publishing — the next poll reclaims it rather than leaving it stuck.
export const STUCK_PROCESSING_MS = 60_000;

// How long to wait before re-checking an event type with no queue
// mapping (see event-queue-map.ts) — this is the EXPECTED state for an
// event type that's recorded but doesn't have a consumer implemented
// yet ("do not implement all consumers yet" is explicit project scope,
// not a bug), so it's left PENDING rather than FAILED, and rechecked
// infrequently rather than hammered every poll.
export const UNMAPPED_EVENT_RECHECK_MS = 60 * 60 * 1000;

// Exponential backoff between retries, capped at 5 minutes, so a Redis
// outage doesn't turn into a tight polling loop hammering Postgres.
export function computeBackoffMs(attempts: number): number {
  const base = 1000 * 2 ** attempts;
  return Math.min(base, 5 * 60 * 1000);
}
