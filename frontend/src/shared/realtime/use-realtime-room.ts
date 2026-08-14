import { useEffect, useRef, useState } from 'react';
import { onRealtimeReconnected, realtimeClient } from './realtime-client';

export type RealtimeRoomStatus =
  'idle' | 'subscribing' | 'subscribed' | 'error';

interface UseRealtimeRoomOptions<TState, TEventPayload> {
  // Broadcast event names this room type emits (see the gateway's four
  // event names) — only these get wired up, so a product room doesn't
  // pay for an auction-bid listener it will never receive.
  events: string[];
  onSnapshot: (state: TState, fetchedAt: string) => void;
  onEvent?: (eventName: string, payload: TEventPayload) => void;
}

// Generic room lifecycle: subscribe on mount, re-subscribe (not merely
// resync — Socket.IO drops room membership on disconnect, so a dropped
// connection needs a full re-join) whenever the socket reconnects, and
// unsubscribe on unmount or room change. Business meaning of the
// snapshot/events belongs to the caller (an entity's realtime hook) —
// this layer only owns the wire protocol, which is why it lives in
// shared/ rather than entities/.
export function useRealtimeRoom<TState, TEventPayload = unknown>(
  room: string | null,
  {
    events,
    onSnapshot,
    onEvent,
  }: UseRealtimeRoomOptions<TState, TEventPayload>,
): { status: RealtimeRoomStatus; errorMessage?: string } {
  const [status, setStatus] = useState<RealtimeRoomStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>();

  // Handlers (and the events array, which callers pass as a fresh
  // literal each render) are read through refs so the effect below only
  // re-runs when `room` itself changes, not on every render of the
  // calling component.
  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    if (!room) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    let subscribed = false;

    async function join() {
      setStatus('subscribing');
      const ack = await realtimeClient.subscribe<TState>(room as string);
      if (cancelled) return;
      if (!ack.ok) {
        setStatus('error');
        setErrorMessage('message' in ack ? ack.message : 'Subscribe failed');
        return;
      }
      subscribed = true;
      setStatus('subscribed');
      if ('snapshot' in ack) {
        onSnapshotRef.current(ack.snapshot.state, ack.snapshot.fetchedAt);
      }
    }

    void join();

    // A reconnect fires 'connect' again; the first call race with the
    // initial join() above is harmless because `subscribed` is still
    // false at that point, so this no-ops until join() has actually
    // completed once.
    const offReconnect = onRealtimeReconnected(() => {
      if (!subscribed) return;
      subscribed = false;
      void join();
    });

    const offEvents = eventsRef.current.map((eventName) =>
      realtimeClient.onEvent<TEventPayload>(eventName, (envelope) => {
        if (envelope.room !== room) return;
        onEventRef.current?.(eventName, envelope.payload);
      }),
    );

    return () => {
      cancelled = true;
      offReconnect();
      for (const off of offEvents) off();
      if (subscribed) {
        void realtimeClient.unsubscribe(room);
      }
    };
  }, [room]);

  return { status, errorMessage };
}
