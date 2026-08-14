import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationApi, notificationKeys } from '../api/notification-api';

export function useNotifications(
  unreadOnly?: boolean,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: notificationKeys.list(unreadOnly),
    queryFn: () => notificationApi.list(unreadOnly),
    enabled: options?.enabled,
    // Notifications are read fairly casually; a short poll keeps the
    // header badge reasonably fresh without needing its own realtime
    // room (the backend has none for notifications specifically).
    refetchInterval: 30_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}
