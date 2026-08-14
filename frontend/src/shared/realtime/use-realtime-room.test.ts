import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRealtimeRoom } from './use-realtime-room';
import type { RealtimeAck } from './types';

const subscribeMock =
  vi.fn<(room: string) => Promise<RealtimeAck<{ n: number }>>>();
const unsubscribeMock = vi.fn<(room: string) => void>();
const onEventMock = vi.fn<(eventName: string, listener: unknown) => () => void>(
  () => vi.fn(),
);
let reconnectListener: (() => void) | undefined;

vi.mock('./realtime-client', () => ({
  realtimeClient: {
    subscribe: (room: string) => subscribeMock(room),
    unsubscribe: (room: string) => unsubscribeMock(room),
    resync: vi.fn(),
    onEvent: (eventName: string, listener: unknown) =>
      onEventMock(eventName, listener),
  },
  onRealtimeReconnected: (listener: () => void) => {
    reconnectListener = listener;
    return vi.fn();
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  reconnectListener = undefined;
});

afterEach(() => {
  reconnectListener = undefined;
});

function okAck(state: { n: number }): RealtimeAck<{ n: number }> {
  return {
    ok: true,
    snapshot: {
      room: 'product:p1',
      state,
      fetchedAt: '2026-01-01T00:00:00.000Z',
      authoritativeSource: 'GET /products/p1',
    },
  };
}

describe('useRealtimeRoom', () => {
  it('subscribes on mount and unsubscribes on unmount', async () => {
    subscribeMock.mockResolvedValue(okAck({ n: 1 }));
    const onSnapshot = vi.fn();

    const { unmount } = renderHook(() =>
      useRealtimeRoom('product:p1', {
        events: ['inventory.updated'],
        onSnapshot,
      }),
    );

    await waitFor(() =>
      expect(subscribeMock).toHaveBeenCalledWith('product:p1'),
    );
    await waitFor(() =>
      expect(onSnapshot).toHaveBeenCalledWith(
        { n: 1 },
        '2026-01-01T00:00:00.000Z',
      ),
    );

    unmount();
    expect(unsubscribeMock).toHaveBeenCalledWith('product:p1');
  });

  // The core reconnect-resilience claim: a dropped socket must not leave
  // the room silently stale. On reconnect the hook re-subscribes from
  // scratch (Socket.IO drops server-side room membership on disconnect —
  // see the comment in use-realtime-room.ts) and the fresh snapshot
  // reaches the caller exactly like the first one did.
  it('re-subscribes and delivers a fresh snapshot when the socket reconnects', async () => {
    subscribeMock
      .mockResolvedValueOnce(okAck({ n: 1 }))
      .mockResolvedValueOnce(okAck({ n: 2 }));
    const onSnapshot = vi.fn();

    renderHook(() =>
      useRealtimeRoom('product:p1', {
        events: ['inventory.updated'],
        onSnapshot,
      }),
    );

    await waitFor(() => expect(subscribeMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(onSnapshot).toHaveBeenCalledWith({ n: 1 }, expect.any(String)),
    );

    expect(reconnectListener).toBeDefined();
    reconnectListener?.();

    await waitFor(() => expect(subscribeMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(onSnapshot).toHaveBeenCalledWith({ n: 2 }, expect.any(String)),
    );
  });

  // A reconnect that fires before the INITIAL subscribe has resolved
  // must not trigger a redundant extra join — see the `subscribed` guard
  // in use-realtime-room.ts.
  it('ignores a reconnect signal that arrives before the first subscribe has settled', async () => {
    let resolveFirst!: (ack: RealtimeAck<{ n: number }>) => void;
    subscribeMock.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );

    renderHook(() =>
      useRealtimeRoom('product:p1', { events: [], onSnapshot: vi.fn() }),
    );

    await waitFor(() => expect(subscribeMock).toHaveBeenCalledTimes(1));
    reconnectListener?.(); // fires while still pending
    resolveFirst(okAck({ n: 1 }));

    // Give any (incorrect) second subscribe a chance to happen before
    // asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(subscribeMock).toHaveBeenCalledTimes(1);
  });
});
