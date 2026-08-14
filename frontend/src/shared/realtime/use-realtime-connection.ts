import { useSyncExternalStore } from 'react';
import {
  getRealtimeConnectionStatus,
  subscribeRealtimeConnectionStatus,
} from './realtime-client';
import type { RealtimeConnectionStatus } from './types';

// For UI that wants to show "live" / "reconnecting" / "offline" —
// connection state is genuinely global (there's one socket), so this is
// the one exception to "server state goes through TanStack Query": it
// isn't server DATA, it's transport status.
export function useRealtimeConnectionStatus(): RealtimeConnectionStatus {
  return useSyncExternalStore(
    subscribeRealtimeConnectionStatus,
    getRealtimeConnectionStatus,
  );
}
