import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../../../entities/cart';
import { useNotifications } from '../../../entities/notification';
import { paths } from '../../../app/routes/paths';
import { useAuth } from '../../../features/auth';
import {
  BellIcon,
  BrandMark,
  Button,
  CartIcon,
  OrdersIcon,
  UserIcon,
} from '../../../shared/ui';

function CartLink() {
  // Only ever mounted while authenticated (see below) — the cart
  // endpoint requires a session.
  const { data: cart } = useCart();
  const itemCount =
    cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  return (
    <Link
      to={paths.cart}
      className="app-header__icon-link"
      aria-label={itemCount > 0 ? `Cart, ${itemCount} items` : 'Cart'}
      title="Cart"
    >
      <CartIcon />
      {itemCount > 0 && <span className="app-header__badge">{itemCount}</span>}
    </Link>
  );
}

function NotificationBellLink() {
  // unreadOnly: true — this is only a count, so there's no reason to
  // pull every read notification down just to discard them client-side.
  // Live-updates the instant a new notification arrives — NOT from its
  // own realtime subscription, but because NotificationToaster (mounted
  // once, globally — see AppLayout) invalidates this exact query key
  // when it hears one. One socket subscription for the whole app rather
  // than a redundant one per consumer of this data.
  const { data: unread } = useNotifications(true);

  return (
    <Link
      to={paths.notifications}
      className="app-header__icon-link"
      aria-label={
        unread && unread.length > 0
          ? `Notifications, ${unread.length} unread`
          : 'Notifications'
      }
      title="Notifications"
    >
      <BellIcon />
      {unread && unread.length > 0 && (
        <span className="app-header__badge">{unread.length}</span>
      )}
    </Link>
  );
}

export function AppHeader() {
  const { status, user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    void navigate(paths.home);
  };

  return (
    <header className="app-header">
      <Link to={paths.home} className="app-header__brand">
        <BrandMark size={30} />
        Marketplace
      </Link>

      <nav className="app-header__nav" aria-label="Main">
        {/* 'restoring' renders nothing rather than the signed-out links:
            flashing "Sign in" at a user who is in fact still signed in,
            for the moment a token refresh takes, reads as a bug. */}
        {status === 'authenticated' && user && (
          <>
            {user.role === 'SELLER' && (
              <Link to={paths.seller.root}>Seller dashboard</Link>
            )}
            {user.role === 'ADMIN' && <Link to={paths.admin.root}>Admin</Link>}
            <Link to={paths.myAuctions}>My auctions</Link>
            <Link
              to={paths.orders}
              className="app-header__icon-link"
              aria-label="Order history"
              title="Orders"
            >
              <OrdersIcon />
            </Link>
            <NotificationBellLink />
            <CartLink />
            <Link
              to={paths.account}
              className="app-header__icon-link"
              aria-label={`Account: ${user.email}`}
              title={user.email}
            >
              <UserIcon />
            </Link>
            <Button variant="ghost" onClick={() => void handleLogout()}>
              Sign out
            </Button>
          </>
        )}
        {status === 'anonymous' && (
          <>
            <Link to={paths.login}>Sign in</Link>
            <Link to={paths.register}>Create account</Link>
          </>
        )}
      </nav>
    </header>
  );
}
