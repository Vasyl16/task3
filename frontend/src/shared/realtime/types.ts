// Wire types for the backend's Socket.IO gateway (namespace `/realtime`,
// see src/infrastructure/realtime/realtime.gateway.ts). Kept here rather
// than per-entity because the envelope/ack shape is the same for every
// room type — only the `state`/`payload` generic varies, and that part
// is typed where each entity consumes it.

export interface RealtimeSnapshot<T> {
  room: string;
  state: T;
  fetchedAt: string;
  // The REST endpoint this snapshot was read from — surfaced mainly for
  // debugging; the frontend re-fetches via the entity's normal query key,
  // not by parsing this string.
  authoritativeSource: string;
}

export type RealtimeAckError =
  'INVALID_ROOM' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND';

export type RealtimeAck<T> =
  | { ok: true; snapshot: RealtimeSnapshot<T> }
  | { ok: true }
  | { ok: false; error: RealtimeAckError; message: string };

export interface RealtimeEnvelope<T> {
  room: string;
  event: string;
  payload: T;
  emittedAt: string;
  authoritativeSource: string;
}

export type RealtimeConnectionStatus =
  'connecting' | 'connected' | 'disconnected' | 'reconnecting';
