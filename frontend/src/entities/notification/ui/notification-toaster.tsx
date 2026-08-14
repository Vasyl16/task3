import { useEffect, useRef } from 'react';
import { useAuth } from '../../../features/auth';
import { useToast } from '../../../shared/ui';
import { useNotifications } from '../model/use-notifications';
import { useNotificationsRealtime } from '../model/use-notifications-realtime';

// Renders nothing itself — mounted once, unconditionally, in AppLayout
// (same pattern as ConnectionBanner), so a toast fires regardless of
// which page the user is currently on. Auth-gates ITSELF (rather than
// AppLayout doing it) so the shell stays free of business logic. Owns
// the ONE realtime subscription for notifications; the header bell and
// the notifications page both just read the same TanStack Query cache
// this component's subscription keeps invalidated, rather than each
// opening their own redundant socket subscription to the same room.
export function NotificationToaster() {
  const { status, user } = useAuth();
  const isAuthenticated = status === 'authenticated';
  const { data: notifications } = useNotifications(undefined, {
    enabled: isAuthenticated,
  });
  useNotificationsRealtime(isAuthenticated ? (user?.id ?? null) : null);
  const { show } = useToast();

  // Read through a ref so the effect below only depends on the data
  // that actually changed — matches the ref idiom already used by
  // useRealtimeRoom/SearchTextField in this codebase, rather than
  // fighting `show`'s identity in the dependency array.
  const showRef = useRef(show);
  showRef.current = show;

  // null until the first list arrives, then holds every notification id
  // already accounted for — a toast only fires for one that appears
  // AFTER this point, so re-opening the app never replays the entire
  // notification history as a burst of toasts.
  const seenIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!notifications) return;

    if (seenIds.current === null) {
      seenIds.current = new Set(notifications.map((n) => n.id));
      return;
    }

    for (const notification of notifications) {
      if (seenIds.current.has(notification.id)) continue;
      seenIds.current.add(notification.id);
      showRef.current({
        title: notification.title,
        description: notification.body,
      });
    }
  }, [notifications]);

  return null;
}
