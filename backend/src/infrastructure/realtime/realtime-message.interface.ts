import type { RealtimeEventName } from './realtime.constants';

// Every server -> client message shares this envelope.
//
// `authoritativeSource` is not decoration: it names the REST endpoint
// that IS the source of truth for this room, so a client that misses,
// doubts, or arrives late to a broadcast always knows where to go
// instead of treating the payload as final. A broadcast tells you
// something changed and roughly what it became; only Postgres (via that
// endpoint, or via `resync`) tells you what it IS.
export interface RealtimeEnvelope<T = Record<string, unknown>> {
  room: string;
  event: RealtimeEventName;
  payload: T;
  emittedAt: string;
  authoritativeSource: string;
}

// The reply to `subscribe` and `resync`: the room's CURRENT state, read
// from Postgres at the moment of the request. This is the whole reconnect
// story — see RealtimeGateway.
export interface RealtimeSnapshot<T = Record<string, unknown>> {
  room: string;
  state: T;
  fetchedAt: string;
  authoritativeSource: string;
}

export type RealtimeAck<T = Record<string, unknown>> =
  | { ok: true; snapshot: RealtimeSnapshot<T> }
  | { ok: true }
  | { ok: false; error: RealtimeAckError; message: string };

export enum RealtimeAckError {
  INVALID_ROOM = 'INVALID_ROOM',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
}
