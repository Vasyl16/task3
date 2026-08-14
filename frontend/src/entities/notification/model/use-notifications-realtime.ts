import { useQueryClient } from '@tanstack/react-query';
import { useRealtimeRoom } from '../../../shared/realtime';
import { notificationKeys } from '../api/notification-api';

interface NotificationSnapshotState {
  userId: string;
  unreadCount: number;
}

interface NotificationCreatedPayload {
  userId: string;
  type: string;
}

// Both the snapshot (on subscribe/reconnect) and the live event are pure
// hints to refetch — per the WebSocket-is-not-source-of-truth rule, the
// full notification (title/body/data) always comes from REST. Keeping a
// server-echoed unread count in the socket state would just be a second
// copy of something TanStack Query already owns; invalidating and
// letting the existing 30s-poll query refetch immediately is simpler and
// can't drift from it.
export function useNotificationsRealtime(userId: string | null) {
  const queryClient = useQueryClient();

  return useRealtimeRoom<NotificationSnapshotState, NotificationCreatedPayload>(
    userId ? `notification:${userId}` : null,
    {
      events: ['notification.created'],
      onSnapshot: () => {
        void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
      },
      onEvent: () => {
        void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
      },
    },
  );
}
