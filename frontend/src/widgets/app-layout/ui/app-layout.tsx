import { Outlet } from 'react-router-dom';
import { NotificationToaster } from '../../../entities/notification';
import { AppHeader } from './app-header';
import { ConnectionBanner } from './connection-banner';
import './app-layout.css';

// The shell every route renders inside. It holds chrome and layout only
// — no data fetching and no business logic, so that adding a route never
// means touching this file. NotificationToaster/ConnectionBanner are
// each self-contained (own hooks, own auth-gating) — this just composes
// them.
export function AppLayout() {
  return (
    <div className="app-shell">
      <AppHeader />
      <ConnectionBanner />
      <NotificationToaster />
      <main className="app-shell__main">
        <Outlet />
      </main>
    </div>
  );
}
