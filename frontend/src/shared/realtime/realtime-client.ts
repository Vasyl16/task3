import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { env } from '../config/env';
import type { RealtimeAck, RealtimeConnectionStatus } from './types';

// The one Socket.IO connection for the whole app, on the `/realtime`
// namespace the gateway exposes. Mirrors the HTTP client's shape:
// `shared/` needs the current access token but may not import
// `features/auth`, so auth is injected the same way
// (configureHttpClient's sibling).
export interface RealtimeAuth {
  getAccessToken(): string | null;
}

const noAuth: RealtimeAuth = { getAccessToken: () => null };
let auth: RealtimeAuth = noAuth;

export function configureRealtimeAuth(next: RealtimeAuth): void {
  auth = next;
}

let socket: Socket | null = null;
let status: RealtimeConnectionStatus = 'connecting';
const statusListeners = new Set<() => void>();

function setStatus(next: RealtimeConnectionStatus): void {
  if (status === next) return;
  status = next;
  for (const listener of statusListeners) listener();
}

function ensureSocket(): Socket {
  if (socket) return socket;

  socket = io(`${env.wsUrl}/realtime`, {
    // Re-evaluated by socket.io on every (re)connection attempt, so a
    // login/logout that happens while the socket is alive is picked up
    // by calling reconnectRealtimeSocket() below rather than by this
    // callback alone — an already-open connection doesn't re-run it.
    auth: (cb) => {
      const token = auth.getAccessToken();
      cb({ token: token ? `Bearer ${token}` : undefined });
    },
    reconnection: true,
  });

  socket.on('connect', () => setStatus('connected'));
  socket.on('disconnect', () => setStatus('disconnected'));
  socket.io.on('reconnect_attempt', () => setStatus('reconnecting'));

  return socket;
}

// Forces a fresh handshake so a just-changed identity (login, logout, a
// token refresh that changed the role) is reflected on the socket —
// otherwise a user who logs in after connecting anonymously would keep
// the anonymous connection and be denied their own private rooms.
export function reconnectRealtimeSocket(): void {
  if (!socket) return;
  socket.disconnect();
  socket.connect();
}

export function getRealtimeConnectionStatus(): RealtimeConnectionStatus {
  return status;
}

export function subscribeRealtimeConnectionStatus(
  listener: () => void,
): () => void {
  // The socket is created lazily, on first subscriber, so importing this
  // module never opens a connection the app doesn't end up using (e.g.
  // in tests).
  ensureSocket();
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function onRealtimeReconnected(listener: () => void): () => void {
  const socketInstance = ensureSocket();
  socketInstance.on('connect', listener);
  return () => {
    socketInstance.off('connect', listener);
  };
}

function emitWithAck<T>(
  event: 'subscribe' | 'unsubscribe' | 'resync',
  room: string,
): Promise<RealtimeAck<T>> {
  return new Promise((resolve) => {
    ensureSocket().emit(event, { room }, (ack: RealtimeAck<T>) => {
      resolve(ack);
    });
  });
}

export const realtimeClient = {
  subscribe: <T>(room: string) => emitWithAck<T>('subscribe', room),
  unsubscribe: <T>(room: string) => emitWithAck<T>('unsubscribe', room),
  resync: <T>(room: string) => emitWithAck<T>('resync', room),
  onEvent: <T>(
    eventName: string,
    listener: (envelope: import('./types').RealtimeEnvelope<T>) => void,
  ): (() => void) => {
    const socketInstance = ensureSocket();
    socketInstance.on(eventName, listener);
    return () => {
      socketInstance.off(eventName, listener);
    };
  },
};

// Exposed for tests, which need each case to start from a clean slate —
// same convention as resetHttpClient.
export function resetRealtimeClient(): void {
  socket?.disconnect();
  socket = null;
  auth = noAuth;
  status = 'connecting';
  statusListeners.clear();
}
