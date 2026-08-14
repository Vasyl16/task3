import { useRealtimeConnectionStatus } from '../../../shared/realtime';

// Graceful disconnect/reconnect handling for the realtime layer: rather
// than silently showing whatever was last received, tell the user their
// live data may be stale. Nothing here blocks the page — every entity
// still has its REST fetch as the fallback source of truth.
export function ConnectionBanner() {
  const status = useRealtimeConnectionStatus();

  // The initial 'connecting' state is silent — the first connect is
  // expected to take well under a second, and flashing a banner on
  // every page load would be noise, not information. Only a connection
  // that was UP and then dropped is worth telling the user about.
  if (status !== 'reconnecting' && status !== 'disconnected') return null;

  const message =
    status === 'reconnecting'
      ? 'Reconnecting live updates…'
      : 'Live updates disconnected — reconnecting shortly.';

  return (
    <div className="connection-banner" role="status">
      {message}
    </div>
  );
}
