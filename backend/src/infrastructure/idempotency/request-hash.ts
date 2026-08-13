import { createHash } from 'node:crypto';

// A reused Idempotency-Key must be for the *same* request — hashing
// method+path+body lets us detect (and reject) a key being replayed
// against a different operation instead of silently returning a
// mismatched stored response.
export function hashRequest(
  method: string,
  path: string,
  body: unknown,
): string {
  return createHash('sha256')
    .update(method)
    .update('\0')
    .update(path)
    .update('\0')
    .update(JSON.stringify(body ?? {}))
    .digest('hex');
}
