import { Link } from 'react-router-dom';
import {
  useMarkNotificationRead,
  useNotifications,
  type Notification,
} from '../../../entities/notification';
import { paths } from '../../../app/routes/paths';
import { formatDateTime } from '../../../shared/lib';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  PageSpinner,
} from '../../../shared/ui';

// Where "view" sends a reader for the notification types the system
// currently produces (see NotificationsConsumer) — null falls back to no
// action link at all, so a future type never renders a dead link.
function actionFor(notification: Notification) {
  switch (notification.type) {
    case 'AUCTION_WON': {
      const auctionId = notification.data?.auctionId;
      return typeof auctionId === 'string'
        ? { to: paths.auction(auctionId), label: 'Go to auction' }
        : null;
    }
    case 'SELLER_ORDER_CREATED':
      return { to: paths.seller.orders, label: 'View order' };
    case 'SELLER_ORDER_STATUS_CHANGED': {
      const orderId = notification.data?.orderId;
      return typeof orderId === 'string'
        ? { to: paths.order(orderId), label: 'View order' }
        : null;
    }
    default:
      return null;
  }
}

function NotificationRow({ notification }: { notification: Notification }) {
  const markRead = useMarkNotificationRead();
  const action = actionFor(notification);
  const isUnread = notification.readAt === null;

  return (
    <Card
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 'var(--space-3)',
      }}
    >
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          <p style={{ margin: 0, fontWeight: 600 }}>{notification.title}</p>
          {isUnread && <Badge variant="accent">New</Badge>}
        </div>
        <p
          style={{
            margin: 'var(--space-1) 0 0',
            color: 'var(--color-text-muted)',
          }}
        >
          {notification.body}
        </p>
        <p
          style={{
            margin: 'var(--space-1) 0 0',
            fontSize: '0.75rem',
            color: 'var(--color-text-muted)',
          }}
        >
          {formatDateTime(notification.createdAt)}
        </p>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          flexShrink: 0,
        }}
      >
        {action && <Link to={action.to}>{action.label}</Link>}
        {isUnread && (
          <Button
            variant="secondary"
            isLoading={markRead.isPending}
            onClick={() => markRead.mutate(notification.id)}
          >
            Mark read
          </Button>
        )}
      </div>
    </Card>
  );
}

export function NotificationsPage() {
  // Live-updated by NotificationToaster's single global subscription
  // (mounted in AppLayout), which invalidates this exact query on every
  // new notification — see entities/notification/ui/notification-toaster.tsx.
  const { data: notifications, error, isPending, refetch } = useNotifications();

  return (
    <div>
      <PageHeader title="Notifications" />

      {isPending && <PageSpinner label="Loading notifications" />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {notifications && notifications.length === 0 && (
        <EmptyState
          title="No notifications yet"
          description="Order updates and auction results will show up here."
        />
      )}
      {notifications && notifications.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
          {notifications.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
            />
          ))}
        </div>
      )}
    </div>
  );
}
